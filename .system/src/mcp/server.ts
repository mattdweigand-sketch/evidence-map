import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { runEvidenceMapWorkflow } from "../chains/evidence-map/workflow.ts";
import { JsonFileEvidenceMapStore } from "../db/json-file-store.ts";
import type { EvidenceMapStore } from "../db/store.ts";
import { buildSourcePacket } from "../ingest/source-packet.ts";
import { buildLegalSourcePacketFromDrafts } from "../legal/source-packet.ts";
import { getDefaultBaseDir } from "../artifacts/paths.ts";
import { artifactKinds, workflowProfiles, type WorkflowProfile } from "../types.ts";

const artifactKindSchema = z.enum(artifactKinds);
const workflowProfileSchema = z.enum(workflowProfiles);
type ResolvedWorkspaceInputPaths = { paths: string[] } | { error: string };

export function createEvidenceMapMcpServer(store: EvidenceMapStore = createDefaultMcpStore()) {
  const defaultBaseDir = getDefaultBaseDir();
  const server = new McpServer({
    name: "evidence-map",
    version: "0.1.0"
  });

  server.registerTool(
    "evidencemap_inspect_source_packet",
    {
      title: "Inspect Source Packet",
      description: "Build a source inventory and inferred conflict log for one or more local source paths.",
      inputSchema: {
        inputPaths: z.array(z.string()).min(1),
        profile: workflowProfileSchema.default("general"),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ inputPaths, profile, baseDir }) => {
      const resolvedInputPaths = resolveWorkspaceInputPaths(baseDir, inputPaths);
      if (hasWorkspaceInputPathError(resolvedInputPaths)) return jsonToolError(resolvedInputPaths.error);
      const packet = await buildSourcePacket(resolvedInputPaths.paths);
      return jsonToolResult(await withLegalSourcePacket(packet, profile));
    }
  );

  server.registerTool(
    "evidencemap_run_workflow",
    {
      title: "Run Evidence Map Workflow",
      description: "Run source prep, artifact spec, hostile verification, trust evaluation, and local review artifact writing.",
      inputSchema: {
        name: z.string(),
        artifactKind: artifactKindSchema,
        profile: workflowProfileSchema.default("general"),
        inputPaths: z.array(z.string()).min(1),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ name, artifactKind, profile, inputPaths, baseDir }) => {
      const resolvedInputPaths = resolveWorkspaceInputPaths(baseDir, inputPaths);
      if (hasWorkspaceInputPathError(resolvedInputPaths)) return jsonToolError(resolvedInputPaths.error);
      const result = await runEvidenceMapWorkflow(store, {
        baseDir,
        name,
        artifactKind,
        profile,
        inputPaths: resolvedInputPaths.paths
      });

      return jsonToolResult({
        runId: result.run.id,
        slug: result.run.slug,
        profile: result.run.profile,
        status: result.run.status,
        readiness: result.trustReport.readiness,
        sourceCount: result.sources.length,
        inspectionCount: result.inspections.length,
        conflictCount: result.conflicts.length,
        findingCount: result.findings.length,
        blockingCount: result.trustReport.summary.blockingCount,
        needsReviewCount: result.trustReport.summary.needsReviewCount,
        artifacts: result.artifacts
      });
    }
  );

  server.registerTool(
    "evidencemap_status",
    {
      title: "Get Run Status",
      description: "Return run status, record counts, trust summary, and latest readiness for an evidence-map run.",
      inputSchema: {
        runId: z.string()
      }
    },
    async ({ runId }) => {
      const run = await store.getRun(runId);
      if (!run) throw new Error(`Unknown run: ${runId}`);

      const [sources, inspections, conflicts, assumptions, claims, calculations, findings, trustReport] = await Promise.all([
        store.listSources(runId),
        store.listFileInspections(runId),
        store.listSourceConflicts(runId),
        store.listAssumptions(runId),
        store.listClaims(runId),
        store.listCalculations(runId),
        store.listVerificationFindings(runId),
        store.getLatestTrustReport(runId)
      ]);

      return jsonToolResult({
        run,
        counts: {
          sources: sources.length,
          inspections: inspections.length,
          conflicts: conflicts.length,
          assumptions: assumptions.length,
          claims: claims.length,
          calculations: calculations.length,
          findings: findings.length
        },
        trustSummary: trustReport?.summary ?? null,
        readiness: trustReport?.readiness ?? null
      });
    }
  );

  server.registerTool(
    "evidencemap_next_action",
    {
      title: "Get Next Action",
      description: "Return the next safe action for an evidence-map run.",
      inputSchema: {
        runId: z.string()
      }
    },
    async ({ runId }) => jsonToolResult(await getNextAction(store, runId))
  );

  server.registerTool(
    "evidencemap_get_verification_report",
    {
      title: "Get Verification Report",
      description: "Return hostile-review findings and the latest trust report for an evidence-map run.",
      inputSchema: {
        runId: z.string()
      }
    },
    async ({ runId }) => {
      const run = await store.getRun(runId);
      if (!run) throw new Error(`Unknown run: ${runId}`);

      const [findings, trustReport] = await Promise.all([
        store.listVerificationFindings(runId),
        store.getLatestTrustReport(runId)
      ]);

      return jsonToolResult({ runId, findings, trustReport });
    }
  );

  return { server, store };
}

// This is a convention rail, not a security boundary: the client still chooses baseDir.
function resolveWorkspaceInputPaths(baseDir: string, inputPaths: string[]): ResolvedWorkspaceInputPaths {
  const resolvedBaseDir = resolve(baseDir);
  const paths: string[] = [];
  for (const inputPath of inputPaths) {
    const resolvedInputPath = resolve(resolvedBaseDir, inputPath);
    const relativePath = relative(resolvedBaseDir, resolvedInputPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return { error: `Input path escapes baseDir: ${inputPath}` };
    }
    paths.push(resolvedInputPath);
  }
  return { paths };
}

function hasWorkspaceInputPathError(result: ResolvedWorkspaceInputPaths): result is { error: string } {
  return "error" in result;
}

function createDefaultMcpStore() {
  return new JsonFileEvidenceMapStore(join(getDefaultBaseDir(), "deliverables", "evidence-map-store.json"));
}

async function withLegalSourcePacket(
  packet: Awaited<ReturnType<typeof buildSourcePacket>>,
  profile: WorkflowProfile
) {
  if (profile !== "legal") return packet;
  return {
    ...packet,
    legalSourcePacket: await buildLegalSourcePacketFromDrafts({
      runId: "preview",
      sources: packet.sources,
      inspections: packet.inspections
    })
  };
}

export async function runStdioMcpServer() {
  const { server } = createEvidenceMapMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function getNextAction(store: EvidenceMapStore, runId: string) {
  const run = await store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);

  const trustReport = await store.getLatestTrustReport(runId);
  if (run.status === "failed") {
    return {
      runId,
      status: run.status,
      gate: "RETRY_WORKFLOW",
      nextAction: "The workflow failed before a trust report was created. Fix the input or configuration and start a new run."
    };
  }

  if (!trustReport) {
    return {
      runId,
      status: run.status,
      gate: "RUN_WORKFLOW",
      nextAction: "Run evidencemap_run_workflow before review or export."
    };
  }

  if (trustReport.readiness === "blocked") {
    return {
      runId,
      status: run.status,
      readiness: trustReport.readiness,
      gate: "RESOLVE_VERIFICATION_FINDINGS",
      nextAction: "Review the verification report and resolve blocking issues before export.",
      blockingIssues: trustReport.blockingIssues
    };
  }

  if (trustReport.readiness === "needs_review") {
    return {
      runId,
      status: run.status,
      readiness: trustReport.readiness,
      gate: "HUMAN_REVIEW",
      nextAction: "Complete required human review items before export.",
      warnings: trustReport.warnings
    };
  }

  return {
    runId,
    status: run.status,
    readiness: trustReport.readiness,
    gate: "EXPORT_READY",
    nextAction: "The run is ready for artifact approval or export preview."
  };
}

function jsonToolResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: toStructuredContent(data)
  };
}

function jsonToolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message
      }
    ],
    structuredContent: { error: message }
  };
}

function toStructuredContent(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return { value: data };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStdioMcpServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

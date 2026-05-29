import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { runTruthLayerWorkflow } from "../chains/truth-layer/workflow.ts";
import { JsonFileTruthLayerStore } from "../db/json-file-store.ts";
import type { TruthLayerStore } from "../db/store.ts";
import { buildSourcePacket } from "../ingest/source-packet.ts";
import { getDefaultBaseDir } from "../artifacts/paths.ts";

const artifactKindSchema = z.enum(["deck", "workbook", "document", "report", "mixed"]);

export function createTruthLayerMcpServer(store: TruthLayerStore = createDefaultMcpStore()) {
  const defaultBaseDir = getDefaultBaseDir();
  const server = new McpServer({
    name: "truth-layer-os",
    version: "0.1.0"
  });

  server.registerTool(
    "truthlayer_inspect_source_packet",
    {
      title: "Inspect Source Packet",
      description: "Build a source inventory and inferred conflict log for one or more local source paths.",
      inputSchema: {
        inputPaths: z.array(z.string()).min(1),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ inputPaths, baseDir }) => {
      const resolvedInputPaths = inputPaths.map((inputPath) => resolve(baseDir, inputPath));
      return jsonToolResult(await buildSourcePacket(resolvedInputPaths));
    }
  );

  server.registerTool(
    "truthlayer_run_workflow",
    {
      title: "Run Truth Layer Workflow",
      description: "Run source prep, artifact spec, hostile verification, trust evaluation, and local review artifact writing.",
      inputSchema: {
        name: z.string(),
        artifactKind: artifactKindSchema,
        inputPaths: z.array(z.string()).min(1),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ name, artifactKind, inputPaths, baseDir }) => {
      const result = await runTruthLayerWorkflow(store, {
        baseDir,
        name,
        artifactKind,
        inputPaths
      });

      return jsonToolResult({
        runId: result.run.id,
        slug: result.run.slug,
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
    "truthlayer_status",
    {
      title: "Get Run Status",
      description: "Return run status, record counts, trust summary, and latest readiness for a truth-layer run.",
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
    "truthlayer_next_action",
    {
      title: "Get Next Action",
      description: "Return the next safe action for a truth-layer run.",
      inputSchema: {
        runId: z.string()
      }
    },
    async ({ runId }) => jsonToolResult(await getNextAction(store, runId))
  );

  server.registerTool(
    "truthlayer_get_verification_report",
    {
      title: "Get Verification Report",
      description: "Return hostile-review findings and the latest trust report for a truth-layer run.",
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

function createDefaultMcpStore() {
  return new JsonFileTruthLayerStore(join(getDefaultBaseDir(), "deliverables", "truth-layer-store.json"));
}

export async function runStdioMcpServer() {
  const { server } = createTruthLayerMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function getNextAction(store: TruthLayerStore, runId: string) {
  const run = await store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);

  const trustReport = await store.getLatestTrustReport(runId);
  if (!trustReport) {
    return {
      runId,
      status: run.status,
      gate: "RUN_WORKFLOW",
      nextAction: "Run truthlayer_run_workflow before review or export."
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

function jsonToolResult(data: unknown): any {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data ?? {}
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStdioMcpServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

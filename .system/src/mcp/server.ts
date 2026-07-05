import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { writeRunArtifacts } from "../artifacts/write.ts";
import { runEvidenceMapWorkflow } from "../chains/evidence-map/workflow.ts";
import { JsonFileEvidenceMapStore } from "../db/json-file-store.ts";
import type { EvidenceMapStore } from "../db/store.ts";
import { buildSourcePacket } from "../ingest/source-packet.ts";
import { buildLegalRunArtifacts, type LegalRunArtifacts } from "../legal/artifacts.ts";
import {
  appendLegalRiskAcceptanceDecision,
  appendAttachPassageSupportDecision,
  appendSourceAuthorityDecision,
  appendSourceConflictDecision,
  appendSourceTreatmentDecision,
  applyLegalConflictReviewDecisions,
  LEGAL_REVIEW_APPROVAL_TOKEN,
  readLegalReviewDecisionSet
} from "../legal/review-decisions.ts";
import { buildLegalSourcePacketFromDrafts } from "../legal/source-packet.ts";
import { getDefaultBaseDir } from "../artifacts/paths.ts";
import { evaluateTrust } from "../trust/evaluate.ts";
import { artifactKinds, workflowProfiles, type EvidenceMapRun, type SourceConflict, type WorkflowProfile } from "../types.ts";
import {
  legalAuthorityLevels,
  legalFindingCategories,
  legalSourceKinds,
  type LegalReviewAuditEvent,
  type LegalReviewDecisionRecord,
  type LegalReviewDecisionSet
} from "../legal/types.ts";
import {
  appendAttachClaimSourceDecision,
  appendGeneralRiskAcceptanceDecision,
  appendGeneralSourceConflictDecision,
  applyGeneralConflictReviewDecisions,
  GENERAL_REVIEW_APPROVAL_TOKEN,
  readGeneralReviewDecisionSet,
  type GeneralReviewAuditEvent,
  type GeneralReviewDecisionRecord,
  type GeneralReviewDecisionSet
} from "../review/general-decisions.ts";
import { buildHostileReviewFindings } from "../verify/hostile-review.ts";

const artifactKindSchema = z.enum(artifactKinds);
const workflowProfileSchema = z.enum(workflowProfiles);
const legalAuthorityLevelSchema = z.enum(legalAuthorityLevels);
const legalSourceKindSchema = z.enum(legalSourceKinds);
const legalFindingCategorySchema = z.enum(legalFindingCategories);
const legalTreatmentStatusSchema = z.enum(["not_checked", "checked_current", "questioned", "negative", "superseded"]);
const legalSourceStatusSchema = z.enum(["current", "superseded", "background", "draft", "unknown"]);
const generalClaimReviewStatusSchema = z.enum(["needs_review", "verified"]);
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

  server.registerTool(
    "evidencemap_attach_claim_source_support",
    {
      title: "Attach Claim Source Support",
      description: `Attach an existing source to an existing general-profile claim. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        claimId: z.string(),
        sourceId: z.string(),
        reviewStatus: generalClaimReviewStatusSchema.default("needs_review"),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, claimId, sourceId, reviewStatus, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const [claims, sources] = await Promise.all([store.listClaims(runId), store.listSources(runId)]);
        const decisionResult = appendAttachClaimSourceDecision({
          decisionSet: context.decisionSet,
          claims,
          sources,
          claimId,
          sourceId,
          reviewStatus,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateGeneralRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General claim source support decision failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_resolve_source_conflict",
    {
      title: "Resolve Source Conflict",
      description: `Resolve a source conflict for a general-profile run. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        conflictId: z.string(),
        resolution: z.string().min(1),
        reviewer: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, conflictId, resolution, reviewer, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const effectiveConflicts = applyGeneralConflictReviewDecisions({
          conflicts: context.conflicts,
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendGeneralSourceConflictDecision({
          decisionSet: context.decisionSet,
          conflicts: effectiveConflicts,
          conflictId,
          resolution,
          reviewer,
          approvalToken
        });
        return jsonToolResult(await regenerateGeneralRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General source conflict decision failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_accept_general_risk",
    {
      title: "Accept General Risk",
      description: `Accept or carry a current general-profile verification risk. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        location: z.string(),
        issue: z.string(),
        reason: z.string().min(1),
        reviewer: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, location, issue, reason, reviewer, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const currentFindings = await buildHostileReviewFindings(store, context.run.id, {
          generalReviewDecisions: context.decisionSet.decisions
        });
        const decisionResult = appendGeneralRiskAcceptanceDecision({
          decisionSet: context.decisionSet,
          findings: currentFindings,
          location,
          issue,
          reason,
          reviewer,
          approvalToken
        });
        return jsonToolResult(await regenerateGeneralRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General risk acceptance failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_attach_legal_passage_support",
    {
      title: "Attach Legal Passage Support",
      description: `Attach an existing legal passage to an existing legal proposition. Requires approvalToken ${LEGAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        propositionId: z.string(),
        passageId: z.string(),
        pinCite: z.string().optional(),
        reviewer: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, propositionId, passageId, pinCite, reviewer, approvalToken, baseDir }) => {
      try {
        return jsonToolResult(
          await attachLegalPassageSupport({
            store,
            baseDir,
            runId,
            propositionId,
            passageId,
            pinCite,
            reviewer,
            approvalToken
          })
        );
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Legal passage support decision failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_update_legal_source_authority",
    {
      title: "Update Legal Source Authority",
      description: `Confirm or change legal source authority classification. Requires approvalToken ${LEGAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        sourceId: z.string(),
        authorityLevel: legalAuthorityLevelSchema,
        sourceKind: legalSourceKindSchema.optional(),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, sourceId, authorityLevel, sourceKind, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadLegalDecisionContext({ store, baseDir, runId, approvalToken });
        const decisionResult = appendSourceAuthorityDecision({
          decisionSet: context.decisionSet,
          legalSourcePacket: context.legalArtifacts.legalSourcePacket,
          sourceId,
          authorityLevel,
          sourceKind,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateLegalRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Legal source authority decision failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_update_legal_source_treatment",
    {
      title: "Update Legal Source Treatment",
      description: `Update legal source treatment/currentness status. Requires approvalToken ${LEGAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        sourceId: z.string(),
        treatmentStatus: legalTreatmentStatusSchema,
        sourceStatus: legalSourceStatusSchema.optional(),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, sourceId, treatmentStatus, sourceStatus, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadLegalDecisionContext({ store, baseDir, runId, approvalToken });
        const decisionResult = appendSourceTreatmentDecision({
          decisionSet: context.decisionSet,
          legalSourcePacket: context.legalArtifacts.legalSourcePacket,
          sourceId,
          treatmentStatus,
          sourceStatus,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateLegalRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Legal source treatment decision failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_accept_legal_risk",
    {
      title: "Accept Legal Risk",
      description: `Accept or carry a current legal verification risk. Requires approvalToken ${LEGAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        location: z.string(),
        issue: z.string(),
        category: legalFindingCategorySchema.optional(),
        reason: z.string().min(1),
        reviewer: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, location, issue, category, reason, reviewer, approvalToken, baseDir }) => {
      try {
        const context = await loadLegalDecisionContext({ store, baseDir, runId, approvalToken });
        const currentFindings = await buildHostileReviewFindings(store, context.run.id, {
          legalReviewDecisions: context.decisionSet.decisions
        });
        const decisionResult = appendLegalRiskAcceptanceDecision({
          decisionSet: context.decisionSet,
          findings: currentFindings,
          location,
          issue,
          category,
          reason,
          reviewer,
          approvalToken
        });
        return jsonToolResult(await regenerateLegalRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Legal risk acceptance failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_resolve_legal_source_conflict",
    {
      title: "Resolve Legal Source Conflict",
      description: `Resolve or carry a source conflict for a legal run. Requires approvalToken ${LEGAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        conflictId: z.string(),
        resolution: z.string().min(1),
        carryAsRisk: z.boolean().default(false),
        reviewer: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, conflictId, resolution, carryAsRisk, reviewer, approvalToken, baseDir }) => {
      try {
        const context = await loadLegalDecisionContext({ store, baseDir, runId, approvalToken });
        const effectiveConflicts = applyLegalConflictReviewDecisions({
          conflicts: context.conflicts,
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendSourceConflictDecision({
          decisionSet: context.decisionSet,
          conflicts: effectiveConflicts,
          conflictId,
          resolution,
          carryAsRisk,
          reviewer,
          approvalToken
        });
        return jsonToolResult(await regenerateLegalRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Legal source conflict decision failed.");
      }
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

async function attachLegalPassageSupport(input: {
  store: EvidenceMapStore;
  baseDir: string;
  runId: string;
  propositionId: string;
  passageId: string;
  pinCite?: string;
  reviewer?: string;
  approvalToken: string;
}) {
  const context = await loadLegalDecisionContext(input);
  const decisionResult = appendAttachPassageSupportDecision({
    decisionSet: context.decisionSet,
    legalEvidenceMap: context.legalArtifacts.legalEvidenceMap,
    passages: context.legalArtifacts.legalSourcePacket.passages,
    propositionId: input.propositionId,
    passageId: input.passageId,
    pinCite: input.pinCite,
    reviewer: input.reviewer,
    approvalToken: input.approvalToken
  });
  return regenerateLegalRunAfterDecision({ ...context, decisionResult });
}

async function loadGeneralDecisionContext(input: {
  store: EvidenceMapStore;
  baseDir: string;
  runId: string;
  approvalToken: string;
}): Promise<GeneralDecisionContext> {
  const run = await input.store.getRun(input.runId);
  if (!run) throw new Error(`Unknown run: ${input.runId}`);
  if (run.profile !== "general") throw new Error("General review decisions require a general-profile run.");
  if (input.approvalToken !== GENERAL_REVIEW_APPROVAL_TOKEN) {
    throw new Error(`General review changes require approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`);
  }

  const [decisionSet, conflicts] = await Promise.all([
    readGeneralReviewDecisionSet({ baseDir: input.baseDir, run }),
    input.store.listSourceConflicts(run.id)
  ]);

  return {
    store: input.store,
    baseDir: input.baseDir,
    run,
    decisionSet,
    conflicts
  };
}

async function regenerateGeneralRunAfterDecision(input: GeneralDecisionContext & { decisionResult: GeneralDecisionResult }) {
  const findings = await input.store.replaceVerificationFindings(
    input.run.id,
    await buildHostileReviewFindings(input.store, input.run.id, { generalReviewDecisions: input.decisionResult.decisionSet.decisions })
  );
  const trustReport = await evaluateTrust(input.store, input.run.id);
  const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
  const updatedRun = await input.store.updateRunStatus(input.run.id, status);
  const [sources, inspections, conflicts, spec] = await Promise.all([
    input.store.listSources(input.run.id),
    input.store.listFileInspections(input.run.id),
    input.store.listSourceConflicts(input.run.id),
    input.store.getArtifactSpec(input.run.id)
  ]);
  if (!spec) throw new Error(`No artifact spec found for ${input.run.id}.`);
  const effectiveConflicts = applyGeneralConflictReviewDecisions({
    conflicts,
    decisions: input.decisionResult.decisionSet.decisions
  });
  const artifacts = await writeRunArtifacts({
    baseDir: input.baseDir,
    run: updatedRun,
    sources,
    inspections,
    conflicts: effectiveConflicts,
    spec,
    findings,
    trustReport,
    generalReviewDecisionSet: input.decisionResult.decisionSet
  });

  return {
    runId: updatedRun.id,
    profile: updatedRun.profile,
    status: updatedRun.status,
    readiness: trustReport.readiness,
    changed: input.decisionResult.changed,
    decision: input.decisionResult.decision ?? null,
    auditEvent: input.decisionResult.auditEvent ?? null,
    decisionCount: input.decisionResult.decisionSet.decisions.length,
    auditEventCount: input.decisionResult.decisionSet.auditEvents.length,
    findingCount: findings.length,
    blockingCount: trustReport.summary.blockingCount,
    needsReviewCount: trustReport.summary.needsReviewCount,
    artifacts
  };
}

async function loadLegalDecisionContext(input: {
  store: EvidenceMapStore;
  baseDir: string;
  runId: string;
  approvalToken: string;
}): Promise<LegalDecisionContext> {
  const run = await input.store.getRun(input.runId);
  if (!run) throw new Error(`Unknown run: ${input.runId}`);
  if (run.profile !== "legal") throw new Error("Legal review decisions require a legal-profile run.");
  if (input.approvalToken !== LEGAL_REVIEW_APPROVAL_TOKEN) {
    throw new Error(`Legal review changes require approvalToken ${LEGAL_REVIEW_APPROVAL_TOKEN}.`);
  }

  const decisionSet = await readLegalReviewDecisionSet({ baseDir: input.baseDir, run });
  const [legalArtifacts, conflicts] = await Promise.all([
    buildLegalRunArtifacts({
      store: input.store,
      run,
      reviewDecisions: decisionSet.decisions
    }),
    input.store.listSourceConflicts(run.id)
  ]);

  return {
    store: input.store,
    baseDir: input.baseDir,
    run,
    decisionSet,
    legalArtifacts,
    conflicts
  };
}

async function regenerateLegalRunAfterDecision(input: LegalDecisionContext & { decisionResult: LegalDecisionResult }) {
  const findings = await input.store.replaceVerificationFindings(
    input.run.id,
    await buildHostileReviewFindings(input.store, input.run.id, { legalReviewDecisions: input.decisionResult.decisionSet.decisions })
  );
  const trustReport = await evaluateTrust(input.store, input.run.id);
  const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
  const updatedRun = await input.store.updateRunStatus(input.run.id, status);
  const [sources, inspections, conflicts, spec] = await Promise.all([
    input.store.listSources(input.run.id),
    input.store.listFileInspections(input.run.id),
    input.store.listSourceConflicts(input.run.id),
    input.store.getArtifactSpec(input.run.id)
  ]);
  if (!spec) throw new Error(`No artifact spec found for ${input.run.id}.`);
  const effectiveConflicts = applyLegalConflictReviewDecisions({
    conflicts,
    decisions: input.decisionResult.decisionSet.decisions
  });
  const legalArtifacts = await buildLegalRunArtifacts({
    store: input.store,
    run: updatedRun,
    reviewDecisions: input.decisionResult.decisionSet.decisions
  });
  const artifacts = await writeRunArtifacts({
    baseDir: input.baseDir,
    run: updatedRun,
    sources,
    inspections,
    conflicts: effectiveConflicts,
    spec,
    findings,
    trustReport,
    legalSourcePacket: legalArtifacts.legalSourcePacket,
    legalOutputSpec: legalArtifacts.legalOutputSpec,
    legalEvidenceMap: legalArtifacts.legalEvidenceMap,
    legalDraftPropositions: legalArtifacts.legalDraftPropositions,
    legalReviewDecisionSet: input.decisionResult.decisionSet,
    legalReuseLibrary: legalArtifacts.legalReuseLibrary
  });

  return {
    runId: updatedRun.id,
    profile: updatedRun.profile,
    status: updatedRun.status,
    readiness: trustReport.readiness,
    changed: input.decisionResult.changed,
    decision: input.decisionResult.decision ?? null,
    auditEvent: input.decisionResult.auditEvent ?? null,
    decisionCount: input.decisionResult.decisionSet.decisions.length,
    auditEventCount: input.decisionResult.decisionSet.auditEvents.length,
    findingCount: findings.length,
    blockingCount: trustReport.summary.blockingCount,
    needsReviewCount: trustReport.summary.needsReviewCount,
    artifacts
  };
}

interface LegalDecisionContext {
  store: EvidenceMapStore;
  baseDir: string;
  run: EvidenceMapRun;
  decisionSet: LegalReviewDecisionSet;
  legalArtifacts: LegalRunArtifacts;
  conflicts: SourceConflict[];
}

interface LegalDecisionResult {
  decisionSet: LegalReviewDecisionSet;
  decision?: LegalReviewDecisionRecord;
  auditEvent?: LegalReviewAuditEvent;
  changed: boolean;
}

interface GeneralDecisionContext {
  store: EvidenceMapStore;
  baseDir: string;
  run: EvidenceMapRun;
  decisionSet: GeneralReviewDecisionSet;
  conflicts: SourceConflict[];
}

interface GeneralDecisionResult {
  decisionSet: GeneralReviewDecisionSet;
  decision?: GeneralReviewDecisionRecord;
  auditEvent?: GeneralReviewAuditEvent;
  changed: boolean;
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

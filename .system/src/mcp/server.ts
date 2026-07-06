import { realpath } from "node:fs/promises";
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
import { applyGeneralFinalArtifacts } from "../export/general-artifacts.ts";
import { buildGeneralFinalExport } from "../export/general.ts";
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
import { runEvidenceMapRefresh } from "../refresh/workflow.ts";
import { evaluateTrust } from "../trust/evaluate.ts";
import { artifactKinds, workflowProfiles, type EvidenceMapRun, type SourceConflict, type WorkflowProfile } from "../types.ts";
import { PACKAGE_VERSION } from "../version.ts";
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
  appendCreateClaimDecision,
  appendDeleteClaimDecision,
  appendEditClaimDecision,
  appendMergeClaimsDecision,
  appendGeneralRiskAcceptanceDecision,
  appendGeneralSourceConflictDecision,
  appendResolveCalculationRiskDecision,
  applyGeneralCalculationReviewDecisions,
  applyGeneralClaimReviewDecisions,
  applyGeneralConflictReviewDecisions,
  GENERAL_REVIEW_APPROVAL_TOKEN,
  readGeneralReviewDecisionSet,
  type GeneralReviewAuditEvent,
  type GeneralReviewDecisionRecord,
  type GeneralReviewDecisionSet
} from "../review/general-decisions.ts";
import {
  appendMarkOcrRequiredDecision,
  appendSetSourceDateDecision,
  applySourcePrepDecisionsToInspections,
  applySourcePrepDecisionsToSources,
  readSourcePrepReviewDecisionSet,
  SOURCE_PREP_APPROVAL_TOKEN,
  type SourcePrepOcrReviewPath,
  type SourcePrepReviewAuditEvent,
  type SourcePrepReviewDecisionRecord,
  type SourcePrepReviewDecisionSet
} from "../review/source-prep-decisions.ts";
import { buildHostileReviewFindings } from "../verify/hostile-review.ts";

const artifactKindSchema = z.enum(artifactKinds);
const workflowProfileSchema = z.enum(workflowProfiles);
const legalAuthorityLevelSchema = z.enum(legalAuthorityLevels);
const legalSourceKindSchema = z.enum(legalSourceKinds);
const legalFindingCategorySchema = z.enum(legalFindingCategories);
const legalTreatmentStatusSchema = z.enum(["not_checked", "checked_current", "questioned", "negative", "superseded"]);
const legalSourceStatusSchema = z.enum(["current", "superseded", "background", "draft", "unknown"]);
const generalClaimReviewStatusSchema = z.enum(["needs_review", "verified"]);
const generalReviewStatusSchema = z.enum(["unreviewed", "needs_review", "verified", "unsupported", "conflicting"]);
const generalCalculationReviewStatusSchema = z.enum(["needs_review", "verified"]);
const sourcePrepOcrReviewPathSchema = z.enum(["ocr_required", "replacement_required", "manual_review_required"]);
type ResolvedWorkspaceInputPaths = { paths: string[] } | { error: string };

export function createEvidenceMapMcpServer(store: EvidenceMapStore = createDefaultMcpStore()) {
  const defaultBaseDir = getDefaultBaseDir();
  const server = new McpServer({
    name: "evidence-map",
    version: PACKAGE_VERSION
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
      try {
        const resolvedInputPaths = await resolveWorkspaceInputPaths(baseDir, inputPaths);
        if (hasWorkspaceInputPathError(resolvedInputPaths)) return jsonToolError(resolvedInputPaths.error);
        const packet = await buildSourcePacket(resolvedInputPaths.paths, { baseDir });
        return jsonToolResult(await withLegalSourcePacket(packet, profile));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Source packet inspection failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_run_workflow",
    {
      title: "Run Evidence Map Workflow",
      description: "Run source prep, artifact spec, hostile verification, trust evaluation, local review artifacts, and optionally generated Markdown output.",
      inputSchema: {
        name: z.string(),
        artifactKind: artifactKindSchema,
        profile: workflowProfileSchema.default("general"),
        generate: z.boolean().default(false),
        inputPaths: z.array(z.string()).min(1),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ name, artifactKind, profile, generate, inputPaths, baseDir }) => {
      try {
        const resolvedInputPaths = await resolveWorkspaceInputPaths(baseDir, inputPaths);
        if (hasWorkspaceInputPathError(resolvedInputPaths)) return jsonToolError(resolvedInputPaths.error);
        const result = await runEvidenceMapWorkflow(store, {
          baseDir,
          name,
          artifactKind,
          profile,
          inputPaths: resolvedInputPaths.paths,
          generate
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
          generatedOutput: result.generatedOutput
            ? {
                status: result.generatedOutput.status,
                format: result.generatedOutput.format,
                pathRelativeToRun: result.generatedOutput.pathRelativeToRun,
                formattedPathRelativeToRun: result.generatedOutput.status === "export_ready" ? "04_export/formatted-output.md" : undefined,
                formattingReceiptPathRelativeToRun: result.generatedOutput.status === "export_ready" ? "04_export/formatting-receipt.json" : undefined,
                evidenceMapId: result.generatedOutput.evidenceMapId,
                generatedClaimCount: result.generatedClaims?.length ?? 0,
                selectedEvidenceCount: result.sourceEvidence?.filter((item) => item.useStatus === "selected").length ?? 0,
                excludedEvidenceCount: result.sourceEvidence?.filter((item) => item.useStatus === "excluded").length ?? 0,
                excludedSourceCount: result.sourceExclusions?.length ?? 0
              }
            : null,
          artifacts: result.artifacts
        });
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Workflow run failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_refresh_workflow",
    {
      title: "Refresh Evidence Map Workflow",
      description: "Create a new run from a prior run, snapshot prior review-trail artifacts, and run the workflow over supplied current inputs.",
      inputSchema: {
        priorRunId: z.string(),
        name: z.string(),
        artifactKind: artifactKindSchema,
        profile: workflowProfileSchema.default("general"),
        generate: z.boolean().default(false),
        inputPaths: z.array(z.string()).min(1),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ priorRunId, name, artifactKind, profile, generate, inputPaths, baseDir }) => {
      try {
        const resolvedInputPaths = await resolveWorkspaceInputPaths(baseDir, inputPaths);
        if (hasWorkspaceInputPathError(resolvedInputPaths)) return jsonToolError(resolvedInputPaths.error);
        const result = await runEvidenceMapRefresh(store, {
          baseDir,
          priorRunId,
          name,
          artifactKind,
          profile,
          inputPaths: resolvedInputPaths.paths,
          generate
        });
        return jsonToolResult({
          priorRunId: result.refreshReceipt.priorRunId,
          runId: result.run.id,
          slug: result.run.slug,
          status: result.run.status,
          readiness: result.trustReport.readiness,
          carriedArtifactCount: result.refreshReceipt.carriedArtifacts.length,
          refreshReceipt: "00_refresh/refresh-receipt.json",
          artifacts: result.artifacts
        });
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Refresh workflow failed.");
      }
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

      const [
        sources,
        inspections,
        conflicts,
        assumptions,
        claims,
        calculations,
        sourceEvidence,
        generatedClaims,
        evidenceLinkSuggestions,
        evidenceMap,
        generatedOutput,
        findings,
        trustReport
      ] = await Promise.all([
        store.listSources(runId),
        store.listFileInspections(runId),
        store.listSourceConflicts(runId),
        store.listAssumptions(runId),
        store.listClaims(runId),
        store.listCalculations(runId),
        store.listSourceEvidence(runId),
        store.listGeneratedClaims(runId),
        store.listEvidenceLinkSuggestions(runId),
        store.getEvidenceMap(runId),
        store.getGeneratedOutput(runId),
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
          sourceEvidence: sourceEvidence.length,
          generatedClaims: generatedClaims.length,
          evidenceLinkSuggestions: evidenceLinkSuggestions.length,
          findings: findings.length
        },
        evidenceMap,
        generatedOutput,
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
    "evidencemap_get_evidence_link_suggestions",
    {
      title: "Get Evidence Link Suggestions",
      description: "Return deterministic source-to-claim link suggestions for a run.",
      inputSchema: {
        runId: z.string()
      }
    },
    async ({ runId }) => {
      const run = await store.getRun(runId);
      if (!run) throw new Error(`Unknown run: ${runId}`);
      const suggestions = await store.listEvidenceLinkSuggestions(runId);
      return jsonToolResult({
        runId,
        suggestionCount: suggestions.length,
        suggestions
      });
    }
  );

  server.registerTool(
    "evidencemap_set_source_date",
    {
      title: "Set Source Date",
      description: `Attach an audited source date to an existing source. Requires approvalToken ${SOURCE_PREP_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        sourceId: z.string(),
        sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reason: z.string().min(1),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, sourceId, sourceDate, reason, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadSourcePrepDecisionContext({ store, baseDir, runId, approvalToken });
        const sources = applySourcePrepDecisionsToSources({
          sources: await store.listSources(runId),
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendSetSourceDateDecision({
          decisionSet: context.decisionSet,
          sources,
          sourceId,
          sourceDate,
          reason,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateRunAfterSourcePrepDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "Source-date decision failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_mark_source_ocr_required",
    {
      title: "Mark Source OCR Required",
      description: `Record that a no-text PDF needs OCR, replacement, or manual OCR review. Requires approvalToken ${SOURCE_PREP_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        sourceId: z.string(),
        reviewPath: sourcePrepOcrReviewPathSchema.default("ocr_required"),
        reason: z.string().min(1),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, sourceId, reviewPath, reason, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadSourcePrepDecisionContext({ store, baseDir, runId, approvalToken });
        const [sources, inspections] = await Promise.all([
          store.listSources(runId),
          store.listFileInspections(runId)
        ]);
        const decisionResult = appendMarkOcrRequiredDecision({
          decisionSet: context.decisionSet,
          sources,
          inspections,
          sourceId,
          reviewPath: reviewPath as SourcePrepOcrReviewPath,
          reason,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateRunAfterSourcePrepDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "OCR source-prep decision failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_create_general_claim",
    {
      title: "Create General Claim",
      description: `Create an explicit general-profile claim as an audited review decision. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        artifactLocation: z.string().min(1),
        claim: z.string().min(1),
        sourceIds: z.array(z.string()).default([]),
        assumptions: z.array(z.string()).default([]),
        transformation: z.string().optional(),
        reviewStatus: generalReviewStatusSchema.default("needs_review"),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, artifactLocation, claim, sourceIds, assumptions, transformation, reviewStatus, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const [storedClaims, sources] = await Promise.all([store.listClaims(runId), store.listSources(runId)]);
        const effectiveClaims = applyGeneralClaimReviewDecisions({
          claims: storedClaims,
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendCreateClaimDecision({
          decisionSet: context.decisionSet,
          claims: effectiveClaims,
          sources,
          artifactLocation,
          claim,
          sourceIds,
          assumptions,
          transformation,
          reviewStatus,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateGeneralRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General claim creation failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_edit_general_claim",
    {
      title: "Edit General Claim",
      description: `Edit an existing general-profile claim as an audited review decision. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        claimId: z.string(),
        artifactLocation: z.string().optional(),
        claim: z.string().optional(),
        sourceIds: z.array(z.string()).optional(),
        assumptions: z.array(z.string()).optional(),
        transformation: z.string().optional(),
        reviewStatus: generalReviewStatusSchema.optional(),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, claimId, artifactLocation, claim, sourceIds, assumptions, transformation, reviewStatus, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const [storedClaims, sources] = await Promise.all([store.listClaims(runId), store.listSources(runId)]);
        const effectiveClaims = applyGeneralClaimReviewDecisions({
          claims: storedClaims,
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendEditClaimDecision({
          decisionSet: context.decisionSet,
          claims: effectiveClaims,
          sources,
          claimId,
          artifactLocation,
          claim,
          sourceIds,
          assumptions,
          transformation,
          reviewStatus,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateGeneralRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General claim edit failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_delete_general_claim",
    {
      title: "Delete General Claim",
      description: `Delete a general-profile claim from the effective review set as an audited decision. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        claimId: z.string(),
        reason: z.string().min(1),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, claimId, reason, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const storedClaims = await store.listClaims(runId);
        const claims = applyGeneralClaimReviewDecisions({
          claims: storedClaims,
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendDeleteClaimDecision({
          decisionSet: context.decisionSet,
          claims,
          claimId,
          reason,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateGeneralRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General claim deletion failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_merge_general_claims",
    {
      title: "Merge General Claims",
      description: `Merge general-profile claims in the effective review set as an audited decision. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        targetClaimId: z.string(),
        mergedClaimIds: z.array(z.string()).min(1),
        claim: z.string().optional(),
        sourceIds: z.array(z.string()).optional(),
        assumptions: z.array(z.string()).optional(),
        transformation: z.string().optional(),
        reviewStatus: generalReviewStatusSchema.optional(),
        reason: z.string().min(1),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({
      runId,
      targetClaimId,
      mergedClaimIds,
      claim,
      sourceIds,
      assumptions,
      transformation,
      reviewStatus,
      reason,
      reviewer,
      notes,
      approvalToken,
      baseDir
    }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const [storedClaims, sources] = await Promise.all([store.listClaims(runId), store.listSources(runId)]);
        const claims = applyGeneralClaimReviewDecisions({
          claims: storedClaims,
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendMergeClaimsDecision({
          decisionSet: context.decisionSet,
          claims,
          sources,
          targetClaimId,
          mergedClaimIds,
          claim,
          sourceIds,
          assumptions,
          transformation,
          reviewStatus,
          reason,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateGeneralRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General claim merge failed.");
      }
    }
  );

  server.registerTool(
    "evidencemap_resolve_calculation_risk",
    {
      title: "Resolve Calculation Risk",
      description: `Resolve one or more calculation risk flags for a general-profile run. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        calculationId: z.string(),
        riskFlags: z.array(z.string()).min(1),
        inputs: z.array(z.string()).default([]),
        resolution: z.string().min(1),
        reviewStatus: generalCalculationReviewStatusSchema.default("verified"),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, calculationId, riskFlags, inputs, resolution, reviewStatus, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const storedCalculations = await store.listCalculations(runId);
        const effectiveCalculations = applyGeneralCalculationReviewDecisions({
          calculations: storedCalculations,
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendResolveCalculationRiskDecision({
          decisionSet: context.decisionSet,
          calculations: effectiveCalculations,
          calculationId,
          riskFlags,
          inputs,
          resolution,
          reviewStatus,
          reviewer,
          notes,
          approvalToken
        });
        return jsonToolResult(await regenerateGeneralRunAfterDecision({ ...context, decisionResult }));
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General calculation risk resolution failed.");
      }
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
        evidenceAnchor: z.string().optional(),
        evidenceQuote: z.string().optional(),
        rationale: z.string().optional(),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, claimId, sourceId, reviewStatus, evidenceAnchor, evidenceQuote, rationale, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const [storedClaims, sources] = await Promise.all([store.listClaims(runId), store.listSources(runId)]);
        const claims = applyGeneralClaimReviewDecisions({
          claims: storedClaims,
          decisions: context.decisionSet.decisions
        });
        const decisionResult = appendAttachClaimSourceDecision({
          decisionSet: context.decisionSet,
          claims,
          sources,
          claimId,
          sourceId,
          reviewStatus,
          evidenceAnchor,
          evidenceQuote,
          rationale,
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
          generalReviewDecisions: context.decisionSet.decisions,
          sourcePrepReviewDecisions: context.sourcePrepDecisionSet.decisions
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
    "evidencemap_apply_general_final_artifacts",
    {
      title: "Apply General Final Artifacts",
      description: `Preview or copy approved user-supplied final artifacts into 04_export when a general run is ready. Requires approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`,
      inputSchema: {
        runId: z.string(),
        artifactPaths: z.array(z.string()).min(1),
        dryRun: z.boolean().default(false),
        reviewer: z.string().optional(),
        notes: z.string().optional(),
        approvalToken: z.string(),
        baseDir: z.string().default(defaultBaseDir)
      }
    },
    async ({ runId, artifactPaths, dryRun, reviewer, notes, approvalToken, baseDir }) => {
      try {
        const context = await loadGeneralDecisionContext({ store, baseDir, runId, approvalToken });
        const [sources, inspections, conflicts, spec, findings, trustReport] = await Promise.all([
          store.listSources(runId),
          store.listFileInspections(runId),
          store.listSourceConflicts(runId),
          store.getArtifactSpec(runId),
          store.listVerificationFindings(runId),
          store.getLatestTrustReport(runId)
        ]);
        if (!spec) throw new Error(`No artifact spec found for ${runId}.`);
        if (!trustReport) throw new Error(`No trust report found for ${runId}.`);
        const effectiveSources = applySourcePrepDecisionsToSources({
          sources,
          decisions: context.sourcePrepDecisionSet.decisions
        });
        const effectiveInspections = applySourcePrepDecisionsToInspections({
          inspections,
          decisions: context.sourcePrepDecisionSet.decisions
        });
        const effectiveConflicts = applyGeneralConflictReviewDecisions({
          conflicts,
          decisions: context.decisionSet.decisions
        });
        const generalExport = buildGeneralFinalExport({
          run: context.run,
          sources: effectiveSources,
          inspections: effectiveInspections,
          conflicts: effectiveConflicts,
          spec,
          findings,
          trustReport,
          generalReviewDecisionSet: context.decisionSet
        });
        if (!generalExport.ready || !generalExport.readyManifest) {
          throw new Error(`General final artifact apply requires ready gates. Unresolved blockers: ${generalExport.blockers.join(" | ")}`);
        }
        return jsonToolResult(
          await applyGeneralFinalArtifacts({
            baseDir,
            run: context.run,
            artifactPaths,
            readyManifest: generalExport.readyManifest,
            dryRun,
            reviewer,
            notes
          })
        );
      } catch (error) {
        return jsonToolError(error instanceof Error ? error.message : "General final artifact apply failed.");
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
          legalReviewDecisions: context.decisionSet.decisions,
          sourcePrepReviewDecisions: context.sourcePrepDecisionSet.decisions
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
async function resolveWorkspaceInputPaths(baseDir: string, inputPaths: string[]): Promise<ResolvedWorkspaceInputPaths> {
  const resolvedBaseDir = resolve(baseDir);
  const realBaseDir = await realpath(resolvedBaseDir);
  const paths: string[] = [];
  for (const inputPath of inputPaths) {
    const resolvedInputPath = resolve(resolvedBaseDir, inputPath);
    const relativePath = relative(resolvedBaseDir, resolvedInputPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return { error: `Input path escapes baseDir: ${inputPath}` };
    }
    const realInputPath = await realpath(resolvedInputPath);
    const realRelativePath = relative(realBaseDir, realInputPath);
    if (realRelativePath.startsWith("..") || isAbsolute(realRelativePath)) {
      return { error: `Input path ${inputPath} real path escapes baseDir: ${realInputPath}` };
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

async function loadSourcePrepDecisionContext(input: {
  store: EvidenceMapStore;
  baseDir: string;
  runId: string;
  approvalToken: string;
}): Promise<SourcePrepDecisionContext> {
  const run = await input.store.getRun(input.runId);
  if (!run) throw new Error(`Unknown run: ${input.runId}`);
  if (input.approvalToken !== SOURCE_PREP_APPROVAL_TOKEN) {
    throw new Error(`Source-prep review changes require approvalToken ${SOURCE_PREP_APPROVAL_TOKEN}.`);
  }

  const decisionSet = await readSourcePrepReviewDecisionSet({ baseDir: input.baseDir, run });
  return {
    store: input.store,
    baseDir: input.baseDir,
    run,
    decisionSet
  };
}

async function regenerateRunAfterSourcePrepDecision(input: SourcePrepDecisionContext & { decisionResult: SourcePrepDecisionResult }) {
  const legalReviewDecisionSet =
    input.run.profile === "legal" ? await readLegalReviewDecisionSet({ baseDir: input.baseDir, run: input.run }) : undefined;
  const generalReviewDecisionSet =
    input.run.profile === "general" ? await readGeneralReviewDecisionSet({ baseDir: input.baseDir, run: input.run }) : undefined;
  const findings = await input.store.replaceVerificationFindings(
    input.run.id,
    await buildHostileReviewFindings(input.store, input.run.id, {
      legalReviewDecisions: legalReviewDecisionSet?.decisions,
      generalReviewDecisions: generalReviewDecisionSet?.decisions,
      sourcePrepReviewDecisions: input.decisionResult.decisionSet.decisions
    })
  );
  const [sources, inspections, conflicts, spec] = await Promise.all([
    input.store.listSources(input.run.id),
    input.store.listFileInspections(input.run.id),
    input.store.listSourceConflicts(input.run.id),
    input.store.getArtifactSpec(input.run.id)
  ]);
  if (!spec) throw new Error(`No artifact spec found for ${input.run.id}.`);
  const effectiveConflicts =
    input.run.profile === "legal" && legalReviewDecisionSet
      ? applyLegalConflictReviewDecisions({ conflicts, decisions: legalReviewDecisionSet.decisions })
      : input.run.profile === "general" && generalReviewDecisionSet
        ? applyGeneralConflictReviewDecisions({ conflicts, decisions: generalReviewDecisionSet.decisions })
        : conflicts;
  const trustReport = await evaluateTrust(input.store, input.run.id, { sourceConflicts: effectiveConflicts });
  const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
  const updatedRun = await input.store.updateRunStatus(input.run.id, status);
  const legalArtifacts =
    updatedRun.profile === "legal"
      ? await buildLegalRunArtifacts({
          store: input.store,
          run: updatedRun,
          reviewDecisions: legalReviewDecisionSet?.decisions,
          sourcePrepReviewDecisions: input.decisionResult.decisionSet.decisions
        })
      : undefined;
  const artifacts = await writeRunArtifacts({
    baseDir: input.baseDir,
    run: updatedRun,
    sources,
    inspections,
    conflicts: effectiveConflicts,
    spec,
    findings,
    trustReport,
    legalSourcePacket: legalArtifacts?.legalSourcePacket,
    legalOutputSpec: legalArtifacts?.legalOutputSpec,
    legalEvidenceMap: legalArtifacts?.legalEvidenceMap,
    legalDraftPropositions: legalArtifacts?.legalDraftPropositions,
    legalReviewDecisionSet,
    legalReuseLibrary: legalArtifacts?.legalReuseLibrary,
    generalReviewDecisionSet,
    sourcePrepReviewDecisionSet: input.decisionResult.decisionSet
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
  const sourcePrepDecisionSet = await readSourcePrepReviewDecisionSet({ baseDir: input.baseDir, run });

  return {
    store: input.store,
    baseDir: input.baseDir,
    run,
    decisionSet,
    conflicts,
    sourcePrepDecisionSet
  };
}

async function regenerateGeneralRunAfterDecision(input: GeneralDecisionContext & { decisionResult: GeneralDecisionResult }) {
  const findings = await input.store.replaceVerificationFindings(
    input.run.id,
    await buildHostileReviewFindings(input.store, input.run.id, {
      generalReviewDecisions: input.decisionResult.decisionSet.decisions,
      sourcePrepReviewDecisions: input.sourcePrepDecisionSet.decisions
    })
  );
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
  const trustReport = await evaluateTrust(input.store, input.run.id, { sourceConflicts: effectiveConflicts });
  const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
  const updatedRun = await input.store.updateRunStatus(input.run.id, status);
  const artifacts = await writeRunArtifacts({
    baseDir: input.baseDir,
    run: updatedRun,
    sources,
    inspections,
    conflicts: effectiveConflicts,
    spec,
    findings,
    trustReport,
    generalReviewDecisionSet: input.decisionResult.decisionSet,
    sourcePrepReviewDecisionSet: input.sourcePrepDecisionSet
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
  const sourcePrepDecisionSet = await readSourcePrepReviewDecisionSet({ baseDir: input.baseDir, run });
  const [legalArtifacts, conflicts] = await Promise.all([
    buildLegalRunArtifacts({
      store: input.store,
      run,
      reviewDecisions: decisionSet.decisions,
      sourcePrepReviewDecisions: sourcePrepDecisionSet.decisions
    }),
    input.store.listSourceConflicts(run.id)
  ]);

  return {
    store: input.store,
    baseDir: input.baseDir,
    run,
    decisionSet,
    legalArtifacts,
    conflicts,
    sourcePrepDecisionSet
  };
}

async function regenerateLegalRunAfterDecision(input: LegalDecisionContext & { decisionResult: LegalDecisionResult }) {
  const findings = await input.store.replaceVerificationFindings(
    input.run.id,
    await buildHostileReviewFindings(input.store, input.run.id, {
      legalReviewDecisions: input.decisionResult.decisionSet.decisions,
      sourcePrepReviewDecisions: input.sourcePrepDecisionSet.decisions
    })
  );
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
  const trustReport = await evaluateTrust(input.store, input.run.id, { sourceConflicts: effectiveConflicts });
  const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
  const updatedRun = await input.store.updateRunStatus(input.run.id, status);
  const legalArtifacts = await buildLegalRunArtifacts({
    store: input.store,
    run: updatedRun,
    reviewDecisions: input.decisionResult.decisionSet.decisions,
    sourcePrepReviewDecisions: input.sourcePrepDecisionSet.decisions
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
    legalReuseLibrary: legalArtifacts.legalReuseLibrary,
    sourcePrepReviewDecisionSet: input.sourcePrepDecisionSet
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
  sourcePrepDecisionSet: SourcePrepReviewDecisionSet;
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
  sourcePrepDecisionSet: SourcePrepReviewDecisionSet;
}

interface GeneralDecisionResult {
  decisionSet: GeneralReviewDecisionSet;
  decision?: GeneralReviewDecisionRecord;
  auditEvent?: GeneralReviewAuditEvent;
  changed: boolean;
}

interface SourcePrepDecisionContext {
  store: EvidenceMapStore;
  baseDir: string;
  run: EvidenceMapRun;
  decisionSet: SourcePrepReviewDecisionSet;
}

interface SourcePrepDecisionResult {
  decisionSet: SourcePrepReviewDecisionSet;
  decision?: SourcePrepReviewDecisionRecord;
  auditEvent?: SourcePrepReviewAuditEvent;
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

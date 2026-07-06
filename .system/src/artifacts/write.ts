import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtifactSpec,
  EvidenceMapRecord,
  FileInspectionRecord,
  GeneratedClaimRecord,
  GeneratedOutputRecord,
  SourceConflict,
  SourceEvidenceRecord,
  SourceRecord,
  EvidenceMapRun,
  TrustReport,
  VerificationFinding
} from "../types.ts";
import type { SourceExclusion } from "../evidence/select.ts";
import { buildGeneralFinalExport } from "../export/general.ts";
import {
  renderEvidenceMapMarkdown,
  renderGeneratedClaimsMarkdown,
  renderSourceEvidenceMarkdown
} from "../generate/markdown.ts";
import { renderLegalDraftPropositions } from "../legal/draft.ts";
import { renderLegalEvidenceMap } from "../legal/evidence-map.ts";
import { buildLegalFinalExport } from "../legal/export.ts";
import { renderLegalReviewDecisionSet } from "../legal/review-decisions.ts";
import { renderLegalBoundary, renderLegalReuseLibrary, renderLegalSourceHistory } from "../legal/reuse-library.ts";
import { renderLegalOutputSpec } from "../legal/spec.ts";
import { renderLegalSourcePacket, type LegalSourcePacket } from "../legal/source-packet.ts";
import { renderGeneralReviewDecisionSet, type GeneralReviewDecisionSet } from "../review/general-decisions.ts";
import { buildReviewQueue, renderReviewQueue } from "../review/review-queue.ts";
import {
  applySourcePrepDecisionsToInspections,
  applySourcePrepDecisionsToSources,
  emptySourcePrepReviewDecisionSet,
  renderSourcePrepReviewDecisionSet,
  type SourcePrepReviewDecisionSet
} from "../review/source-prep-decisions.ts";
import type { LegalEvidenceMap, LegalOutputSpec, LegalPropositionRecord, LegalReuseLibrary, LegalReviewDecisionSet } from "../legal/types.ts";

export async function writeRunArtifacts(input: {
  baseDir: string;
  run: EvidenceMapRun;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
  conflicts: SourceConflict[];
  spec: ArtifactSpec;
  findings: VerificationFinding[];
  trustReport: TrustReport;
  sourceEvidence?: SourceEvidenceRecord[];
  generatedClaims?: GeneratedClaimRecord[];
  evidenceMap?: EvidenceMapRecord;
  generatedOutput?: GeneratedOutputRecord;
  sourceExclusions?: SourceExclusion[];
  legalSourcePacket?: LegalSourcePacket;
  legalOutputSpec?: LegalOutputSpec;
  legalEvidenceMap?: LegalEvidenceMap;
  legalDraftPropositions?: LegalPropositionRecord[];
  legalReviewDecisionSet?: LegalReviewDecisionSet;
  legalReuseLibrary?: LegalReuseLibrary;
  generalReviewDecisionSet?: GeneralReviewDecisionSet;
  sourcePrepReviewDecisionSet?: SourcePrepReviewDecisionSet;
}) {
  const runDir = join(input.baseDir, "deliverables", input.run.slug);
  const sourceDir = join(runDir, "01_source-packet");
  const specDir = join(runDir, "02_artifact-spec");
  const verifyDir = join(runDir, "03_verification");
  const exportDir = join(runDir, "04_export");
  const sourcePrepReviewDecisionSet = input.sourcePrepReviewDecisionSet ?? emptySourcePrepReviewDecisionSet(input.run.id);
  const sources = applySourcePrepDecisionsToSources({
    sources: input.sources,
    decisions: sourcePrepReviewDecisionSet.decisions
  });
  const inspections = applySourcePrepDecisionsToInspections({
    inspections: input.inspections,
    decisions: sourcePrepReviewDecisionSet.decisions
  });
  await Promise.all([sourceDir, specDir, verifyDir, exportDir].map((dir) => mkdir(dir, { recursive: true })));

  await writeJson(join(runDir, "run.json"), input.run);
  await writeJson(join(sourceDir, "source-inventory.json"), sources);
  await writeJson(join(sourceDir, "file-inspections.json"), inspections);
  await writeJson(join(sourceDir, "source-conflicts.json"), input.conflicts);
  await writeFile(join(sourceDir, "source-packet.md"), renderSourcePacket(sources, inspections, input.conflicts));
  if (input.sourceEvidence) {
    await writeJson(join(sourceDir, "source-evidence.json"), input.sourceEvidence);
    await writeFile(join(sourceDir, "source-evidence.md"), renderSourceEvidenceMarkdown(input.sourceEvidence));
  }
  if (input.legalSourcePacket) {
    await writeJson(join(sourceDir, "legal-source-packet.json"), input.legalSourcePacket);
    await writeJson(join(sourceDir, "legal-passages.json"), input.legalSourcePacket.passages);
    await writeFile(join(sourceDir, "legal-source-packet.md"), renderLegalSourcePacket(input.legalSourcePacket));
  }
  if (input.legalReuseLibrary) {
    await writeJson(join(sourceDir, "legal-source-history.json"), input.legalReuseLibrary.sourceVersions);
    await writeFile(join(sourceDir, "legal-source-history.md"), renderLegalSourceHistory(input.legalReuseLibrary));
  }

  await writeJson(join(specDir, "artifact-spec.json"), input.spec);
  await writeFile(join(specDir, "artifact-spec.md"), renderSpec(input.spec));
  if (input.legalOutputSpec) {
    await writeJson(join(specDir, "legal-output-spec.json"), input.legalOutputSpec);
    await writeFile(join(specDir, "legal-output-spec.md"), renderLegalOutputSpec(input.legalOutputSpec));
  }
  if (input.legalReuseLibrary) {
    await writeJson(join(specDir, "legal-boundary.json"), input.legalReuseLibrary.boundary);
    await writeFile(join(specDir, "legal-boundary.md"), renderLegalBoundary(input.legalReuseLibrary.boundary));
  }

  await writeJson(join(verifyDir, "verification-findings.json"), input.findings);
  await writeJson(join(verifyDir, "source-prep-decisions.json"), sourcePrepReviewDecisionSet);
  await writeFile(join(verifyDir, "source-prep-decisions.md"), renderSourcePrepReviewDecisionSet(sourcePrepReviewDecisionSet));
  const reviewQueue = buildReviewQueue({
    run: input.run,
    sources,
    inspections,
    conflicts: input.conflicts,
    findings: input.findings,
    trustReport: input.trustReport,
    legalSourcePacket: input.legalSourcePacket,
    sourcePrepReviewDecisionSet
  });
  await writeJson(join(verifyDir, "review-queue.json"), reviewQueue);
  await writeFile(join(verifyDir, "review-queue.md"), renderReviewQueue(reviewQueue));
  if (input.generatedClaims) {
    await writeJson(join(verifyDir, "generated-claims.json"), input.generatedClaims);
    await writeFile(join(verifyDir, "generated-claims.md"), renderGeneratedClaimsMarkdown(input.generatedClaims));
  }
  if (input.evidenceMap && input.generatedClaims && input.sourceEvidence) {
    await writeJson(join(verifyDir, "evidence-map.json"), input.evidenceMap);
    await writeFile(
      join(verifyDir, "evidence-map.md"),
      renderEvidenceMapMarkdown({
        evidenceMap: input.evidenceMap,
        sourceEvidence: input.sourceEvidence,
        generatedClaims: input.generatedClaims
      })
    );
  }
  if (input.legalEvidenceMap) {
    await writeJson(join(verifyDir, "legal-evidence-map.json"), input.legalEvidenceMap);
    await writeFile(join(verifyDir, "legal-evidence-map.md"), renderLegalEvidenceMap(input.legalEvidenceMap));
  }
  if (input.legalDraftPropositions) {
    await writeJson(join(verifyDir, "legal-draft-propositions.json"), input.legalDraftPropositions);
    await writeFile(join(verifyDir, "legal-draft-propositions.md"), renderLegalDraftPropositions(input.legalDraftPropositions));
  }
  if (input.legalReviewDecisionSet) {
    await writeJson(join(verifyDir, "legal-review-decisions.json"), input.legalReviewDecisionSet);
    await writeFile(join(verifyDir, "legal-review-decisions.md"), renderLegalReviewDecisionSet(input.legalReviewDecisionSet));
  }
  if (input.legalReuseLibrary) {
    await writeJson(join(verifyDir, "legal-reuse-library.json"), input.legalReuseLibrary);
    await writeFile(join(verifyDir, "legal-reuse-library.md"), renderLegalReuseLibrary(input.legalReuseLibrary));
  }
  if (input.generalReviewDecisionSet) {
    await writeJson(join(verifyDir, "general-review-decisions.json"), input.generalReviewDecisionSet);
    await writeFile(join(verifyDir, "general-review-decisions.md"), renderGeneralReviewDecisionSet(input.generalReviewDecisionSet));
  }
  await writeJson(join(verifyDir, "trust-report.json"), input.trustReport);
  await writeFile(join(verifyDir, "verification-report.md"), renderVerification(input.findings, input.trustReport));

  if (input.legalSourcePacket && input.legalOutputSpec && input.legalEvidenceMap) {
    const legalExport = buildLegalFinalExport({
      run: input.run,
      legalSourcePacket: input.legalSourcePacket,
      legalOutputSpec: input.legalOutputSpec,
      legalEvidenceMap: input.legalEvidenceMap,
      findings: input.findings,
      trustReport: input.trustReport,
      conflicts: input.conflicts,
      legalReviewDecisionSet: input.legalReviewDecisionSet
    });
    await writeFile(join(exportDir, "README.md"), legalExport.readmeMarkdown);
    if (legalExport.ready && legalExport.finalMarkdown) {
      await writeFile(join(exportDir, "final-legal.md"), legalExport.finalMarkdown);
      await rm(join(exportDir, "legal-export-refusal.md"), { force: true });
    } else if (legalExport.refusalMarkdown) {
      await writeFile(join(exportDir, "legal-export-refusal.md"), legalExport.refusalMarkdown);
      await rm(join(exportDir, "final-legal.md"), { force: true });
    }
  } else {
    const generalExport = buildGeneralFinalExport({
      run: input.run,
      sources,
      inspections,
      conflicts: input.conflicts,
      spec: input.spec,
      findings: input.findings,
      trustReport: input.trustReport,
      generalReviewDecisionSet: input.generalReviewDecisionSet,
      outputMode: input.generatedOutput ? "generate" : "review",
      sourceEvidence: input.sourceEvidence,
      generatedClaims: input.generatedClaims,
      evidenceMap: input.evidenceMap,
      generatedOutput: input.generatedOutput,
      sourceExclusions: input.sourceExclusions ?? []
    });
    await writeFile(join(exportDir, "README.md"), generalExport.readmeMarkdown);
    if (generalExport.ready && generalExport.readyManifest && generalExport.readyManifestMarkdown) {
      await writeJson(join(exportDir, "ready-manifest.json"), generalExport.readyManifest);
      await writeFile(join(exportDir, "ready-manifest.md"), generalExport.readyManifestMarkdown);
      if (generalExport.generatedFinalMarkdown && generalExport.generatedOutputReceipt && generalExport.generatedOutputReceiptMarkdown) {
        await writeFile(join(exportDir, "final-output.md"), generalExport.generatedFinalMarkdown);
        await writeJson(join(exportDir, "generated-output-receipt.json"), generalExport.generatedOutputReceipt);
        await writeFile(join(exportDir, "generated-output-receipt.md"), generalExport.generatedOutputReceiptMarkdown);
      }
      if (generalExport.formattedOutputMarkdown && generalExport.formattingReceipt && generalExport.formattingReceiptMarkdown) {
        await writeFile(join(exportDir, "formatted-output.md"), generalExport.formattedOutputMarkdown);
        await writeJson(join(exportDir, "formatting-receipt.json"), generalExport.formattingReceipt);
        await writeFile(join(exportDir, "formatting-receipt.md"), generalExport.formattingReceiptMarkdown);
      }
      await rm(join(exportDir, "general-export-refusal.md"), { force: true });
    } else if (generalExport.refusalMarkdown) {
      await writeFile(join(exportDir, "general-export-refusal.md"), generalExport.refusalMarkdown);
      await rm(join(exportDir, "ready-manifest.json"), { force: true });
      await rm(join(exportDir, "ready-manifest.md"), { force: true });
      await rm(join(exportDir, "final-output.md"), { force: true });
      await rm(join(exportDir, "generated-output-receipt.json"), { force: true });
      await rm(join(exportDir, "generated-output-receipt.md"), { force: true });
      await rm(join(exportDir, "formatted-output.md"), { force: true });
      await rm(join(exportDir, "formatting-receipt.json"), { force: true });
      await rm(join(exportDir, "formatting-receipt.md"), { force: true });
    }
  }

  return { runDir, sourceDir, specDir, verifyDir, exportDir };
}

function writeJson(path: string, value: unknown) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function renderSourcePacket(sources: SourceRecord[], inspections: FileInspectionRecord[], conflicts: SourceConflict[]) {
  const sourceRows = sources.map((source) => `| ${source.id} | ${source.name} | ${source.fileType} | ${source.status} | ${source.sourceDate ?? ""} | ${source.intendedUse} |`).join("\n");
  const inspectionRows = inspections.length
    ? inspections.map((inspection) => `| ${inspection.sourceId ?? ""} | ${inspection.parser} | ${inspection.status} | ${inspection.sourceDateCandidates.join(", ")} | ${inspection.warnings.join(" ")} |`).join("\n")
    : "| none |  |  |  |  |";
  const conflictRows = conflicts.length
    ? conflicts.map((conflict) => `| ${conflict.severity} | ${conflict.status} | ${conflict.sourceIds.join(", ")} | ${conflict.description} |`).join("\n")
    : "| none | resolved |  | No inferred conflicts. |";
  return `# Source Packet

## Source Inventory

| ID | Name | Type | Status | Date | Intended use |
|---|---|---|---|---|---|
${sourceRows || "| none |  |  |  |  |  |"}

## File Inspections

| Source ID | Parser | Status | Date candidates | Warnings |
|---|---|---|---|---|
${inspectionRows}

## Conflict Log

| Severity | Status | Source IDs | Description |
|---|---|---|---|
${conflictRows}
`;
}

function renderSpec(spec: ArtifactSpec) {
  return `# Artifact Specification

Audience: ${spec.audience}

Decision context: ${spec.decisionContext}

Narrative spine: ${spec.narrativeSpine}

## Structure

${spec.structure.map((item) => `- ${item}`).join("\n")}

## Required Checks

${spec.requiredChecks.map((item) => `- ${item}`).join("\n")}

## Review Rules

${spec.reviewRules.map((item) => `- ${item}`).join("\n")}
`;
}

function renderVerification(findings: VerificationFinding[], report: TrustReport) {
  const findingRows = findings.length
    ? findings.map((finding) => `| ${finding.severity} | ${finding.location} | ${finding.issue} | ${finding.recommendedRepair} |`).join("\n")
    : "| none | all | No findings. | No repair needed. |";
  return `# Verification Report

Readiness: ${report.readiness}

Blocking issues: ${report.summary.blockingCount}

Needs review: ${report.summary.needsReviewCount}

## Findings

| Severity | Location | Issue | Repair |
|---|---|---|---|
${findingRows}
`;
}

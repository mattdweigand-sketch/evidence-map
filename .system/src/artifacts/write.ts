import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtifactSpec,
  FileInspectionRecord,
  SourceConflict,
  SourceRecord,
  EvidenceMapRun,
  TrustReport,
  VerificationFinding
} from "../types.ts";
import { buildGeneralFinalExport } from "../export/general.ts";
import { renderLegalDraftPropositions } from "../legal/draft.ts";
import { renderLegalEvidenceMap } from "../legal/evidence-map.ts";
import { buildLegalFinalExport } from "../legal/export.ts";
import { renderLegalReviewDecisionSet } from "../legal/review-decisions.ts";
import { renderLegalBoundary, renderLegalReuseLibrary, renderLegalSourceHistory } from "../legal/reuse-library.ts";
import { renderLegalOutputSpec } from "../legal/spec.ts";
import { renderLegalSourcePacket, type LegalSourcePacket } from "../legal/source-packet.ts";
import { renderGeneralReviewDecisionSet, type GeneralReviewDecisionSet } from "../review/general-decisions.ts";
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
  legalSourcePacket?: LegalSourcePacket;
  legalOutputSpec?: LegalOutputSpec;
  legalEvidenceMap?: LegalEvidenceMap;
  legalDraftPropositions?: LegalPropositionRecord[];
  legalReviewDecisionSet?: LegalReviewDecisionSet;
  legalReuseLibrary?: LegalReuseLibrary;
  generalReviewDecisionSet?: GeneralReviewDecisionSet;
}) {
  const runDir = join(input.baseDir, "deliverables", input.run.slug);
  const sourceDir = join(runDir, "01_source-packet");
  const specDir = join(runDir, "02_artifact-spec");
  const verifyDir = join(runDir, "03_verification");
  const exportDir = join(runDir, "04_export");
  await Promise.all([sourceDir, specDir, verifyDir, exportDir].map((dir) => mkdir(dir, { recursive: true })));

  await writeJson(join(runDir, "run.json"), input.run);
  await writeJson(join(sourceDir, "source-inventory.json"), input.sources);
  await writeJson(join(sourceDir, "file-inspections.json"), input.inspections);
  await writeJson(join(sourceDir, "source-conflicts.json"), input.conflicts);
  await writeFile(join(sourceDir, "source-packet.md"), renderSourcePacket(input.sources, input.inspections, input.conflicts));
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
      sources: input.sources,
      inspections: input.inspections,
      conflicts: input.conflicts,
      spec: input.spec,
      findings: input.findings,
      trustReport: input.trustReport,
      generalReviewDecisionSet: input.generalReviewDecisionSet
    });
    await writeFile(join(exportDir, "README.md"), generalExport.readmeMarkdown);
    if (generalExport.ready && generalExport.readyManifest && generalExport.readyManifestMarkdown) {
      await writeJson(join(exportDir, "ready-manifest.json"), generalExport.readyManifest);
      await writeFile(join(exportDir, "ready-manifest.md"), generalExport.readyManifestMarkdown);
      await rm(join(exportDir, "general-export-refusal.md"), { force: true });
    } else if (generalExport.refusalMarkdown) {
      await writeFile(join(exportDir, "general-export-refusal.md"), generalExport.refusalMarkdown);
      await rm(join(exportDir, "ready-manifest.json"), { force: true });
      await rm(join(exportDir, "ready-manifest.md"), { force: true });
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

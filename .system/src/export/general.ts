import type {
  ArtifactSpec,
  EvidenceMapRecord,
  EvidenceMapRun,
  FileInspectionRecord,
  GeneratedClaimRecord,
  GeneratedOutputRecord,
  OutputMode,
  SourceConflict,
  SourceEvidenceRecord,
  SourceRecord,
  TrustReport,
  VerificationFinding
} from "../types.ts";
import type { SourceExclusion } from "../evidence/select.ts";
import { buildFormattedOutput, type FormattingReceipt } from "../format/markdown.ts";
import {
  buildGeneratedOutputReceipt,
  renderFinalMarkdown,
  renderGeneratedOutputReceipt,
  type GeneratedOutputReceipt
} from "../generate/markdown.ts";
import type { GeneralReviewDecisionSet } from "../review/general-decisions.ts";

export interface GeneralFinalExport {
  ready: boolean;
  readmeMarkdown: string;
  refusalMarkdown?: string;
  readyManifest?: GeneralReadyManifest;
  readyManifestMarkdown?: string;
  generatedFinalMarkdown?: string;
  generatedOutputReceipt?: GeneratedOutputReceipt;
  generatedOutputReceiptMarkdown?: string;
  formattedOutputMarkdown?: string;
  formattingReceipt?: FormattingReceipt;
  formattingReceiptMarkdown?: string;
  blockers: string[];
  acceptedRisks: string[];
  unresolvedRisks: string[];
}

export interface GeneralReadyManifest {
  runId: string;
  profile: "general";
  status: "export_ready";
  readiness: "ready";
  generatedFromRunUpdatedAt: string;
  artifacts: {
    sourcePacket: string;
    artifactSpec: string;
    verificationFindings: string;
    verificationReport: string;
    trustReport: string;
    reviewAudit?: string;
    sourceEvidence?: string;
    generatedClaims?: string;
    evidenceMap?: string;
    finalOutput?: string;
    generatedOutputReceipt?: string;
    formattedOutput?: string;
    formattingReceipt?: string;
  };
  summary: {
    sourceCount: number;
    inspectionCount: number;
    findingCount: number;
    openConflictCount: number;
    generalReviewDecisionCount: number;
    generalReviewAuditEventCount: number;
    generatedClaimCount: number;
    selectedEvidenceCount: number;
    excludedEvidenceCount: number;
  };
  notes: string[];
}

export function buildGeneralFinalExport(input: {
  run: EvidenceMapRun;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
  conflicts: SourceConflict[];
  spec: ArtifactSpec;
  findings: VerificationFinding[];
  trustReport: TrustReport;
  generalReviewDecisionSet?: GeneralReviewDecisionSet;
  outputMode?: OutputMode;
  sourceEvidence?: SourceEvidenceRecord[];
  generatedClaims?: GeneratedClaimRecord[];
  evidenceMap?: EvidenceMapRecord;
  generatedOutput?: GeneratedOutputRecord;
  sourceExclusions?: SourceExclusion[];
}): GeneralFinalExport {
  const blockers = generalExportBlockers(input);
  const acceptedRisks = describeAcceptedRisks(input.generalReviewDecisionSet);
  const unresolvedRisks = describeUnresolvedRisks({
    findings: input.findings,
    trustReport: input.trustReport,
    conflicts: input.conflicts,
    blockers
  });
  const ready = blockers.length === 0;
  const readyManifest = ready ? buildReadyManifest(input) : undefined;
  const generatedFinalMarkdown =
    ready && input.outputMode === "generate" && input.generatedOutput && input.generatedClaims && input.sourceEvidence && input.sourceExclusions
      ? renderFinalMarkdown({
          run: input.run,
          generatedClaims: input.generatedClaims,
          sourceEvidence: input.sourceEvidence,
          sourceExclusions: input.sourceExclusions
        })
      : undefined;
  const generatedOutputReceipt =
    ready &&
    input.outputMode === "generate" &&
    input.generatedOutput &&
    input.generatedClaims &&
    input.sourceEvidence &&
    input.sourceExclusions
      ? buildGeneratedOutputReceipt({
          run: input.run,
          generatedOutput: input.generatedOutput,
          generatedClaims: input.generatedClaims,
          sourceEvidence: input.sourceEvidence,
          sourceExclusions: input.sourceExclusions,
          trustReport: input.trustReport
        })
      : undefined;
  const formattedOutput =
    ready && input.outputMode === "generate" && input.generatedOutput && input.generatedClaims && input.sourceEvidence && input.sourceExclusions
      ? buildFormattedOutput({
          run: input.run,
          trustReport: input.trustReport,
          generatedOutput: input.generatedOutput,
          generatedClaims: input.generatedClaims,
          sourceEvidence: input.sourceEvidence,
          sourceExclusions: input.sourceExclusions,
          style: "reference"
        })
      : undefined;

  return {
    ready,
    readmeMarkdown: renderGeneralExportReceipt({
      ...input,
      ready,
      blockers,
      acceptedRisks,
      unresolvedRisks
    }),
    refusalMarkdown: ready ? undefined : renderGeneralExportRefusal({ trustReport: input.trustReport, blockers, unresolvedRisks }),
    readyManifest,
    readyManifestMarkdown: ready && readyManifest ? renderReadyManifest(readyManifest, input.spec) : undefined,
    generatedFinalMarkdown,
    generatedOutputReceipt,
    generatedOutputReceiptMarkdown: generatedOutputReceipt ? renderGeneratedOutputReceipt(generatedOutputReceipt) : undefined,
    formattedOutputMarkdown: formattedOutput?.markdown,
    formattingReceipt: formattedOutput?.receipt,
    formattingReceiptMarkdown: formattedOutput?.receiptMarkdown,
    blockers,
    acceptedRisks,
    unresolvedRisks
  };
}

function generalExportBlockers(input: {
  findings: VerificationFinding[];
  trustReport: TrustReport;
  conflicts: SourceConflict[];
  generalReviewDecisionSet?: GeneralReviewDecisionSet;
  outputMode?: OutputMode;
  sourceEvidence?: SourceEvidenceRecord[];
  generatedClaims?: GeneratedClaimRecord[];
  evidenceMap?: EvidenceMapRecord;
  generatedOutput?: GeneratedOutputRecord;
}) {
  const blockers = new Set<string>();

  if (input.outputMode === "generate") {
    if (!input.sourceEvidence) blockers.add("Generated source evidence records are missing.");
    if (!input.generatedClaims) blockers.add("Generated claim records are missing.");
    if (!input.evidenceMap) blockers.add("Generated evidence map is missing.");
    if (!input.generatedOutput) blockers.add("Generated output record is missing.");
    if (input.generatedOutput && input.trustReport.readiness === "ready" && input.generatedOutput.status !== "export_ready") {
      blockers.add("Generated output record is not export_ready.");
    }

    if (input.trustReport.readiness !== "ready") {
      for (const issue of input.trustReport.blockingIssues) blockers.add(issue);
      if (input.trustReport.summary.blockingCount > 0 && input.trustReport.blockingIssues.length === 0) {
        blockers.add("Blocking verification issues remain.");
      }
      if (input.trustReport.summary.needsReviewCount > 0) {
        blockers.add("Human review is still required before generated output export.");
      }
    }

    for (const finding of input.findings) {
      if (finding.severity === "must_fix" || finding.humanReviewRequired) {
        blockers.add(formatFinding(finding));
      }
    }

    addAcceptedRiskAuditBlockers(blockers, input.findings, input.generalReviewDecisionSet);
    return [...blockers];
  }

  if (input.trustReport.readiness !== "ready") {
    for (const issue of input.trustReport.blockingIssues) blockers.add(issue);
    for (const warning of input.trustReport.warnings) blockers.add(warning);
    if (input.trustReport.summary.blockingCount > 0 && input.trustReport.blockingIssues.length === 0) {
      blockers.add("Blocking verification issues remain.");
    }
    if (input.trustReport.summary.needsReviewCount > 0 && input.trustReport.warnings.length === 0) {
      blockers.add("Human review is still required before export.");
    }
  }

  for (const finding of input.findings) {
    if (finding.severity === "must_fix" || finding.severity === "should_fix" || finding.humanReviewRequired) {
      blockers.add(formatFinding(finding));
    }
  }

  for (const conflict of input.conflicts) {
    if (conflict.status === "open") {
      blockers.add(`source-conflict:${conflict.id}: ${conflict.description}`);
    }
  }

  addAcceptedRiskAuditBlockers(blockers, input.findings, input.generalReviewDecisionSet);

  return [...blockers];
}

function buildReadyManifest(input: {
  run: EvidenceMapRun;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
  conflicts: SourceConflict[];
  findings: VerificationFinding[];
  trustReport: TrustReport;
  generalReviewDecisionSet?: GeneralReviewDecisionSet;
  sourceEvidence?: SourceEvidenceRecord[];
  generatedClaims?: GeneratedClaimRecord[];
  evidenceMap?: EvidenceMapRecord;
  generatedOutput?: GeneratedOutputRecord;
}): GeneralReadyManifest {
  const artifacts: GeneralReadyManifest["artifacts"] = {
    sourcePacket: "01_source-packet/source-inventory.json",
    artifactSpec: "02_artifact-spec/artifact-spec.json",
    verificationFindings: "03_verification/verification-findings.json",
    verificationReport: "03_verification/verification-report.md",
    trustReport: "03_verification/trust-report.json"
  };
  if (input.generalReviewDecisionSet) {
    artifacts.reviewAudit = "03_verification/general-review-decisions.json";
  }
  if (input.generatedOutput && input.evidenceMap && input.generatedClaims && input.sourceEvidence) {
    artifacts.sourceEvidence = "01_source-packet/source-evidence.json";
    artifacts.generatedClaims = "03_verification/generated-claims.json";
    artifacts.evidenceMap = "03_verification/evidence-map.json";
    artifacts.finalOutput = input.generatedOutput.pathRelativeToRun ?? "04_export/final-output.md";
    artifacts.generatedOutputReceipt = "04_export/generated-output-receipt.json";
    artifacts.formattedOutput = "04_export/formatted-output.md";
    artifacts.formattingReceipt = "04_export/formatting-receipt.json";
  }

  return {
    runId: input.run.id,
    profile: "general",
    status: "export_ready",
    readiness: "ready",
    generatedFromRunUpdatedAt: input.run.updatedAt,
    artifacts,
    summary: {
      sourceCount: input.sources.length,
      inspectionCount: input.inspections.length,
      findingCount: input.findings.length,
      openConflictCount: input.conflicts.filter((conflict) => conflict.status === "open").length,
      generalReviewDecisionCount: input.generalReviewDecisionSet?.decisions.length ?? 0,
      generalReviewAuditEventCount: input.generalReviewDecisionSet?.auditEvents.length ?? 0,
      generatedClaimCount: input.generatedClaims?.length ?? 0,
      selectedEvidenceCount: input.sourceEvidence?.filter((item) => item.useStatus === "selected").length ?? 0,
      excludedEvidenceCount: input.sourceEvidence?.filter((item) => item.useStatus === "excluded").length ?? 0
    },
    notes: [
      "This manifest records local export readiness only.",
      "No external sending, filing, submission, or publication was performed.",
      input.generatedOutput
        ? "The general profile generated a local Markdown final output from verified claims and a deterministic formatted derivative."
        : "The final deliverable itself is not generated by the general profile; approved user-supplied artifacts can be copied locally after readiness."
    ]
  };
}

function renderGeneralExportRefusal(input: {
  trustReport: TrustReport;
  blockers: string[];
  unresolvedRisks: string[];
}) {
  return `# General Export Refusal

No final general artifact export was written.

Readiness: ${input.trustReport.readiness}

## Exact Unresolved Blockers

${renderList(input.blockers)}

## Unresolved Risks

${renderList(input.unresolvedRisks)}

## Required Action

Resolve blocking findings, complete required human review, or add audited general review decisions before attempting export.
`;
}

function renderGeneralExportReceipt(input: {
  ready: boolean;
  trustReport: TrustReport;
  generalReviewDecisionSet?: GeneralReviewDecisionSet;
  generatedOutput?: GeneratedOutputRecord;
  acceptedRisks: string[];
  unresolvedRisks: string[];
  blockers: string[];
}) {
  return `# General Export Gate Receipt

Status: ${input.ready ? "export_ready" : "refused"}

Ready manifest: ${input.ready ? "`04_export/ready-manifest.json`" : "not written"}

Final artifact: ${input.generatedOutput ? "`04_export/final-output.md`" : "not generated by the general profile"}

Formatted derivative: ${input.generatedOutput ? "`04_export/formatted-output.md`" : "not generated by the general profile"}

Source packet: \`01_source-packet/source-inventory.json\`

Artifact spec: \`02_artifact-spec/artifact-spec.json\`

Hostile review: \`03_verification/verification-findings.json\`

Trust report: \`03_verification/trust-report.json\`

Review audit: ${input.generalReviewDecisionSet ? "`03_verification/general-review-decisions.json`" : "not present"}

Readiness: ${input.trustReport.readiness}

Blocking issues: ${input.trustReport.summary.blockingCount}

Needs review: ${input.trustReport.summary.needsReviewCount}

Review decisions: ${input.generalReviewDecisionSet?.decisions.length ?? 0}

Audit events: ${input.generalReviewDecisionSet?.auditEvents.length ?? 0}

## Accepted Risks

${renderList(input.acceptedRisks)}

## Unresolved Risks

${renderList(input.unresolvedRisks)}

## Export Gate

${input.ready ? "- Local ready manifest is available. No final artifact was sent or copied externally." : renderList(input.blockers)}

No external sending, filing, submission, or publication was performed.
`;
}

function renderReadyManifest(manifest: GeneralReadyManifest, spec: ArtifactSpec) {
  return `# General Ready Manifest

Status: ${manifest.status}

Readiness: ${manifest.readiness}

Artifact kind: ${spec.artifactKind}

Source packet: \`${manifest.artifacts.sourcePacket}\`

Artifact spec: \`${manifest.artifacts.artifactSpec}\`

Verification findings: \`${manifest.artifacts.verificationFindings}\`

Verification report: \`${manifest.artifacts.verificationReport}\`

Trust report: \`${manifest.artifacts.trustReport}\`

Review audit: ${manifest.artifacts.reviewAudit ? `\`${manifest.artifacts.reviewAudit}\`` : "not present"}

Source evidence: ${manifest.artifacts.sourceEvidence ? `\`${manifest.artifacts.sourceEvidence}\`` : "not present"}

Generated claims: ${manifest.artifacts.generatedClaims ? `\`${manifest.artifacts.generatedClaims}\`` : "not present"}

Evidence map: ${manifest.artifacts.evidenceMap ? `\`${manifest.artifacts.evidenceMap}\`` : "not present"}

Final output: ${manifest.artifacts.finalOutput ? `\`${manifest.artifacts.finalOutput}\`` : "not generated"}

Generated output receipt: ${manifest.artifacts.generatedOutputReceipt ? `\`${manifest.artifacts.generatedOutputReceipt}\`` : "not present"}

Formatted output: ${manifest.artifacts.formattedOutput ? `\`${manifest.artifacts.formattedOutput}\`` : "not present"}

Formatting receipt: ${manifest.artifacts.formattingReceipt ? `\`${manifest.artifacts.formattingReceipt}\`` : "not present"}

## Summary

- Sources: ${manifest.summary.sourceCount}
- Inspections: ${manifest.summary.inspectionCount}
- Findings: ${manifest.summary.findingCount}
- Open conflicts: ${manifest.summary.openConflictCount}
- Review decisions: ${manifest.summary.generalReviewDecisionCount}
- Audit events: ${manifest.summary.generalReviewAuditEventCount}
- Generated claims: ${manifest.summary.generatedClaimCount}
- Selected evidence: ${manifest.summary.selectedEvidenceCount}
- Excluded evidence: ${manifest.summary.excludedEvidenceCount}

## Notes

${manifest.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function describeAcceptedRisks(decisionSet: GeneralReviewDecisionSet | undefined) {
  if (!decisionSet) return [];
  return decisionSet.decisions.flatMap((decision) => {
    if (decision.action === "accept_general_risk") {
      return [`${decision.id}: ${decision.location}: ${decision.issue}. Reason: ${decision.reason}`];
    }
    return [];
  });
}

function describeUnresolvedRisks(input: {
  findings: VerificationFinding[];
  trustReport: TrustReport;
  conflicts: SourceConflict[];
  blockers: string[];
}) {
  const unresolved = new Set<string>(input.blockers);
  for (const warning of input.trustReport.warnings) unresolved.add(warning);
  for (const finding of input.findings) {
    if (finding.humanReviewRequired || finding.severity === "must_fix" || finding.severity === "should_fix") {
      unresolved.add(formatFinding(finding));
    }
  }
  for (const conflict of input.conflicts) {
    if (conflict.status === "open") unresolved.add(`source-conflict:${conflict.id}: ${conflict.description}`);
  }
  return [...unresolved];
}

function acceptedRiskDecisionIds(finding: VerificationFinding) {
  const values = `${finding.evidence}\n${finding.recommendedRepair}`;
  return [...values.matchAll(/general_review_decision_[a-f0-9]{16}/g)].map((match) => match[0]);
}

function addAcceptedRiskAuditBlockers(
  blockers: Set<string>,
  findings: VerificationFinding[],
  decisionSet: GeneralReviewDecisionSet | undefined
) {
  const decisionIds = new Set(decisionSet?.decisions.map((decision) => decision.id) ?? []);
  const auditDecisionIds = new Set(decisionSet?.auditEvents.map((event) => event.decisionId) ?? []);
  for (const finding of findings) {
    for (const decisionId of acceptedRiskDecisionIds(finding)) {
      if (!decisionIds.has(decisionId) || !auditDecisionIds.has(decisionId)) {
        blockers.add(`Accepted general risk ${decisionId} is missing a review decision or audit event.`);
      }
    }
  }
}

function formatFinding(finding: VerificationFinding) {
  return `${finding.severity}: ${finding.location}: ${finding.issue} - ${finding.recommendedRepair}`;
}

function renderList(values: string[]) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None";
}

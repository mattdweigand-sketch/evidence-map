import type { EvidenceMapRun, SourceConflict, TrustReport, VerificationFinding } from "../types.ts";
import type { LegalSourcePacket } from "./source-packet.ts";
import type {
  LegalEvidenceMap,
  LegalOutputSpec,
  LegalPassageRecord,
  LegalPropositionRecord,
  LegalReviewDecisionSet,
  LegalSourceRecord
} from "./types.ts";

export interface LegalFinalExport {
  ready: boolean;
  finalMarkdown?: string;
  refusalMarkdown?: string;
  readmeMarkdown: string;
  blockers: string[];
  acceptedRisks: string[];
  unresolvedRisks: string[];
}

export function buildLegalFinalExport(input: {
  run: EvidenceMapRun;
  legalSourcePacket: LegalSourcePacket;
  legalOutputSpec: LegalOutputSpec;
  legalEvidenceMap: LegalEvidenceMap;
  findings: VerificationFinding[];
  trustReport: TrustReport;
  conflicts: SourceConflict[];
  legalReviewDecisionSet?: LegalReviewDecisionSet;
}): LegalFinalExport {
  const blockers = legalExportBlockers(input);
  const acceptedRisks = describeAcceptedRisks(input.legalReviewDecisionSet);
  const unresolvedRisks = describeUnresolvedRisks({
    findings: input.findings,
    trustReport: input.trustReport,
    conflicts: input.conflicts,
    blockers
  });
  const ready = blockers.length === 0;

  return {
    ready,
    finalMarkdown: ready ? renderFinalLegalMarkdown(input) : undefined,
    refusalMarkdown: ready ? undefined : renderLegalExportRefusal({ ...input, blockers, unresolvedRisks }),
    readmeMarkdown: renderLegalExportReceipt({
      ...input,
      ready,
      blockers,
      acceptedRisks,
      unresolvedRisks
    }),
    blockers,
    acceptedRisks,
    unresolvedRisks
  };
}

function legalExportBlockers(input: {
  findings: VerificationFinding[];
  trustReport: TrustReport;
  conflicts: SourceConflict[];
  legalReviewDecisionSet?: LegalReviewDecisionSet;
}) {
  const blockers = new Set<string>();

  if (input.trustReport.readiness !== "ready") {
    for (const issue of input.trustReport.blockingIssues) blockers.add(issue);
    for (const warning of input.trustReport.warnings) blockers.add(warning);
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

  const decisionIds = new Set(input.legalReviewDecisionSet?.decisions.map((decision) => decision.id) ?? []);
  const auditDecisionIds = new Set(input.legalReviewDecisionSet?.auditEvents.map((event) => event.decisionId) ?? []);
  for (const finding of input.findings) {
    for (const decisionId of acceptedRiskDecisionIds(finding)) {
      if (!decisionIds.has(decisionId) || !auditDecisionIds.has(decisionId)) {
        blockers.add(`Accepted legal risk ${decisionId} is missing a review decision or audit event.`);
      }
    }
  }

  return [...blockers];
}

function renderFinalLegalMarkdown(input: {
  run: EvidenceMapRun;
  legalSourcePacket: LegalSourcePacket;
  legalOutputSpec: LegalOutputSpec;
  legalEvidenceMap: LegalEvidenceMap;
  trustReport: TrustReport;
}) {
  const sourceById = new Map(input.legalSourcePacket.sources.map((source) => [source.sourceId, source]));
  const passageById = new Map(input.legalSourcePacket.passages.map((passage) => [passage.passageId, passage]));
  const title = legalDocumentTitle(input.legalOutputSpec);
  const propositionRows = input.legalEvidenceMap.propositions.length
    ? input.legalEvidenceMap.propositions
        .map((proposition) => renderProposition(proposition, sourceById, passageById))
        .join("\n")
    : "- No legal propositions were present in the evidence map.";

  return `# ${escapeMarkdown(input.run.name)} ${title}

This local Markdown export is a legal reliability artifact, not legal advice.

Output kind: ${input.legalOutputSpec.outputKind}

Readiness: ${input.trustReport.readiness}

Question presented: ${input.legalOutputSpec.questionPresented ?? "Not specified."}

Jurisdiction: ${input.legalOutputSpec.jurisdiction ?? "Not specified."}

## Evidence-Mapped Propositions

${propositionRows}

## Source Table

${renderSourceTable(input.legalSourcePacket.sources)}

## Review Boundary

- Source packet: \`01_source-packet/legal-source-packet.json\`
- Legal evidence map: \`03_verification/legal-evidence-map.json\`
- Hostile review findings: \`03_verification/verification-findings.json\`
- Trust report: \`03_verification/trust-report.json\`
- This export was generated only from local structured artifacts.
- No external legal research, filing, sending, or submission was performed.
`;
}

function renderLegalExportRefusal(input: {
  trustReport: TrustReport;
  blockers: string[];
  unresolvedRisks: string[];
}) {
  return `# Legal Export Refusal

No final legal export was written.

This refusal is a legal reliability artifact, not legal advice.

Readiness: ${input.trustReport.readiness}

## Exact Unresolved Blockers

${renderList(input.blockers)}

## Unresolved Legal Risks

${renderList(input.unresolvedRisks)}

## Required Action

Resolve the blocking verification findings, complete required review, or add audited legal review decisions before attempting final export.
`;
}

function renderLegalExportReceipt(input: {
  ready: boolean;
  trustReport: TrustReport;
  legalReviewDecisionSet?: LegalReviewDecisionSet;
  acceptedRisks: string[];
  unresolvedRisks: string[];
  blockers: string[];
}) {
  return `# Legal Final Export Receipt

This receipt is a legal reliability artifact, not legal advice.

Status: ${input.ready ? "export_ready" : "refused"}

Final Markdown: ${input.ready ? "`04_export/final-legal.md`" : "not written"}

Source packet: \`01_source-packet/legal-source-packet.json\`

Legal evidence map: \`03_verification/legal-evidence-map.json\`

Hostile review: \`03_verification/verification-findings.json\`

Trust report: \`03_verification/trust-report.json\`

Review audit: \`03_verification/legal-review-decisions.json\`

Readiness: ${input.trustReport.readiness}

Blocking issues: ${input.trustReport.summary.blockingCount}

Needs review: ${input.trustReport.summary.needsReviewCount}

Review decisions: ${input.legalReviewDecisionSet?.decisions.length ?? 0}

Audit events: ${input.legalReviewDecisionSet?.auditEvents.length ?? 0}

## Accepted Risks

${renderList(input.acceptedRisks)}

## Unresolved Legal Risks

${renderList(input.unresolvedRisks)}

## Export Gate

${input.ready ? "- Final legal Markdown export is available locally." : renderList(input.blockers)}

No external filing, sending, submission, or legal action was performed.
`;
}

function renderProposition(
  proposition: LegalPropositionRecord,
  sourceById: Map<string, LegalSourceRecord>,
  passageById: Map<string, LegalPassageRecord>
) {
  const citation = citationFor(proposition, sourceById, passageById);
  return `- **${proposition.propositionType}**: ${proposition.text}${citation ? ` (${citation})` : ""}`;
}

function citationFor(
  proposition: LegalPropositionRecord,
  sourceById: Map<string, LegalSourceRecord>,
  passageById: Map<string, LegalPassageRecord>
) {
  const sourceLabels = proposition.sourceIds.map((sourceId) => sourceLabel(sourceById.get(sourceId), sourceId));
  const pinpoints = unique([
    ...proposition.pinCites,
    ...proposition.passageIds.map((passageId) => passageById.get(passageId)?.pinpoint).filter((pinpoint): pinpoint is string => Boolean(pinpoint))
  ]);
  return [...sourceLabels, ...pinpoints].filter(Boolean).join("; ");
}

function sourceLabel(source: LegalSourceRecord | undefined, sourceId: string) {
  if (!source) return sourceId;
  return source.citationText ?? source.title ?? sourceId;
}

function renderSourceTable(sources: LegalSourceRecord[]) {
  const rows = sources.length
    ? sources
        .map(
          (source) =>
            `| ${escapeCell(source.sourceId)} | ${escapeCell(source.title)} | ${source.sourceKind} | ${source.authorityLevel} | ${source.treatmentStatus} | ${source.reviewStatus} |`
        )
        .join("\n")
    : "| none |  |  |  |  |  |";
  return `| Source ID | Title | Kind | Authority | Treatment | Review |
|---|---|---|---|---|---|
${rows}`;
}

function describeAcceptedRisks(decisionSet: LegalReviewDecisionSet | undefined) {
  if (!decisionSet) return [];
  return decisionSet.decisions.flatMap((decision) => {
    if (decision.action === "accept_legal_risk") {
      return [`${decision.id}: ${decision.location}: ${decision.issue}. Reason: ${decision.reason}`];
    }
    if (decision.action === "resolve_source_conflict" && decision.carryAsRisk) {
      return [`${decision.id}: source conflict ${decision.conflictId}. Reason: ${decision.resolution}`];
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
  return [...values.matchAll(/legal_review_decision_[a-f0-9]{16}/g)].map((match) => match[0]);
}

function formatFinding(finding: VerificationFinding) {
  return `${finding.severity}: ${finding.location}: ${finding.issue} - ${finding.recommendedRepair}`;
}

function legalDocumentTitle(spec: LegalOutputSpec) {
  if (spec.outputKind === "case_brief") return "Case Brief";
  if (spec.outputKind === "legal_memo") return "Legal Memo";
  if (spec.outputKind === "rule_synthesis") return "Rule Synthesis";
  if (spec.outputKind === "issue_outline") return "Issue Outline";
  if (spec.outputKind === "citation_table") return "Citation Table";
  if (spec.outputKind === "argument_outline") return "Argument Outline";
  if (spec.outputKind === "case_comparison") return "Case Comparison";
  return "Legal Export";
}

function renderList(values: string[]) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function escapeMarkdown(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

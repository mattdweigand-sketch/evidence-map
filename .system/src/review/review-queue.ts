import type {
  EvidenceMapRun,
  FileInspectionRecord,
  FindingSeverity,
  SourceConflict,
  SourceRecord,
  TrustReport,
  VerificationFinding
} from "../types.ts";
import type { LegalSourcePacket } from "../legal/source-packet.ts";
import {
  isOcrRequiredInspection,
  summarizeSourcePrepDecisionSet,
  type SourcePrepReviewDecisionSet
} from "./source-prep-decisions.ts";

export type ReviewQueueAction =
  | "add_source_date"
  | "classify_source_status"
  | "ocr_or_replace_pdf"
  | "repair_extraction"
  | "attach_source_support"
  | "repair_workbook_checks"
  | "review_legal_authority"
  | "check_legal_treatment"
  | "resolve_source_conflict"
  | "add_parser_or_human_review"
  | "human_review";

export interface ReviewQueueExample {
  location: string;
  issue: string;
  severity: FindingSeverity;
  evidence: string;
  recommendedRepair: string;
  sourceId?: string;
  sourceName?: string;
}

export interface ReviewQueueItem {
  action: ReviewQueueAction;
  title: string;
  severity: FindingSeverity;
  count: number;
  requiredDecision: string;
  examples: ReviewQueueExample[];
}

export interface ReviewQueue {
  runId: string;
  runName: string;
  profile: EvidenceMapRun["profile"];
  artifactKind: EvidenceMapRun["artifactKind"];
  readiness: TrustReport["readiness"];
  summary: TrustReport["summary"];
  sourceSummary: {
    byFileType: Record<string, number>;
    bySourceStatus: Record<string, number>;
    byInspectionStatus: Record<string, number>;
    byParser: Record<string, number>;
    unsupportedInspectionCount: number;
    metadataOnlyInspectionCount: number;
    failedInspectionCount: number;
    ocrRequiredCount: number;
  };
  legalSummary?: {
    byAuthorityLevel: Record<string, number>;
    byTreatmentStatus: Record<string, number>;
    byExtractionStatus: Record<string, number>;
    unknownAuthorityCount: number;
    treatmentNotCheckedCount: number;
    extractionFailedCount: number;
  };
  sourcePrepSummary: {
    decisionCount: number;
    auditEventCount: number;
    sourceDateDecisionCount: number;
    ocrDecisionCount: number;
    sourceDateDecisionSourceIds: string[];
    ocrDecisionSourceIds: string[];
  };
  topSourcesByFindingCount: Array<{
    location: string;
    count: number;
  }>;
  items: ReviewQueueItem[];
  artifactRefs: {
    reviewQueueJson: string;
    reviewQueueMarkdown: string;
    trustReport: string;
    verificationFindings: string;
    sourceInventory: string;
    fileInspections: string;
    sourcePrepDecisions: string;
  };
}

const maxExamplesPerItem = 10;

const actionMetadata: Record<ReviewQueueAction, { title: string; requiredDecision: string }> = {
  add_source_date: {
    title: "Add source dates",
    requiredDecision: "Add a source date to the file metadata, filename, or review packet before relying on number-bearing evidence."
  },
  classify_source_status: {
    title: "Classify source status",
    requiredDecision: "Choose whether each source is current, superseded, background, estimate, transcript, raw data, or intentionally unclear."
  },
  ocr_or_replace_pdf: {
    title: "OCR or replace scanned PDFs",
    requiredDecision: "Run OCR, provide a replacement text-readable PDF, or mark the source as manually reviewed before final reliance."
  },
  repair_extraction: {
    title: "Repair extraction failures",
    requiredDecision: "Repair, replace, or exclude files whose parser failed or whose legal text extraction failed."
  },
  attach_source_support: {
    title: "Attach source support",
    requiredDecision: "Attach source IDs, passages, or pinpoints, or remove unsupported claims/propositions."
  },
  repair_workbook_checks: {
    title: "Repair workbook checks",
    requiredDecision: "Add formula maps, checks tabs, input mappings, or review notes for workbook calculation risks."
  },
  review_legal_authority: {
    title: "Review legal authority",
    requiredDecision: "Classify authority level and decide whether the source can support the requested legal proposition."
  },
  check_legal_treatment: {
    title: "Check legal treatment",
    requiredDecision: "Confirm currentness, negative treatment, supersession, or other treatment status before relying on the source."
  },
  resolve_source_conflict: {
    title: "Resolve source conflicts",
    requiredDecision: "Resolve the conflict or explicitly carry it as an unresolved risk."
  },
  add_parser_or_human_review: {
    title: "Add parser or human review",
    requiredDecision: "Route unsupported or metadata-only sources through a parser, exclusion, or human review path."
  },
  human_review: {
    title: "Human review",
    requiredDecision: "Review the finding and either repair, accept with an audit trail, or carry the risk."
  }
};

export function buildReviewQueue(input: {
  run: EvidenceMapRun;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
  conflicts: SourceConflict[];
  findings: VerificationFinding[];
  trustReport: TrustReport;
  legalSourcePacket?: LegalSourcePacket;
  sourcePrepReviewDecisionSet?: SourcePrepReviewDecisionSet;
}): ReviewQueue {
  const sourcesByName = new Map(input.sources.map((source) => [source.name, source]));
  const inspectionsByName = new Map(input.inspections.map((inspection) => [inspection.name, inspection]));
  const itemsByAction = new Map<ReviewQueueAction, ReviewQueueItem>();

  for (const finding of input.findings) {
    const action = classifyFinding(finding, inspectionsByName);
    const metadata = actionMetadata[action];
    const item =
      itemsByAction.get(action) ??
      {
        action,
        title: metadata.title,
        severity: finding.severity,
        count: 0,
        requiredDecision: metadata.requiredDecision,
        examples: []
      };
    item.count += 1;
    item.severity = moreSevere(item.severity, finding.severity);
    if (item.examples.length < maxExamplesPerItem) {
      const sourceName = sourceNameFromLocation(finding.location);
      const source = sourceName ? sourcesByName.get(sourceName) : undefined;
      item.examples.push({
        location: finding.location,
        issue: finding.issue,
        severity: finding.severity,
        evidence: finding.evidence,
        recommendedRepair: finding.recommendedRepair,
        sourceId: source?.id,
        sourceName: source?.name ?? sourceName
      });
    }
    itemsByAction.set(action, item);
  }

  return {
    runId: input.run.id,
    runName: input.run.name,
    profile: input.run.profile,
    artifactKind: input.run.artifactKind,
    readiness: input.trustReport.readiness,
    summary: input.trustReport.summary,
    sourceSummary: {
      byFileType: countBy(input.sources, (source) => source.fileType),
      bySourceStatus: countBy(input.sources, (source) => source.status),
      byInspectionStatus: countBy(input.inspections, (inspection) => inspection.status),
      byParser: countBy(input.inspections, (inspection) => inspection.parser),
      unsupportedInspectionCount: input.inspections.filter((inspection) => inspection.status === "unsupported").length,
      metadataOnlyInspectionCount: input.inspections.filter((inspection) => inspection.status === "metadata_only").length,
      failedInspectionCount: input.inspections.filter((inspection) => inspection.status === "failed").length,
      ocrRequiredCount: input.inspections.filter(isOcrRequiredInspection).length
    },
    legalSummary: input.legalSourcePacket ? legalSummary(input.legalSourcePacket) : undefined,
    sourcePrepSummary: input.sourcePrepReviewDecisionSet
      ? summarizeSourcePrepDecisionSet(input.sourcePrepReviewDecisionSet)
      : {
          decisionCount: 0,
          auditEventCount: 0,
          sourceDateDecisionCount: 0,
          ocrDecisionCount: 0,
          sourceDateDecisionSourceIds: [],
          ocrDecisionSourceIds: []
        },
    topSourcesByFindingCount: topLocations(input.findings),
    items: [...itemsByAction.values()].sort(compareQueueItems),
    artifactRefs: {
      reviewQueueJson: "03_verification/review-queue.json",
      reviewQueueMarkdown: "03_verification/review-queue.md",
      trustReport: "03_verification/trust-report.json",
      verificationFindings: "03_verification/verification-findings.json",
      sourceInventory: "01_source-packet/source-inventory.json",
      fileInspections: "01_source-packet/file-inspections.json",
      sourcePrepDecisions: "03_verification/source-prep-decisions.json"
    }
  };
}

export function renderReviewQueue(queue: ReviewQueue) {
  const itemSections =
    queue.items.length > 0
      ? queue.items
          .map((item) => {
            const examples = item.examples.length
              ? item.examples
                  .map(
                    (example) =>
                      `| ${escapeCell(example.severity)} | ${escapeCell(example.location)} | ${escapeCell(example.issue)} | ${escapeCell(example.recommendedRepair)} |`
                  )
                  .join("\n")
              : "| none |  |  |  |";
            return `## ${item.title}

Action: \`${item.action}\`

Severity: ${item.severity}

Findings: ${item.count}

Required decision: ${item.requiredDecision}

| Severity | Location | Issue | Repair |
|---|---|---|---|
${examples}`;
          })
          .join("\n\n")
      : "No review queue items.";

  const topSources = queue.topSourcesByFindingCount.length
    ? queue.topSourcesByFindingCount.map((item) => `| ${escapeCell(item.location)} | ${item.count} |`).join("\n")
    : "| none | 0 |";

  const legalSummary = queue.legalSummary
    ? `

## Legal Summary

- Unknown authority: ${queue.legalSummary.unknownAuthorityCount}
- Treatment not checked: ${queue.legalSummary.treatmentNotCheckedCount}
- Extraction failed: ${queue.legalSummary.extractionFailedCount}
`
    : "";

  return `# Review Queue

Run: ${queue.runName}

Profile: ${queue.profile}

Readiness: ${queue.readiness}

Sources: ${queue.summary.sourceCount}

Findings: ${queue.summary.findingCount}

Blocking findings: ${queue.summary.blockingCount}

Needs review: ${queue.summary.needsReviewCount}

## Source Summary

- Unsupported inspections: ${queue.sourceSummary.unsupportedInspectionCount}
- Metadata-only inspections: ${queue.sourceSummary.metadataOnlyInspectionCount}
- Failed inspections: ${queue.sourceSummary.failedInspectionCount}
- OCR required candidates: ${queue.sourceSummary.ocrRequiredCount}

## Source Prep Decisions

- Decisions: ${queue.sourcePrepSummary.decisionCount}
- Audit events: ${queue.sourcePrepSummary.auditEventCount}
- Source-date decisions: ${queue.sourcePrepSummary.sourceDateDecisionCount}
- OCR/manual-review decisions: ${queue.sourcePrepSummary.ocrDecisionCount}
${legalSummary}

## Top Finding Locations

| Location | Findings |
|---|---|
${topSources}

${itemSections}

## Full Detail

- Review queue JSON: \`${queue.artifactRefs.reviewQueueJson}\`
- Trust report: \`${queue.artifactRefs.trustReport}\`
- Verification findings: \`${queue.artifactRefs.verificationFindings}\`
- Source prep decisions: \`${queue.artifactRefs.sourcePrepDecisions}\`
- Source inventory: \`${queue.artifactRefs.sourceInventory}\`
- File inspections: \`${queue.artifactRefs.fileInspections}\`
`;
}

export function renderReviewQueueCliSummary(queue: ReviewQueue) {
  const lines = [
    `Readiness: ${queue.readiness}`,
    `Sources: ${queue.summary.sourceCount} | Findings: ${queue.summary.findingCount} | Blocking: ${queue.summary.blockingCount} | Needs review: ${queue.summary.needsReviewCount}`,
    `Unsupported inspections: ${queue.sourceSummary.unsupportedInspectionCount} | Metadata-only: ${queue.sourceSummary.metadataOnlyInspectionCount} | OCR required: ${queue.sourceSummary.ocrRequiredCount}`,
    `Source prep decisions: ${queue.sourcePrepSummary.decisionCount} | Source dates: ${queue.sourcePrepSummary.sourceDateDecisionCount} | OCR/manual review: ${queue.sourcePrepSummary.ocrDecisionCount}`,
    "",
    "Review queue:"
  ];

  for (const item of queue.items.slice(0, 10)) {
    lines.push(`- ${item.action}: ${item.count} ${item.severity} finding(s)`);
    lines.push(`  Decision: ${item.requiredDecision}`);
    for (const example of item.examples.slice(0, 3)) {
      lines.push(`  Example: ${example.location} - ${example.issue}`);
    }
  }

  if (queue.items.length === 0) {
    lines.push("- No review items.");
  }

  lines.push(
    "",
    "Artifacts:",
    `- Review queue: ${queue.artifactRefs.reviewQueueMarkdown}`,
    `- Source prep decisions: ${queue.artifactRefs.sourcePrepDecisions}`,
    `- Full trust report: ${queue.artifactRefs.trustReport}`,
    `- Full findings: ${queue.artifactRefs.verificationFindings}`,
    "",
    "Use --json to print the full trust report JSON."
  );

  return `${lines.join("\n")}\n`;
}

function classifyFinding(finding: VerificationFinding, inspectionsByName: Map<string, FileInspectionRecord>): ReviewQueueAction {
  const locationSourceName = sourceNameFromLocation(finding.location);
  const inspection = locationSourceName ? inspectionsByName.get(locationSourceName) : undefined;
  if (finding.issue.includes("Number-bearing source has no source date") || finding.issue.includes("numbers without a source date")) {
    return "add_source_date";
  }
  if (finding.issue === "Source status is unclear.") {
    return "classify_source_status";
  }
  if (finding.issue === "Source has not been deeply inspected." && inspection && isOcrRequiredInspection(inspection)) {
    return "ocr_or_replace_pdf";
  }
  if (finding.issue.includes("Source inspection failed") || finding.issue.includes("Legal source text extraction failed")) {
    return "repair_extraction";
  }
  if (
    finding.issue.includes("Claim has no source attribution") ||
    finding.issue.includes("Claim is marked unsupported") ||
    finding.issue.includes("Legal proposition has no source support") ||
    finding.issue.includes("Legal proposition lacks passage or pinpoint support")
  ) {
    return "attach_source_support";
  }
  if (finding.location.startsWith("workbook:") || finding.location === "workbook/checks" || finding.issue.includes("Calculation")) {
    return "repair_workbook_checks";
  }
  if (finding.category === "authority_level_mismatch" || finding.issue.includes("authority level")) {
    return "review_legal_authority";
  }
  if (finding.category === "negative_treatment_not_checked" || finding.issue.includes("treatment has not been checked")) {
    return "check_legal_treatment";
  }
  if (finding.location === "source-conflict" || finding.category === "unresolved_conflict") {
    return "resolve_source_conflict";
  }
  if (finding.issue === "Source has not been deeply inspected.") {
    return "add_parser_or_human_review";
  }
  return "human_review";
}

function sourceNameFromLocation(location: string) {
  return location.startsWith("source:") || location.startsWith("legal-source:") ? location.replace(/^(legal-)?source:/, "") : undefined;
}

function legalSummary(packet: LegalSourcePacket) {
  return {
    byAuthorityLevel: countBy(packet.sources, (source) => source.authorityLevel),
    byTreatmentStatus: countBy(packet.sources, (source) => source.treatmentStatus),
    byExtractionStatus: countBy(packet.sources, (source) => source.extractionStatus),
    unknownAuthorityCount: packet.sources.filter((source) => source.authorityLevel === "unknown").length,
    treatmentNotCheckedCount: packet.sources.filter((source) => source.treatmentStatus === "not_checked").length,
    extractionFailedCount: packet.sources.filter((source) => source.extractionStatus === "failed").length
  };
}

function countBy<T>(items: T[], keyFor: (item: T) => string | undefined) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item) || "[none]";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function topLocations(findings: VerificationFinding[]) {
  return Object.entries(countBy(findings, (finding) => finding.location))
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location))
    .slice(0, 10);
}

function compareQueueItems(a: ReviewQueueItem, b: ReviewQueueItem) {
  const severityDelta = severityRank(b.severity) - severityRank(a.severity);
  if (severityDelta !== 0) return severityDelta;
  return b.count - a.count || a.action.localeCompare(b.action);
}

function moreSevere(current: FindingSeverity, next: FindingSeverity) {
  return severityRank(next) > severityRank(current) ? next : current;
}

function severityRank(severity: FindingSeverity) {
  if (severity === "must_fix") return 3;
  if (severity === "should_fix") return 2;
  return 1;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

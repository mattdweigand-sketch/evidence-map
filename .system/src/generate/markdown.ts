import type {
  EvidenceMapRecord,
  EvidenceMapRun,
  GeneratedClaimRecord,
  GeneratedOutputRecord,
  SourceEvidenceRecord,
  TrustReport
} from "../types.ts";
import type { SourceExclusion } from "../evidence/select.ts";

export const SOURCE_EVIDENCE_DETAIL_PATH = "01_source-packet/source-evidence.json";
export const GENERATED_CLAIMS_DETAIL_PATH = "03_verification/generated-claims.json";

export interface GeneratedOutputReceipt {
  runId: string;
  profile: "general";
  status: "export_ready";
  readiness: "ready";
  format: "markdown";
  finalOutput: string;
  evidenceMap: string;
  generatedClaims: string;
  sourceEvidence: string;
  trustReport: string;
  claimCount: number;
  evidenceCount: number;
  excludedSourceCount: number;
  generatedAt: string;
  guardrails: string[];
}

export function renderFinalMarkdown(input: {
  run: EvidenceMapRun;
  generatedClaims: GeneratedClaimRecord[];
  sourceEvidence: SourceEvidenceRecord[];
  sourceExclusions: SourceExclusion[];
}) {
  const verifiedClaims = input.generatedClaims.filter((claim) => claim.reviewStatus === "verified");
  assertFinalClaims(verifiedClaims, input.sourceEvidence);
  const evidenceById = new Map(input.sourceEvidence.map((item) => [item.id, item]));
  const summaryRows = verifiedClaims.map((claim) => {
    const dateText = claim.sourceDates.length > 0 ? claim.sourceDates.join(", ") : "n/a";
    return `- ${claim.claim} [sources: ${claim.sourceIds.join(", ")}; evidence: ${formatEvidenceIdsForDisplay(claim.evidenceIds)}; dates: ${dateText}]`;
  });
  const evidenceRows = verifiedClaims.map((claim) => {
    const evidence = claim.evidenceIds.map((id) => evidenceById.get(id)).filter((item): item is SourceEvidenceRecord => Boolean(item));
    return `| ${escapeTable(claim.claim)} | ${escapeTable(claim.sourceIds.join(", "))} | ${escapeTable(formatEvidenceRefsForDisplay(evidence, claim.evidenceIds.length))} | ${escapeTable(formatEvidenceIdsForDisplay(claim.evidenceIds))} | ${escapeTable(claim.sourceDates.join(", ") || "n/a")} |`;
  });
  const excludedRows = input.sourceExclusions.length
    ? input.sourceExclusions.map((item) => `| ${escapeTable(item.sourceName)} | ${escapeTable(item.reason)} |`)
    : ["| none | No source exclusions. |"];

  return `# ${input.run.name}

Generated local Markdown claim receipt. No external sending, filing, submission, or publication was performed.

## Readiness Scope

- Readiness applies to this generated Markdown receipt and the review packet for this run.
- Readiness does not certify original input files, native Office files, or user-supplied artifacts for external shipping.
- Excluded or risky sources remain visible below and in \`${SOURCE_EVIDENCE_DETAIL_PATH}\`.

## Summary

${summaryRows.join("\n") || "- No verified generated claims."}

## Evidence Table

| Claim | Sources | Evidence summary | Evidence detail | Source dates |
|---|---|---|---|---|
${evidenceRows.join("\n") || "| none |  |  |  |  |"}

## Excluded Sources

| Source | Reason |
|---|---|
${excludedRows.join("\n")}

## Verification Boundary

- Source packet: \`01_source-packet/source-inventory.json\`
- Source evidence: \`01_source-packet/source-evidence.json\`
- Evidence map: \`03_verification/evidence-map.json\`
- Trust report: \`03_verification/trust-report.json\`
`;
}

export function buildGeneratedOutputReceipt(input: {
  run: EvidenceMapRun;
  generatedOutput: GeneratedOutputRecord;
  generatedClaims: GeneratedClaimRecord[];
  sourceEvidence: SourceEvidenceRecord[];
  sourceExclusions: SourceExclusion[];
  trustReport: TrustReport;
}): GeneratedOutputReceipt {
  if (input.generatedOutput.status !== "export_ready" || input.trustReport.readiness !== "ready") {
    throw new Error("Generated output receipt requires ready generated output.");
  }
  return {
    runId: input.run.id,
    profile: "general",
    status: "export_ready",
    readiness: "ready",
    format: "markdown",
    finalOutput: input.generatedOutput.pathRelativeToRun ?? "04_export/final-output.md",
    evidenceMap: "03_verification/evidence-map.json",
    generatedClaims: "03_verification/generated-claims.json",
    sourceEvidence: "01_source-packet/source-evidence.json",
    trustReport: "03_verification/trust-report.json",
    claimCount: input.generatedClaims.filter((claim) => claim.reviewStatus === "verified").length,
    evidenceCount: input.sourceEvidence.filter((item) => item.useStatus === "selected").length,
    excludedSourceCount: input.sourceExclusions.length,
    generatedAt: input.generatedOutput.generatedAt,
    guardrails: [
      "Only local Markdown was generated.",
      "Readiness applies to the generated Markdown receipt and review packet, not to original input files or native Office artifacts.",
      "No external model calls, native Office rendering, OCR, sending, filing, submission, or publication were performed.",
      "Every final claim has source IDs and evidence IDs in the generated-claims and source-evidence records.",
      "Every numeric final claim has a source date."
    ]
  };
}

export function renderGeneratedOutputReceipt(receipt: GeneratedOutputReceipt) {
  return `# Generated Output Receipt

Status: ${receipt.status}

Readiness: ${receipt.readiness}

Format: ${receipt.format}

Final output: \`${receipt.finalOutput}\`

Evidence map: \`${receipt.evidenceMap}\`

Generated claims: \`${receipt.generatedClaims}\`

Source evidence: \`${receipt.sourceEvidence}\`

Trust report: \`${receipt.trustReport}\`

Generated at: ${receipt.generatedAt}

## Summary

- Verified claims: ${receipt.claimCount}
- Selected evidence snippets: ${receipt.evidenceCount}
- Excluded sources: ${receipt.excludedSourceCount}

## Guardrails

${receipt.guardrails.map((item) => `- ${item}`).join("\n")}
`;
}

export function renderSourceEvidenceMarkdown(evidence: SourceEvidenceRecord[]) {
  const rows = evidence.length
    ? evidence.map(
        (item) =>
          `| ${item.id} | ${item.sourceName} | ${item.kind} | ${item.anchor} | ${item.useStatus} | ${item.sourceDate ?? ""} | ${escapeTable(item.exclusionReason ?? "")} | ${escapeTable(item.text)} |`
      )
    : ["| none |  |  |  |  |  |  |  |"];
  return `# Source Evidence

| ID | Source | Kind | Anchor | Use status | Date | Exclusion reason | Text |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

export function renderGeneratedClaimsMarkdown(claims: GeneratedClaimRecord[]) {
  const rows = claims.length
    ? claims.map(
        (claim) =>
          `| ${claim.id} | ${claim.reviewStatus} | ${escapeTable(claim.claim)} | ${claim.sourceIds.join(", ")} | ${escapeTable(formatEvidenceIdsForDisplay(claim.evidenceIds))} | ${claim.sourceDates.join(", ")} |`
      )
    : ["| none |  |  |  |  |  |"];
  return `# Generated Claims

| ID | Review status | Claim | Sources | Evidence | Source dates |
|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

export function renderEvidenceMapMarkdown(input: {
  evidenceMap: EvidenceMapRecord;
  sourceEvidence: SourceEvidenceRecord[];
  generatedClaims: GeneratedClaimRecord[];
}) {
  const evidenceById = new Map(input.sourceEvidence.map((item) => [item.id, item]));
  const claimById = new Map(input.generatedClaims.map((claim) => [claim.id, claim]));
  const selectedRows = input.evidenceMap.selectedEvidenceIds.map((id) => {
    const item = evidenceById.get(id);
    return `| ${id} | ${item?.sourceName ?? ""} | ${item?.anchor ?? ""} | ${escapeTable(item?.text ?? "")} |`;
  });
  const excludedRows = input.evidenceMap.excludedEvidenceIds.map((id) => {
    const item = evidenceById.get(id);
    return `| ${id} | ${item?.sourceName ?? ""} | ${escapeTable(item?.exclusionReason ?? "")} |`;
  });
  const claimRows = input.evidenceMap.generatedClaimIds.map((id) => {
    const claim = claimById.get(id);
    return `| ${id} | ${claim?.reviewStatus ?? ""} | ${escapeTable(claim?.claim ?? "")} |`;
  });

  return `# Evidence Map

Generated claims: ${input.evidenceMap.summary.generatedClaimCount}

Verified claims: ${input.evidenceMap.summary.verifiedClaimCount}

Unsupported claims: ${input.evidenceMap.summary.unsupportedClaimCount}

Selected evidence: ${input.evidenceMap.summary.selectedEvidenceCount}

Excluded evidence: ${input.evidenceMap.summary.excludedEvidenceCount}

## Generated Claims

| ID | Review status | Claim |
|---|---|---|
${claimRows.join("\n") || "| none |  |  |"}

## Selected Evidence

| ID | Source | Anchor | Text |
|---|---|---|---|
${selectedRows.join("\n") || "| none |  |  |  |"}

## Excluded Evidence

| ID | Source | Reason |
|---|---|---|
${excludedRows.join("\n") || "| none |  |  |"}
`;
}

function assertFinalClaims(claims: GeneratedClaimRecord[], sourceEvidence: SourceEvidenceRecord[]) {
  const evidenceById = new Map(sourceEvidence.map((item) => [item.id, item]));
  for (const claim of claims) {
    if (claim.sourceIds.length === 0 || claim.evidenceIds.length === 0) {
      throw new Error(`Final generated claim lacks source or evidence IDs: ${claim.id}`);
    }
    const hasNumber = /\b-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b|\b-?\d+(?:\.\d+)?%?\b/.test(claim.claim);
    if (hasNumber && claim.sourceDates.length === 0) {
      throw new Error(`Final generated numeric claim lacks source dates: ${claim.id}`);
    }
    for (const evidenceId of claim.evidenceIds) {
      if (evidenceById.get(evidenceId)?.useStatus === "excluded") {
        throw new Error(`Final generated claim cites excluded evidence: ${claim.id}`);
      }
    }
  }
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

export function formatEvidenceIdsForDisplay(evidenceIds: string[]) {
  if (evidenceIds.length === 0) return "none";
  if (evidenceIds.length === 1) return evidenceIds[0] ?? "none";
  return `${evidenceIds.length} records in ${SOURCE_EVIDENCE_DETAIL_PATH} (first: ${evidenceIds[0]}; last: ${evidenceIds[evidenceIds.length - 1]})`;
}

function formatEvidenceRefsForDisplay(evidence: SourceEvidenceRecord[], expectedCount: number) {
  if (evidence.length === 0) {
    return expectedCount > 0 ? `${expectedCount} records in ${SOURCE_EVIDENCE_DETAIL_PATH}` : "none";
  }
  if (evidence.length === 1) {
    const item = evidence[0];
    return `${item.sourceName}:${item.anchor}`;
  }
  const sources = unique(evidence.map((item) => item.sourceName));
  const first = evidence[0];
  const last = evidence[evidence.length - 1];
  return `${evidence.length} records from ${sources.join(", ")}; first ${first.sourceName}:${first.anchor}; last ${last.sourceName}:${last.anchor}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

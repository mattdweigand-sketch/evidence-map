import type { SourceExclusion } from "../evidence/select.ts";
import type { EvidenceMapRun, GeneratedClaimRecord, GeneratedOutputRecord, SourceEvidenceRecord, TrustReport } from "../types.ts";
import { formatEvidenceIdsForDisplay, SOURCE_EVIDENCE_DETAIL_PATH } from "../generate/markdown.ts";

export interface GeneratedEditProposal {
  runId: string;
  profile: "general";
  status: "applied";
  canonicalOutput: "04_export/final-output.md";
  editedOutput: "04_export/edited-output.md";
  generatedAt: string;
  verifiedClaimIds: string[];
  invariantChecks: string[];
  notes: string[];
}

export function buildGeneratedEditOutput(input: {
  run: EvidenceMapRun;
  trustReport: TrustReport;
  generatedOutput: GeneratedOutputRecord;
  generatedClaims: GeneratedClaimRecord[];
  sourceEvidence: SourceEvidenceRecord[];
  sourceExclusions: SourceExclusion[];
}): { proposal: GeneratedEditProposal; proposalMarkdown: string; editedMarkdown: string } {
  if (input.trustReport.readiness !== "ready" || input.generatedOutput.status !== "export_ready") {
    throw new Error("Generated edit output requires ready generated output.");
  }

  const verifiedClaims = input.generatedClaims.filter((claim) => claim.reviewStatus === "verified");
  const proposal: GeneratedEditProposal = {
    runId: input.run.id,
    profile: "general",
    status: "applied",
    canonicalOutput: "04_export/final-output.md",
    editedOutput: "04_export/edited-output.md",
    generatedAt: new Date().toISOString(),
    verifiedClaimIds: verifiedClaims.map((claim) => claim.id),
    invariantChecks: [
      "No unverified generated claims are included.",
      "Every claim includes generated claim IDs.",
      "Every claim includes source IDs and evidence IDs.",
      "Every numeric claim includes source dates.",
      "Excluded-source reasons are preserved."
    ],
    notes: [
      "This is a deterministic Markdown edit derived from ready generated output.",
      "Readiness applies to the generated Markdown receipt and review packet, not to original input files or native Office artifacts.",
      "No external model call, native Office rendering, or external sending was performed.",
      "The canonical trust target remains final-output.md plus generated claims, evidence map, and trust report."
    ]
  };

  const editedMarkdown = renderEditedMarkdown({
    run: input.run,
    claims: verifiedClaims,
    evidence: input.sourceEvidence,
    sourceExclusions: input.sourceExclusions
  });
  assertEditedOutput({ markdown: editedMarkdown, claims: verifiedClaims, sourceExclusions: input.sourceExclusions });
  return {
    proposal,
    proposalMarkdown: renderGeneratedEditProposal(proposal),
    editedMarkdown
  };
}

export function renderGeneratedEditProposal(proposal: GeneratedEditProposal) {
  return `# Generated Edit Proposal

Status: ${proposal.status}

Canonical output: \`${proposal.canonicalOutput}\`

Edited output: \`${proposal.editedOutput}\`

Generated at: ${proposal.generatedAt}

Verified claims: ${proposal.verifiedClaimIds.length}

## Invariant Checks

${proposal.invariantChecks.map((check) => `- ${check}`).join("\n")}

## Notes

${proposal.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function renderEditedMarkdown(input: {
  run: EvidenceMapRun;
  claims: GeneratedClaimRecord[];
  evidence: SourceEvidenceRecord[];
  sourceExclusions: SourceExclusion[];
}) {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const findingRows = input.claims.map((claim, index) => {
    const claimEvidence = claim.evidenceIds.map((id) => evidenceById.get(id)).filter((item): item is SourceEvidenceRecord => Boolean(item));
    return `${index + 1}. ${claim.claim} [generated claim: ${claim.id}; sources: ${claim.sourceIds.join(", ")}; evidence: ${formatEvidenceIdsForDisplay(claim.evidenceIds)}; anchors: ${formatAnchorsForDisplay(claimEvidence, claim.evidenceIds.length)}; dates: ${claim.sourceDates.join(", ") || "n/a"}]`;
  });
  const excludedRows = input.sourceExclusions.length
    ? input.sourceExclusions.map((exclusion) => `| ${escapeCell(exclusion.sourceName)} | ${escapeCell(exclusion.reason)} |`).join("\n")
    : "| none | None |";

  return `# ${input.run.name}

Deterministic edited Markdown output. No external sending, filing, submission, publication, native Office rendering, or model call was performed.

## Findings

${findingRows.join("\n")}

## Excluded Sources

| Source | Reason |
|---|---|
${excludedRows}

## Verification Boundary

- Canonical generated output: \`04_export/final-output.md\`
- Generated claims: \`03_verification/generated-claims.json\`
- Evidence map: \`03_verification/evidence-map.json\`
- Trust report: \`03_verification/trust-report.json\`
`;
}

function assertEditedOutput(input: {
  markdown: string;
  claims: GeneratedClaimRecord[];
  sourceExclusions: SourceExclusion[];
}) {
  for (const claim of input.claims) {
    requirePresence(input.markdown, claim.id, `generated claim ${claim.id}`);
    for (const sourceId of claim.sourceIds) requirePresence(input.markdown, sourceId, `source ${sourceId}`);
    requireEvidenceReference(input.markdown, claim.evidenceIds);
    if (/\b-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b|\b-?\d+(?:\.\d+)?%?\b/.test(claim.claim)) {
      for (const date of claim.sourceDates) requirePresence(input.markdown, date, `source date ${date}`);
      if (claim.sourceDates.length === 0) throw new Error(`Edited numeric claim lacks source dates: ${claim.id}`);
    }
  }
  for (const exclusion of input.sourceExclusions) {
    requirePresence(input.markdown, exclusion.sourceName, `excluded source ${exclusion.sourceName}`);
    requirePresence(input.markdown, exclusion.reason, `excluded reason ${exclusion.sourceName}`);
  }
}

function requirePresence(markdown: string, value: string, label: string) {
  if (!markdown.includes(value)) throw new Error(`Generated edit output is missing ${label}.`);
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function requireEvidenceReference(markdown: string, evidenceIds: string[]) {
  if (evidenceIds.length <= 1) {
    for (const evidenceId of evidenceIds) requirePresence(markdown, evidenceId, `evidence ${evidenceId}`);
    return;
  }
  requirePresence(markdown, `${evidenceIds.length} records in ${SOURCE_EVIDENCE_DETAIL_PATH}`, "evidence summary");
}

function formatAnchorsForDisplay(evidence: SourceEvidenceRecord[], expectedCount: number) {
  if (evidence.length === 0) return expectedCount > 0 ? `${expectedCount} records in ${SOURCE_EVIDENCE_DETAIL_PATH}` : "n/a";
  if (evidence.length === 1) return `${evidence[0].sourceName}:${evidence[0].anchor}`;
  const first = evidence[0];
  const last = evidence[evidence.length - 1];
  return `${evidence.length} records; first ${first.sourceName}:${first.anchor}; last ${last.sourceName}:${last.anchor}`;
}

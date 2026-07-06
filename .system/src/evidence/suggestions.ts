import { createHash } from "node:crypto";
import type { ClaimRecord, EvidenceLinkSuggestionRecord, SourceEvidenceRecord } from "../types.ts";

type EvidenceLinkSuggestionDraft = Omit<EvidenceLinkSuggestionRecord, "runId">;

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with"
]);

const numberPattern = /\b-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b|\b-?\d+(?:\.\d+)?%?\b/g;

export function buildEvidenceLinkSuggestions(input: {
  runId: string;
  claims: Pick<ClaimRecord, "id" | "claim" | "sourceIds" | "reviewStatus">[];
  evidence: SourceEvidenceRecord[];
}): EvidenceLinkSuggestionDraft[] {
  const candidates: EvidenceLinkSuggestionDraft[] = [];
  for (const claim of input.claims) {
    if (claim.reviewStatus === "verified") continue;
    const claimTerms = termsFor(claim.claim);
    const claimNumbers = numbersFor(claim.claim);
    if (claimTerms.length === 0 && claimNumbers.length === 0) continue;

    for (const evidence of input.evidence) {
      if (evidence.useStatus === "excluded") continue;
      const evidenceTerms = termsFor(evidence.text);
      const evidenceNumbers = numbersFor(evidence.text);
      const matchedTerms = intersection(claimTerms, evidenceTerms);
      const matchedNumbers = intersection(claimNumbers, evidenceNumbers);
      const confidence = suggestionConfidence({
        claimTerms,
        matchedTerms,
        claimNumbers,
        matchedNumbers,
        alreadyCitesSource: claim.sourceIds.includes(evidence.sourceId),
        evidenceSelected: evidence.useStatus === "selected"
      });
      if (confidence < 0.28) continue;
      candidates.push({
        id: stableSuggestionId(input.runId, claim.id, evidence.id),
        claimId: claim.id,
        claimText: claim.claim,
        evidenceId: evidence.id,
        sourceId: evidence.sourceId,
        sourceName: evidence.sourceName,
        evidenceAnchor: evidence.anchor,
        confidence,
        basis: suggestionBasis({ matchedTerms, matchedNumbers, evidence }),
        matchedTerms,
        matchedNumbers,
        reviewStatus: confidence >= 0.7 ? "suggested" : "needs_review"
      });
    }
  }

  return bestSuggestionsPerClaim(candidates, 5);
}

export function renderEvidenceLinkSuggestionsMarkdown(suggestions: EvidenceLinkSuggestionRecord[]) {
  const rows = suggestions.length
    ? suggestions
        .map(
          (suggestion) =>
            `| ${escapeCell(suggestion.claimId)} | ${suggestion.confidence.toFixed(2)} | ${escapeCell(suggestion.sourceName)} | ${escapeCell(suggestion.evidenceAnchor)} | ${escapeCell(suggestion.matchedTerms.join(", "))} | ${escapeCell(suggestion.matchedNumbers.join(", "))} | ${escapeCell(suggestion.reviewStatus)} |`
        )
        .join("\n")
    : "| none |  |  |  |  |  |  |";

  return `# Evidence Link Suggestions

These are deterministic source-to-claim link suggestions. They do not verify claims or change readiness until a reviewer records an audited review decision.

Suggestions: ${suggestions.length}

| Claim ID | Confidence | Source | Evidence anchor | Matched terms | Matched numbers | Review status |
|---|---:|---|---|---|---|---|
${rows}
`;
}

function termsFor(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .match(/\b[a-z][a-z0-9]{2,}\b/g)
        ?.filter((term) => !stopWords.has(term)) ?? []
    )
  ];
}

function numbersFor(value: string) {
  return [...new Set(value.match(numberPattern) ?? [])].map((number) => number.replace(/,/g, ""));
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function suggestionConfidence(input: {
  claimTerms: string[];
  matchedTerms: string[];
  claimNumbers: string[];
  matchedNumbers: string[];
  alreadyCitesSource: boolean;
  evidenceSelected: boolean;
}) {
  const termScore = input.claimTerms.length > 0 ? input.matchedTerms.length / input.claimTerms.length : 0;
  const numberScore =
    input.claimNumbers.length > 0 ? input.matchedNumbers.length / input.claimNumbers.length : input.matchedNumbers.length > 0 ? 0.2 : 0;
  const citationBonus = input.alreadyCitesSource ? 0.15 : 0;
  const selectedBonus = input.evidenceSelected ? 0.1 : 0;
  return Math.min(1, Number((termScore * 0.65 + numberScore * 0.25 + citationBonus + selectedBonus).toFixed(3)));
}

function suggestionBasis(input: {
  matchedTerms: string[];
  matchedNumbers: string[];
  evidence: SourceEvidenceRecord;
}) {
  const parts = [
    input.matchedTerms.length ? `matched terms: ${input.matchedTerms.join(", ")}` : undefined,
    input.matchedNumbers.length ? `matched numbers: ${input.matchedNumbers.join(", ")}` : undefined,
    `evidence kind: ${input.evidence.kind}`,
    `use status: ${input.evidence.useStatus}`
  ].filter((part): part is string => Boolean(part));
  return parts.join("; ");
}

function bestSuggestionsPerClaim(suggestions: EvidenceLinkSuggestionDraft[], limit: number) {
  const byClaim = new Map<string, EvidenceLinkSuggestionDraft[]>();
  for (const suggestion of suggestions) {
    byClaim.set(suggestion.claimId, [...(byClaim.get(suggestion.claimId) ?? []), suggestion]);
  }
  return [...byClaim.values()]
    .flatMap((items) =>
      items.sort((a, b) => b.confidence - a.confidence || a.sourceName.localeCompare(b.sourceName) || a.evidenceAnchor.localeCompare(b.evidenceAnchor)).slice(0, limit)
    )
    .sort((a, b) => a.claimId.localeCompare(b.claimId) || b.confidence - a.confidence);
}

function stableSuggestionId(runId: string, claimId: string, evidenceId: string) {
  const hash = createHash("sha256").update([runId, claimId, evidenceId].join("\0")).digest("hex").slice(0, 20);
  return `evidence_link_${hash}`;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

import { createHash } from "node:crypto";
import { normalizeSourceDate } from "../date-candidates.ts";
import type { ArtifactKind, EvidenceMapRecord, GeneratedClaimRecord, ReviewStatus, SourceEvidenceRecord } from "../types.ts";

type GeneratedClaimDraft = Omit<GeneratedClaimRecord, "runId">;

interface ParsedRow {
  evidence: SourceEvidenceRecord;
  fields: Map<string, string>;
}

export function buildGeneratedClaims(input: {
  runId: string;
  selectedEvidence: SourceEvidenceRecord[];
}): GeneratedClaimDraft[] {
  const claims: GeneratedClaimDraft[] = [];
  claims.push(...metricValueClaims(input));
  claims.push(...surveyAggregateClaims(input));
  claims.push(...narrativeClaims(input));
  return dedupeClaims(claims);
}

export function buildEvidenceMapRecord(input: {
  runId: string;
  artifactKind: ArtifactKind;
  generatedClaims: GeneratedClaimRecord[];
  selectedEvidence: SourceEvidenceRecord[];
  excludedEvidence: SourceEvidenceRecord[];
}): Omit<EvidenceMapRecord, "id"> {
  const verifiedClaimCount = input.generatedClaims.filter((claim) => claim.reviewStatus === "verified").length;
  const unsupportedClaimCount = input.generatedClaims.filter((claim) => claim.reviewStatus === "unsupported").length;
  return {
    runId: input.runId,
    profile: "general",
    artifactKind: input.artifactKind,
    generatedClaimIds: input.generatedClaims.map((claim) => claim.id),
    selectedEvidenceIds: input.selectedEvidence.map((item) => item.id),
    excludedEvidenceIds: input.excludedEvidence.map((item) => item.id),
    summary: {
      generatedClaimCount: input.generatedClaims.length,
      verifiedClaimCount,
      unsupportedClaimCount,
      selectedEvidenceCount: input.selectedEvidence.length,
      excludedEvidenceCount: input.excludedEvidence.length
    }
  };
}

function metricValueClaims(input: {
  runId: string;
  selectedEvidence: SourceEvidenceRecord[];
}) {
  return parsedTableRows(input.selectedEvidence).flatMap((row) => {
    const metric = row.fields.get("metric");
    const value = row.fields.get("value");
    if (!metric || !value) return [];
    const explicitDate = row.fields.get("as_of_date") ?? row.fields.get("date");
    const date = explicitDate === undefined ? normalizeSourceDate(row.evidence.sourceDate) : normalizeSourceDate(explicitDate);
    const claim = `${humanizeMetric(metric)} was ${value}${date ? ` as of ${date}` : ""}.`;
    return [
      buildGeneratedClaim({
        runId: input.runId,
        artifactLocation: `generated-output:${row.evidence.sourceName}:${row.evidence.anchor}`,
        claim,
        evidence: [row.evidence],
        sourceDates: date ? [date] : [],
        reviewStatus: date ? "verified" : "unsupported",
        assumptions: []
      })
    ];
  });
}

function surveyAggregateClaims(input: {
  runId: string;
  selectedEvidence: SourceEvidenceRecord[];
}) {
  const rows = parsedTableRows(input.selectedEvidence).filter((row) => !row.fields.has("metric") || !row.fields.has("value"));
  const rowsBySource = groupBy(rows, (row) => row.evidence.sourceId);
  const claims: GeneratedClaimDraft[] = [];

  for (const sourceRows of rowsBySource.values()) {
    if (sourceRows.length < 2) continue;
    const sourceDate = commonSourceDate(sourceRows.map((row) => row.evidence));
    const evidence = sourceRows.map((row) => row.evidence);
    const headers = unique(sourceRows.flatMap((row) => [...row.fields.keys()]));

    claims.push(
      buildGeneratedClaim({
        runId: input.runId,
        artifactLocation: `generated-output:${sourceRows[0]?.evidence.sourceName}:aggregate:row_count`,
        claim: `${sourceRows[0]?.evidence.sourceName} included ${sourceRows.length} rows${sourceDate ? ` as of ${sourceDate}` : ""}.`,
        evidence,
        sourceDates: sourceDate ? [sourceDate] : [],
        reviewStatus: sourceDate ? "verified" : "unsupported",
        assumptions: []
      })
    );

    for (const header of headers) {
      const values = sourceRows.map((row) => row.fields.get(header)).filter((value): value is string => Boolean(value));
      if (values.length !== sourceRows.length) continue;
      const numbers = values.map(parseNumber).filter((value): value is number => value !== undefined);
      if (numbers.length === values.length && values.length > 1 && !isIdentifierColumn(header)) {
        const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
        claims.push(
          buildGeneratedClaim({
            runId: input.runId,
            artifactLocation: `generated-output:${sourceRows[0]?.evidence.sourceName}:aggregate:${header}`,
            claim: `Average ${humanizeMetric(header)} was ${formatNumber(average)}${sourceDate ? ` as of ${sourceDate}` : ""}.`,
            evidence,
            sourceDates: sourceDate ? [sourceDate] : [],
            reviewStatus: sourceDate ? "verified" : "unsupported",
            assumptions: []
          })
        );
        continue;
      }

      const yesNoCounts = countYesNo(values);
      if (yesNoCounts) {
        claims.push(
          buildGeneratedClaim({
            runId: input.runId,
            artifactLocation: `generated-output:${sourceRows[0]?.evidence.sourceName}:aggregate:${header}`,
            claim: `${humanizeMetric(header)} had ${yesNoCounts.yes} yes responses and ${yesNoCounts.no} no responses${sourceDate ? ` as of ${sourceDate}` : ""}.`,
            evidence,
            sourceDates: sourceDate ? [sourceDate] : [],
            reviewStatus: sourceDate ? "verified" : "unsupported",
            assumptions: []
          })
        );
      }
    }
  }

  return claims;
}

function narrativeClaims(input: {
  runId: string;
  selectedEvidence: SourceEvidenceRecord[];
}) {
  return input.selectedEvidence.flatMap((evidence) => {
    if (!["paragraph", "slide_text", "speaker_notes", "file_summary"].includes(evidence.kind)) return [];
    if (!isNarrativeClaimCandidate(evidence.text)) return [];
    const claim = `Source notes report that ${sentenceCase(evidence.text)}`;
    const sourceDate = normalizeSourceDate(evidence.sourceDate);
    return [
      buildGeneratedClaim({
        runId: input.runId,
        artifactLocation: `generated-output:${evidence.sourceName}:${evidence.anchor}`,
        claim: ensurePeriod(claim),
        evidence: [evidence],
        sourceDates: sourceDate ? [sourceDate] : [],
        reviewStatus: evidence.numberCandidates.length > 0 && !sourceDate ? "unsupported" : "verified",
        assumptions: sourceDate ? [] : ["Narrative source has no source date; claim is framed only as a reported source note."]
      })
    ];
  });
}

function buildGeneratedClaim(input: {
  runId: string;
  artifactLocation: string;
  claim: string;
  evidence: SourceEvidenceRecord[];
  sourceDates: string[];
  reviewStatus: ReviewStatus;
  assumptions: string[];
}): GeneratedClaimDraft {
  const sourceIds = unique(input.evidence.map((item) => item.sourceId));
  const evidenceIds = unique(input.evidence.map((item) => item.id));
  const sourceDates = unique(input.sourceDates.map((date) => normalizeSourceDate(date)).filter((date): date is string => Boolean(date)));
  return {
    id: stableGeneratedClaimId(input.runId, input.claim, evidenceIds),
    artifactLocation: input.artifactLocation,
    claim: input.claim,
    sourceIds,
    evidenceIds,
    assumptions: input.assumptions,
    sourceDates,
    reviewStatus: input.reviewStatus
  };
}

function parsedTableRows(evidence: SourceEvidenceRecord[]): ParsedRow[] {
  return evidence
    .filter((item) => item.kind === "table_row")
    .map((item) => ({ evidence: item, fields: parseLabeledFields(item.text) }))
    .filter((row) => row.fields.size > 0);
}

function parseLabeledFields(value: string) {
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.split(":");
    const key = rawKey?.trim().toLowerCase();
    const fieldValue = rawValue.join(":").trim();
    if (key && fieldValue) fields.set(key, fieldValue);
  }
  return fields;
}

function stableGeneratedClaimId(runId: string, claim: string, evidenceIds: string[]) {
  const hash = createHash("sha256")
    .update([runId, claim.toLowerCase().replace(/\s+/g, " ").trim(), ...evidenceIds.sort()].join("\0"))
    .digest("hex")
    .slice(0, 20);
  return `generated_claim_${hash}`;
}

function dedupeClaims(claims: GeneratedClaimDraft[]) {
  const byKey = new Map<string, GeneratedClaimDraft>();
  for (const claim of claims) byKey.set(`${claim.claim.toLowerCase()}\0${claim.evidenceIds.join(",")}`, claim);
  return [...byKey.values()];
}

function commonSourceDate(evidence: SourceEvidenceRecord[]) {
  for (const item of evidence) {
    const sourceDate = normalizeSourceDate(item.sourceDate);
    if (sourceDate) return sourceDate;
  }
  return undefined;
}

function humanizeMetric(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseNumber(value: string) {
  const normalized = value.replace(/,/g, "").replace(/%$/, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  return Number(normalized);
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isIdentifierColumn(header: string) {
  return /\bid\b|identifier|name/i.test(header);
}

function countYesNo(values: string[]) {
  let yes = 0;
  let no = 0;
  for (const value of values) {
    if (/^yes$/i.test(value.trim())) yes += 1;
    else if (/^no$/i.test(value.trim())) no += 1;
    else return undefined;
  }
  return { yes, no };
}

function isNarrativeClaimCandidate(value: string) {
  if (value.length < 25 || value.length > 800) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (/\?$/.test(value)) return false;
  if (/^(context|themes|open questions|summary|background)$/i.test(value.trim())) return false;
  return true;
}

function sentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return `${trimmed[0]?.toLowerCase()}${trimmed.slice(1)}`;
}

function ensurePeriod(value: string) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function groupBy<T>(values: T[], keyFor: (value: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(keyFor(value), [...(grouped.get(keyFor(value)) ?? []), value]);
  return grouped;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

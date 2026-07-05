import type { FileInspectionRecord, ReviewStatus, SourceRecord } from "../types.ts";
import type {
  LegalAuthorityLevel,
  LegalExtractionStatus,
  LegalSourceKind,
  LegalSourceRecord,
  LegalSourceStatus,
  LegalTreatmentStatus
} from "./types.ts";

export interface LegalSourceClassification {
  sourceKind: LegalSourceKind;
  citationText?: string;
  normalizedCitation?: string;
  jurisdiction?: string;
  courtOrAuthority?: string;
  decisionDate?: string;
  effectiveDate?: string;
  authorityLevel: LegalAuthorityLevel;
  sourceStatus: LegalSourceStatus;
  treatmentStatus: LegalTreatmentStatus;
  extractionStatus: LegalExtractionStatus;
  proceduralPosture?: string;
  parties?: string[];
  notes?: string;
  reviewStatus: ReviewStatus;
}

export function classifyLegalSource(input: {
  source: SourceRecord;
  inspection?: FileInspectionRecord;
}): LegalSourceClassification {
  const { source, inspection } = input;
  const preview = inspection?.textPreview ?? "";
  const haystack = `${source.name}\n${preview}`;
  const lower = haystack.toLowerCase();
  const tokens = tokenize(source.name);
  const sourceKind = inferSourceKind({ lower, tokens, fileType: source.fileType });
  const citationText = detectCitation(haystack, sourceKind);
  const date = source.sourceDate ?? inspection?.sourceDateCandidates[0];
  const jurisdiction = detectJurisdiction(haystack, citationText);
  const courtOrAuthority = detectCourtOrAuthority(haystack, sourceKind);
  const authorityLevel = inferAuthorityLevel(sourceKind);
  const extractionStatus = inferExtractionStatus(inspection);
  const treatmentStatus: LegalTreatmentStatus = "not_checked";
  const sourceStatus = inferLegalSourceStatus(source, lower);
  const reviewStatus = inferReviewStatus({
    sourceKind,
    authorityLevel,
    extractionStatus,
    treatmentStatus
  });

  return {
    sourceKind,
    citationText,
    normalizedCitation: citationText ? normalizeCitation(citationText) : undefined,
    jurisdiction,
    courtOrAuthority,
    decisionDate: sourceKind === "case" || sourceKind === "order" ? date : undefined,
    effectiveDate: sourceKind !== "case" && sourceKind !== "order" ? date : undefined,
    authorityLevel,
    sourceStatus,
    treatmentStatus,
    extractionStatus,
    proceduralPosture: detectProceduralPosture(lower),
    parties: detectParties(haystack),
    notes: classificationNote(sourceKind, authorityLevel, extractionStatus),
    reviewStatus
  };
}

export function toLegalSourceRecord(input: {
  runId: string;
  source: SourceRecord;
  inspection?: FileInspectionRecord;
}): LegalSourceRecord {
  const classification = classifyLegalSource({ source: input.source, inspection: input.inspection });
  return {
    id: `legal_${input.source.id}`,
    runId: input.runId,
    sourceId: input.source.id,
    title: input.source.name,
    ...classification
  };
}

function tokenize(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function hasToken(tokens: string[], ...values: string[]) {
  return values.some((value) => tokens.includes(value));
}

function inferSourceKind(input: {
  lower: string;
  tokens: string[];
  fileType: string;
}): LegalSourceKind {
  const { lower, tokens, fileType } = input;
  if (hasToken(tokens, "assignment", "prompt", "rubric", "syllabus", "instructions")) return "assignment";
  if (/\b(restatement|treatise|law review|article|textbook|practice guide|secondary)\b/i.test(lower)) return "secondary";
  if (hasToken(tokens, "exhibit", "attachment", "declaration", "affidavit")) return "exhibit";
  if (hasToken(tokens, "transcript", "deposition", "depo") || /\b\d{1,4}:\d{1,2}-\d{1,2}\b/.test(lower)) return "transcript";
  if (hasToken(tokens, "contract", "agreement", "lease")) return "contract";
  if (hasToken(tokens, "order", "judgment", "ruling")) return "order";
  if (hasToken(tokens, "motion")) return "motion";
  if (hasToken(tokens, "brief", "memorandum")) return "brief";
  if (/\bconstitution\b|\bconst\./i.test(lower)) return "constitution";
  if (/\b\d+\s+c\.?f\.?r\.?\b|\bregulation\b|\bfederal register\b/i.test(lower)) return "regulation";
  if (/\b\d+\s+u\.?s\.?c\.?\b|\bstatute\b|\bcode\b|\bsection\b|\u00a7/i.test(lower)) return "statute";
  if (/\b(rule|frcp|fed\.?\s*r\.?\s*civ\.?\s*p\.?|fed\.?\s*r\.?\s*evid\.?)\b/i.test(lower)) return "rule";
  if (detectCaseCitation(lower) || detectCaseName(lower) || hasToken(tokens, "case", "opinion")) return "case";
  if (fileType === "pdf" && /\b(opinion|court)\b/i.test(lower)) return "case";
  return "unknown";
}

function inferAuthorityLevel(sourceKind: LegalSourceKind): LegalAuthorityLevel {
  if (sourceKind === "assignment") return "assignment";
  if (sourceKind === "secondary") return "secondary";
  if (["brief", "motion", "order", "contract", "exhibit", "transcript"].includes(sourceKind)) return "record";
  if (sourceKind === "case") return "persuasive";
  return "unknown";
}

function inferExtractionStatus(inspection: FileInspectionRecord | undefined): LegalExtractionStatus {
  if (!inspection) return "metadata_only";
  if (inspection.status === "inspected") return "extracted";
  if (inspection.status === "failed") return "failed";
  return "metadata_only";
}

function inferLegalSourceStatus(source: SourceRecord, lower: string): LegalSourceStatus {
  if (/\b(draft|proposed)\b/i.test(lower)) return "draft";
  if (source.status === "current") return "current";
  if (source.status === "superseded") return "superseded";
  if (source.status === "background") return "background";
  return "unknown";
}

function inferReviewStatus(input: {
  sourceKind: LegalSourceKind;
  authorityLevel: LegalAuthorityLevel;
  extractionStatus: LegalExtractionStatus;
  treatmentStatus: LegalTreatmentStatus;
}): ReviewStatus {
  if (input.extractionStatus === "failed") return "unsupported";
  if (
    input.sourceKind === "unknown" ||
    input.authorityLevel === "unknown" ||
    input.extractionStatus === "metadata_only" ||
    input.treatmentStatus === "not_checked"
  ) {
    return "needs_review";
  }
  return "unreviewed";
}

function detectCitation(value: string, sourceKind: LegalSourceKind) {
  const patterns =
    sourceKind === "statute"
      ? [/\b\d+\s+u\.?s\.?c\.?\s*(?:section|sec\.?|s\.|ss\.)?\s*[\w.-]+/i, /\b(?:section|sec\.?)\s+[\w.-]+/i]
      : sourceKind === "regulation"
        ? [/\b\d+\s+c\.?f\.?r\.?\s*(?:section|sec\.?)?\s*[\w.-]+/i]
        : [
            /\b\d+\s+(?:u\.s\.|s\.ct\.|f\.(?:2d|3d|4th|supp\.?\s?2d|supp\.?\s?3d|supp\.?|app'?x)|cal\.?(?:\s?(?:2d|3d|4th|5th|app\.?))?|n\.y\.?(?:\s?2d)?|p\.\d?d|a\.\d?d|n\.e\.\d?d|n\.w\.\d?d|s\.w\.\d?d|so\.\d?d)\s+\d+\b/i,
            /\b[A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,5}\s+v\.\s+[A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,5}\b/
          ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return undefined;
}

function detectCaseCitation(value: string) {
  return /\b\d+\s+(?:u\.s\.|s\.ct\.|f\.(?:2d|3d|4th|supp\.?|app'?x)|cal\.?|n\.y\.?|p\.\d?d|a\.\d?d|n\.e\.\d?d|n\.w\.\d?d|s\.w\.\d?d|so\.\d?d)\s+\d+\b/i.test(value);
}

function detectCaseName(value: string) {
  return /\b[a-z][a-z0-9&'.-]*(?:\s+[a-z][a-z0-9&'.-]*){0,5}\s+v\.\s+[a-z][a-z0-9&'.-]*(?:\s+[a-z][a-z0-9&'.-]*){0,5}\b/i.test(value);
}

function normalizeCitation(citation: string) {
  return citation.replace(/\s+/g, " ").trim();
}

function detectJurisdiction(value: string, citationText?: string) {
  const haystack = `${value}\n${citationText ?? ""}`;
  if (/\b(u\.s\.c\.|c\.f\.r\.|united states|supreme court of the united states|f\.(?:2d|3d|4th|supp\.?))\b/i.test(haystack)) {
    return "United States";
  }

  const state = stateNames.find(({ name, pattern }) => pattern.test(haystack));
  return state?.name;
}

function detectCourtOrAuthority(value: string, sourceKind: LegalSourceKind) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const courtLine = lines.find((line) => /\b(court|supreme|appeals|district|circuit)\b/i.test(line));
  if (courtLine) return courtLine.slice(0, 160);
  if (sourceKind === "statute" && /\bu\.?s\.?c\.?\b/i.test(value)) return "United States Code";
  if (sourceKind === "regulation" && /\bc\.?f\.?r\.?\b/i.test(value)) return "Code of Federal Regulations";
  return undefined;
}

function detectProceduralPosture(lower: string) {
  if (/\bmotion to dismiss\b/.test(lower)) return "motion to dismiss";
  if (/\bsummary judgment\b/.test(lower)) return "summary judgment";
  if (/\bappeal\b/.test(lower)) return "appeal";
  return undefined;
}

function detectParties(value: string) {
  const match = value.match(/\b([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,5})\s+v\.\s+([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,5})\b/);
  if (!match?.[1] || !match[2]) return undefined;
  return [match[1].trim(), match[2].trim()];
}

function classificationNote(
  sourceKind: LegalSourceKind,
  authorityLevel: LegalAuthorityLevel,
  extractionStatus: LegalExtractionStatus
) {
  const notes = [
    "Phase 1 legal classification is deterministic and conservative.",
    authorityLevel === "unknown" ? "Authority level requires human review." : undefined,
    sourceKind === "unknown" ? "Source kind requires human review." : undefined,
    extractionStatus === "metadata_only" ? "Only metadata is available; do not use as final legal support." : undefined
  ].filter((note): note is string => Boolean(note));
  return notes.join(" ");
}

const stateNames = [
  { name: "Alabama", pattern: /\b(alabama|ala\.)\b/i },
  { name: "Alaska", pattern: /\b(alaska|alaska)\b/i },
  { name: "Arizona", pattern: /\b(arizona|ariz\.)\b/i },
  { name: "Arkansas", pattern: /\b(arkansas|ark\.)\b/i },
  { name: "California", pattern: /\b(california|cal\.)\b/i },
  { name: "Colorado", pattern: /\b(colorado|colo\.)\b/i },
  { name: "Connecticut", pattern: /\b(connecticut|conn\.)\b/i },
  { name: "Delaware", pattern: /\b(delaware|del\.)\b/i },
  { name: "Florida", pattern: /\b(florida|fla\.)\b/i },
  { name: "Georgia", pattern: /\b(georgia|ga\.)\b/i },
  { name: "Hawaii", pattern: /\b(hawaii|haw\.)\b/i },
  { name: "Idaho", pattern: /\b(idaho|idaho)\b/i },
  { name: "Illinois", pattern: /\b(illinois|ill\.)\b/i },
  { name: "Indiana", pattern: /\b(indiana|ind\.)\b/i },
  { name: "Iowa", pattern: /\b(iowa|iowa)\b/i },
  { name: "Kansas", pattern: /\b(kansas|kan\.)\b/i },
  { name: "Kentucky", pattern: /\b(kentucky|ky\.)\b/i },
  { name: "Louisiana", pattern: /\b(louisiana|la\.)\b/i },
  { name: "Maine", pattern: /\b(maine|me\.)\b/i },
  { name: "Maryland", pattern: /\b(maryland|md\.)\b/i },
  { name: "Massachusetts", pattern: /\b(massachusetts|mass\.)\b/i },
  { name: "Michigan", pattern: /\b(michigan|mich\.)\b/i },
  { name: "Minnesota", pattern: /\b(minnesota|minn\.)\b/i },
  { name: "Mississippi", pattern: /\b(mississippi|miss\.)\b/i },
  { name: "Missouri", pattern: /\b(missouri|mo\.)\b/i },
  { name: "Montana", pattern: /\b(montana|mont\.)\b/i },
  { name: "Nebraska", pattern: /\b(nebraska|neb\.)\b/i },
  { name: "Nevada", pattern: /\b(nevada|nev\.)\b/i },
  { name: "New Hampshire", pattern: /\b(new hampshire|n\.h\.)\b/i },
  { name: "New Jersey", pattern: /\b(new jersey|n\.j\.)\b/i },
  { name: "New Mexico", pattern: /\b(new mexico|n\.m\.)\b/i },
  { name: "New York", pattern: /\b(new york|n\.y\.)\b/i },
  { name: "North Carolina", pattern: /\b(north carolina|n\.c\.)\b/i },
  { name: "North Dakota", pattern: /\b(north dakota|n\.d\.)\b/i },
  { name: "Ohio", pattern: /\b(ohio|ohio)\b/i },
  { name: "Oklahoma", pattern: /\b(oklahoma|okla\.)\b/i },
  { name: "Oregon", pattern: /\b(oregon|or\.)\b/i },
  { name: "Pennsylvania", pattern: /\b(pennsylvania|pa\.)\b/i },
  { name: "Rhode Island", pattern: /\b(rhode island|r\.i\.)\b/i },
  { name: "South Carolina", pattern: /\b(south carolina|s\.c\.)\b/i },
  { name: "South Dakota", pattern: /\b(south dakota|s\.d\.)\b/i },
  { name: "Tennessee", pattern: /\b(tennessee|tenn\.)\b/i },
  { name: "Texas", pattern: /\b(texas|tex\.)\b/i },
  { name: "Utah", pattern: /\b(utah|utah)\b/i },
  { name: "Vermont", pattern: /\b(vermont|vt\.)\b/i },
  { name: "Virginia", pattern: /\b(virginia|va\.)\b/i },
  { name: "Washington", pattern: /\b(washington|wash\.)\b/i },
  { name: "West Virginia", pattern: /\b(west virginia|w\. va\.)\b/i },
  { name: "Wisconsin", pattern: /\b(wisconsin|wis\.)\b/i },
  { name: "Wyoming", pattern: /\b(wyoming|wyo\.)\b/i }
];

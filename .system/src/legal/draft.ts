import { readFile } from "node:fs/promises";
import { slugify } from "../db/ids.ts";
import type { FileInspectionRecord, ReviewStatus, SourceRecord } from "../types.ts";
import type { LegalPropositionRecord, LegalPropositionType } from "./types.ts";
import { legalPropositionTypes } from "./types.ts";

export interface LegalPropositionIntake {
  evidenceMapPropositions: LegalPropositionRecord[];
  draftPropositions: LegalPropositionRecord[];
}

type IntakeKind = "map" | "draft";

export async function extractLegalPropositionIntake(input: {
  runId: string;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
}): Promise<LegalPropositionIntake> {
  const inspectionBySourceId = new Map(input.inspections.filter((inspection) => inspection.sourceId).map((inspection) => [inspection.sourceId, inspection]));
  const sourceLookup = buildSourceLookup(input.sources);
  const records: Array<{ kind: IntakeKind; proposition: LegalPropositionRecord }> = [];

  for (const source of input.sources) {
    if (!isTextDraftCandidate(source, inspectionBySourceId.get(source.id))) continue;
    const content = await readFile(source.path, "utf8");
    records.push(...parseLegalPropositionMarkers({ runId: input.runId, source, content, sourceLookup }));
  }

  return {
    evidenceMapPropositions: records.filter((record) => record.kind === "map").map((record) => record.proposition),
    draftPropositions: records.filter((record) => record.kind === "draft").map((record) => record.proposition)
  };
}

export function parseLegalPropositionMarkers(input: {
  runId: string;
  source: Pick<SourceRecord, "id" | "name">;
  content: string;
  sourceLookup?: SourceLookup;
}): Array<{ kind: IntakeKind; proposition: LegalPropositionRecord }> {
  const sourceLookup = input.sourceLookup ?? buildSourceLookup([{ ...input.source, runId: input.runId, path: input.source.name, fileType: "md", status: "unclear", intendedUse: "" }]);
  const records: Array<{ kind: IntakeKind; proposition: LegalPropositionRecord }> = [];
  const lines = input.content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const marker = parseMarkerLine(line);
    if (!marker) continue;

    const lineNumber = index + 1;
    const metadata = parseMetadata(marker.metadata);
    const sourceIds = resolveSourceRefs(firstMetadataList(metadata, ["sourceIds", "sourceId", "sources", "source"]), sourceLookup);
    const passageIds = firstMetadataList(metadata, ["passageIds", "passageId", "passages", "passage"]);
    const pinCites = firstMetadataList(metadata, ["pinCites", "pinCite", "pins", "pin"]);
    const assumptions = firstMetadataList(metadata, ["assumptions", "assumption"]);
    const reviewStatus = parseReviewStatus(firstMetadataValue(metadata, ["reviewStatus", "review"])) ?? defaultReviewStatus(sourceIds, passageIds, pinCites);
    const artifactLocation = firstMetadataValue(metadata, ["artifactLocation", "location"]) ?? `${input.source.name}:L${lineNumber}`;
    const proposition: LegalPropositionRecord = {
      id: buildPropositionId(marker.kind, input.source.name, lineNumber, marker.type, marker.text),
      runId: input.runId,
      artifactLocation,
      propositionType: marker.type,
      text: marker.text,
      sourceIds,
      passageIds,
      pinCites,
      assumptions,
      jurisdiction: firstMetadataValue(metadata, ["jurisdiction"]),
      authorityLevelRequired: parseAuthorityRequirement(firstMetadataValue(metadata, ["authorityLevelRequired", "authority"])) ?? defaultAuthorityRequirement(marker.type),
      reviewStatus
    };
    records.push({ kind: marker.kind, proposition });
  }

  return records;
}

export function renderLegalDraftPropositions(propositions: LegalPropositionRecord[]) {
  const rows = propositions.length
    ? propositions
        .map(
          (proposition) =>
            `| ${escapeCell(proposition.id)} | ${proposition.propositionType} | ${escapeCell(proposition.artifactLocation)} | ${escapeCell(proposition.text)} |`
        )
        .join("\n")
    : "| none |  |  | No marked legal draft propositions. |";

  return `# Legal Draft Propositions

This artifact lists explicitly marked material propositions found in supplied legal drafts. It does not infer legal meaning from unmarked text.

| ID | Type | Location | Text |
|---|---|---|---|
${rows}
`;
}

interface ParsedMarker {
  kind: IntakeKind;
  type: LegalPropositionType;
  metadata: string;
  text: string;
}

type SourceLookup = {
  byId: Map<string, SourceRecord["id"]>;
  byName: Map<string, SourceRecord["id"]>;
};

function isTextDraftCandidate(source: SourceRecord, inspection: FileInspectionRecord | undefined) {
  return (source.fileType === "md" || source.fileType === "txt") && (!inspection || inspection.status === "inspected");
}

function parseMarkerLine(line: string): ParsedMarker | undefined {
  const match = line.match(/^\s*(?:[-*]\s*)?LEGAL-(MAP|DRAFT|PROPOSITION)\s+\[([a-z_]+)\]\s*([^:]*?)\s*:\s*(.+?)\s*$/i);
  const markerKind = match?.[1]?.toLowerCase();
  const type = match?.[2]?.toLowerCase();
  const text = match?.[4]?.trim();
  if (!markerKind || !type || !text || !legalPropositionTypes.includes(type as LegalPropositionType)) return undefined;
  return {
    kind: markerKind === "map" ? "map" : "draft",
    type: type as LegalPropositionType,
    metadata: match?.[3]?.trim() ?? "",
    text
  };
}

function parseMetadata(value: string) {
  const metadata = new Map<string, string>();
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|'([^']*)'|([^"\s]+))/g;
  for (const match of value.matchAll(pattern)) {
    const key = match[1];
    const rawValue = match[2] ?? match[3] ?? match[4];
    if (key && rawValue !== undefined) metadata.set(key, rawValue.trim());
  }
  return metadata;
}

function firstMetadataValue(metadata: Map<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = metadata.get(key);
    if (value) return value;
  }
  return undefined;
}

function firstMetadataList(metadata: Map<string, string>, keys: string[]) {
  const value = firstMetadataValue(metadata, keys);
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveSourceRefs(values: string[], lookup: SourceLookup) {
  return values.map((value) => lookup.byId.get(value) ?? lookup.byName.get(normalizeName(value))).filter((value): value is string => Boolean(value));
}

function buildSourceLookup(sources: SourceRecord[]) {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const source of sources) {
    byId.set(source.id, source.id);
    byName.set(normalizeName(source.name), source.id);
  }
  return { byId, byName };
}

function normalizeName(value: string) {
  return value.toLowerCase().trim();
}

function parseAuthorityRequirement(value: string | undefined): LegalPropositionRecord["authorityLevelRequired"] | undefined {
  if (value === "binding" || value === "persuasive_ok" || value === "secondary_ok" || value === "record") return value;
  return undefined;
}

function defaultAuthorityRequirement(type: LegalPropositionType): LegalPropositionRecord["authorityLevelRequired"] {
  if (type === "record_fact" || type === "procedural_fact") return "record";
  if (type === "application" || type === "counterargument" || type === "conclusion" || type === "reasoning") return "persuasive_ok";
  return "binding";
}

function parseReviewStatus(value: string | undefined): ReviewStatus | undefined {
  if (value === "unreviewed" || value === "needs_review" || value === "verified" || value === "unsupported" || value === "conflicting") return value;
  return undefined;
}

function defaultReviewStatus(sourceIds: string[], passageIds: string[], pinCites: string[]): ReviewStatus {
  return sourceIds.length > 0 && (passageIds.length > 0 || pinCites.length > 0) ? "unreviewed" : "unsupported";
}

function buildPropositionId(kind: IntakeKind, sourceName: string, lineNumber: number, type: LegalPropositionType, text: string) {
  const key = slugify(`${kind}-${sourceName}-l${lineNumber}-${type}-${text.slice(0, 80)}`) || `${kind}-${lineNumber}`;
  return `legal_${kind}_prop_${key}`;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

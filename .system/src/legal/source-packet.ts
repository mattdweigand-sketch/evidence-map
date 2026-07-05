import type { FileInspectionRecord, SourceRecord } from "../types.ts";
import { extractLegalPassages } from "./passages.ts";
import { toLegalSourceRecord } from "./source-classification.ts";
import type { LegalPassageRecord, LegalSourceRecord } from "./types.ts";

type SourceDraft = Omit<SourceRecord, "id" | "runId">;
type InspectionDraft = Omit<FileInspectionRecord, "id" | "runId" | "sourceId">;

export interface LegalSourcePacket {
  runId: string;
  profile: "legal";
  sources: LegalSourceRecord[];
  passages: LegalPassageRecord[];
}

export async function buildLegalSourcePacket(input: {
  runId: string;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
}): Promise<LegalSourcePacket> {
  const inspectionBySourceId = new Map(input.inspections.filter((inspection) => inspection.sourceId).map((inspection) => [inspection.sourceId, inspection]));
  const passages = await extractLegalPassages(input);
  return {
    runId: input.runId,
    profile: "legal",
    sources: input.sources.map((source) =>
      applyPassageExtractionStatus(
        toLegalSourceRecord({
          runId: input.runId,
          source,
          inspection: inspectionBySourceId.get(source.id)
        }),
        passages.filter((passage) => passage.sourceId === source.id)
      )
    ),
    passages
  };
}

export async function buildLegalSourcePacketFromDrafts(input: {
  runId: string;
  sources: SourceDraft[];
  inspections: InspectionDraft[];
}): Promise<LegalSourcePacket> {
  const sources: SourceRecord[] = input.sources.map((source, index) => ({
    ...source,
    id: `src_preview_${index + 1}`,
    runId: input.runId
  }));
  const sourceIdByPath = new Map(sources.map((source) => [source.path, source.id]));
  const inspections: FileInspectionRecord[] = input.inspections.map((inspection, index) => ({
    ...inspection,
    id: `inspect_preview_${index + 1}`,
    runId: input.runId,
    sourceId: sourceIdByPath.get(inspection.path)
  }));
  return buildLegalSourcePacket({ runId: input.runId, sources, inspections });
}

export function renderLegalSourcePacket(packet: LegalSourcePacket) {
  const rows = packet.sources.length
    ? packet.sources
        .map(
          (source) =>
            `| ${escapeCell(source.sourceId)} | ${escapeCell(source.title)} | ${source.sourceKind} | ${escapeCell(source.citationText ?? "")} | ${escapeCell(source.jurisdiction ?? "")} | ${source.authorityLevel} | ${sourceDate(source)} | ${source.extractionStatus} | ${source.treatmentStatus} | ${source.reviewStatus} | ${escapeCell(openQuestions(source))} |`
        )
        .join("\n")
    : "| none |  |  |  |  |  |  |  |  |  | No legal sources classified. |";

  return `# Legal Source Packet

Legal classification is conservative and local-only. This packet is a reliability artifact, not legal advice.

Extracted passages: ${packet.passages.length}

| Source ID | Name | Kind | Citation | Jurisdiction | Authority | Date | Extraction | Treatment | Review | Open questions |
|---|---|---|---|---|---|---|---|---|---|---|
${rows}
`;
}

function sourceDate(source: LegalSourceRecord) {
  return source.decisionDate ?? source.effectiveDate ?? "";
}

function applyPassageExtractionStatus(source: LegalSourceRecord, passages: LegalPassageRecord[]) {
  if (passages.some((passage) => passage.extractionStatus === "extracted")) {
    return {
      ...source,
      extractionStatus: "extracted" as const,
      notes: appendNote(source.notes, "Legal text extraction produced citeable passages.")
    };
  }

  const failedPassage = passages.find((passage) => passage.extractionStatus === "failed");
  if (failedPassage) {
    return {
      ...source,
      extractionStatus: "failed" as const,
      reviewStatus: "unsupported" as const,
      notes: appendNote(source.notes, failedPassage.notes ?? "Legal text extraction failed.")
    };
  }

  return source;
}

function appendNote(current: string | undefined, note: string) {
  return [current, note].filter((value): value is string => Boolean(value)).join(" ");
}

function openQuestions(source: LegalSourceRecord) {
  const questions = [
    source.sourceKind === "unknown" ? "classify source kind" : undefined,
    source.authorityLevel === "unknown" ? "confirm authority level" : undefined,
    source.treatmentStatus === "not_checked" ? "check treatment/currentness" : undefined,
    source.extractionStatus === "metadata_only" ? "extract text before final reliance" : undefined,
    source.extractionStatus === "failed" ? "repair failed text extraction before final reliance" : undefined
  ].filter((question): question is string => Boolean(question));
  return questions.join("; ");
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

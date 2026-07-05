import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { slugify } from "../db/ids.ts";
import type { FileInspectionRecord, SourceRecord } from "../types.ts";
import type { LegalPassageRecord } from "./types.ts";

export async function extractLegalPassages(input: {
  runId: string;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
}): Promise<LegalPassageRecord[]> {
  const inspectionBySourceId = new Map(input.inspections.filter((inspection) => inspection.sourceId).map((inspection) => [inspection.sourceId, inspection]));
  const passageGroups = await Promise.all(
    input.sources.map((source) =>
      extractSourcePassages({
        runId: input.runId,
        source,
        inspection: inspectionBySourceId.get(source.id)
      })
    )
  );
  return passageGroups.flat();
}

export function quoteHash(value: string) {
  return createHash("sha256").update(normalizeQuoteText(value)).digest("hex");
}

export function normalizeQuoteText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function extractSourcePassages(input: {
  runId: string;
  source: SourceRecord;
  inspection?: FileInspectionRecord;
}): Promise<LegalPassageRecord[]> {
  const fileType = input.source.fileType || extname(input.source.path).replace(".", "").toLowerCase();
  if ((fileType !== "md" && fileType !== "txt") || input.inspection?.status !== "inspected") return [];

  const content = await readFile(input.source.path, "utf8");
  const paragraphs = splitParagraphs(content);
  const sourceKey = stableSourceKey(input.source);

  return paragraphs.map((paragraph, index) => {
    const paragraphNumber = index + 1;
    const passageId = `passage_${sourceKey}_p${String(paragraphNumber).padStart(4, "0")}`;
    return {
      id: `legal_${passageId}`,
      runId: input.runId,
      sourceId: input.source.id,
      passageId,
      locationKind: "paragraph",
      paragraphNumber,
      pinpoint: `para. ${paragraphNumber}`,
      quote: paragraph,
      quoteHash: quoteHash(paragraph),
      textBefore: paragraphs[index - 1],
      textAfter: paragraphs[index + 1],
      extractionStatus: "extracted"
    };
  });
}

function splitParagraphs(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .trim()
    )
    .filter(Boolean);
}

function stableSourceKey(source: SourceRecord) {
  const stem = source.name.replace(/\.[^.]+$/, "");
  return slugify(stem) || slugify(source.name) || source.id;
}

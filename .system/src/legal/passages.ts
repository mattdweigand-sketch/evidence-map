import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
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
  if (fileType === "docx") return extractDocxSourcePassages(input);
  if ((fileType !== "md" && fileType !== "txt") || input.inspection?.status !== "inspected") return [];

  const content = await readFile(input.source.path, "utf8");
  const paragraphs = splitParagraphs(content);
  return buildParagraphPassages({
    runId: input.runId,
    source: input.source,
    paragraphs
  });
}

async function extractDocxSourcePassages(input: {
  runId: string;
  source: SourceRecord;
}): Promise<LegalPassageRecord[]> {
  try {
    const content = await readFile(input.source.path);
    const documentXml = extractZipTextEntry(content, "word/document.xml");
    const paragraphs = extractDocxParagraphs(documentXml);
    if (paragraphs.length === 0) {
      throw new Error("DOCX document.xml did not contain extractable paragraphs.");
    }
    return buildParagraphPassages({
      runId: input.runId,
      source: input.source,
      paragraphs
    });
  } catch (error) {
    return [
      buildFailedPassage({
        runId: input.runId,
        source: input.source,
        notes: `DOCX text extraction failed: ${error instanceof Error ? error.message : "Unknown extraction failure."}`
      })
    ];
  }
}

function buildParagraphPassages(input: {
  runId: string;
  source: SourceRecord;
  paragraphs: string[];
}): LegalPassageRecord[] {
  const sourceKey = stableSourceKey(input.source);

  return input.paragraphs.map((paragraph, index) => {
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
      textBefore: input.paragraphs[index - 1],
      textAfter: input.paragraphs[index + 1],
      extractionStatus: "extracted"
    };
  });
}

function buildFailedPassage(input: {
  runId: string;
  source: SourceRecord;
  notes: string;
}): LegalPassageRecord {
  const passageId = `passage_${stableSourceKey(input.source)}_failed`;
  return {
    id: `legal_${passageId}`,
    runId: input.runId,
    sourceId: input.source.id,
    passageId,
    locationKind: "unknown",
    extractionStatus: "failed",
    notes: input.notes.slice(0, 500)
  };
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

function extractZipTextEntry(content: Buffer, entryName: string) {
  const directory = findCentralDirectory(content);
  let offset = directory.offset;

  for (let index = 0; index < directory.entryCount; index += 1) {
    if (content.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP central directory is malformed.");
    }
    const compressionMethod = content.readUInt16LE(offset + 10);
    const compressedSize = content.readUInt32LE(offset + 20);
    const fileNameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const localHeaderOffset = content.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = content.subarray(nameStart, nameStart + fileNameLength).toString("utf8");

    if (name === entryName) {
      const localHeader = localHeaderOffset;
      if (content.readUInt32LE(localHeader) !== 0x04034b50) {
        throw new Error(`ZIP entry ${entryName} has a malformed local header.`);
      }
      const localNameLength = content.readUInt16LE(localHeader + 26);
      const localExtraLength = content.readUInt16LE(localHeader + 28);
      const dataStart = localHeader + 30 + localNameLength + localExtraLength;
      const data = content.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) return data.toString("utf8");
      if (compressionMethod === 8) return inflateRawSync(data).toString("utf8");
      throw new Error(`ZIP entry ${entryName} uses unsupported compression method ${compressionMethod}.`);
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry ${entryName} was not found.`);
}

function findCentralDirectory(content: Buffer) {
  if (content.length < 22) throw new Error("File is not a valid ZIP package.");
  const minimumOffset = Math.max(0, content.length - 22 - 0xffff);

  for (let offset = content.length - 22; offset >= minimumOffset; offset -= 1) {
    if (content.readUInt32LE(offset) !== 0x06054b50) continue;
    const entryCount = content.readUInt16LE(offset + 10);
    const centralDirectorySize = content.readUInt32LE(offset + 12);
    const centralDirectoryOffset = content.readUInt32LE(offset + 16);
    if (centralDirectoryOffset + centralDirectorySize > content.length) {
      throw new Error("ZIP central directory is outside file bounds.");
    }
    return {
      entryCount,
      offset: centralDirectoryOffset
    };
  }

  throw new Error("ZIP end-of-central-directory record was not found.");
}

function extractDocxParagraphs(documentXml: string) {
  const paragraphs: string[] = [];
  for (const match of documentXml.matchAll(/<(?:\w+:)?p\b[\s\S]*?<\/(?:\w+:)?p>/g)) {
    const paragraphXml = match[0].replace(/<(?:\w+:)?(?:tab|br)\b[^>]*\/>/g, " ");
    const textParts = [...paragraphXml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((textMatch) =>
      decodeXmlEntities(textMatch[1] ?? "")
    );
    const paragraph = textParts.join("").replace(/\s+/g, " ").trim();
    if (paragraph) paragraphs.push(paragraph);
  }
  return paragraphs;
}

function decodeXmlEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, body: string) => {
    const namedEntities: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: "\"",
      apos: "'"
    };
    const lower = body.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return namedEntities[lower] ?? entity;
  });
}

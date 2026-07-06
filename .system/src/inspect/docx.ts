import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { FileInspectionRecord } from "../types.ts";
import {
  countNumberCandidates,
  extractFirstElement,
  extractParagraphTexts,
  extractTextRuns,
  matchElements,
  normalizeText,
  parseAttributes,
  readRequiredXml
} from "./office-xml.ts";

type FileInspectionDraft = Omit<FileInspectionRecord, "id" | "runId" | "sourceId">;
type BaseFileInspection = Pick<FileInspectionDraft, "name" | "path" | "fileType" | "sizeBytes" | "modifiedAt">;

interface ParagraphSummary {
  paragraphNumber: number;
  text: string;
  style?: string;
}

interface TableSummary {
  tableNumber: number;
  rowCount: number;
  cellCount: number;
  previewRows: string[][];
}

export async function inspectDocxDocument(
  base: BaseFileInspection,
  helpers: {
    inferDateCandidates(value: string): string[];
    inferOwnerCandidates(value: string): string[];
    previewText(value: string): string;
  }
): Promise<FileInspectionDraft> {
  const zip = await JSZip.loadAsync(await readFile(base.path));
  await readRequiredXml(zip, "[Content_Types].xml", "DOCX");
  const documentXml = await readRequiredXml(zip, "word/document.xml", "DOCX");
  const paragraphs = extractDocxParagraphs(documentXml);
  const headings = paragraphs.filter((paragraph) => isHeadingLike(paragraph.text, paragraph.style));
  const tables = extractDocxTables(documentXml);
  const textCorpus = paragraphs.map((paragraph) => paragraph.text).join("\n");
  const hasText = textCorpus.trim().length > 0;

  return {
    ...base,
    parser: "docx-deep-v1",
    status: hasText ? "inspected" : "metadata_only",
    sourceDateCandidates: helpers.inferDateCandidates(`${base.name}\n${textCorpus}`),
    ownerCandidates: helpers.inferOwnerCandidates(textCorpus),
    structuredSummary: {
      paragraphCount: paragraphs.length,
      headingCount: headings.length,
      tableCount: tables.length,
      tableCellCount: tables.reduce((sum, table) => sum + table.cellCount, 0),
      numberCandidateCount: countNumberCandidates(textCorpus),
      headings: headings.slice(0, 20),
      excerpts: paragraphs.slice(0, 12).map((paragraph) => ({
        paragraphNumber: paragraph.paragraphNumber,
        text: paragraph.text.slice(0, 500)
      })),
      tables
    },
    textPreview: helpers.previewText(textCorpus),
    warnings: hasText ? [] : ["DOCX parser did not find extractable document text."]
  };
}

function extractDocxParagraphs(documentXml: string): ParagraphSummary[] {
  const paragraphs: ParagraphSummary[] = [];
  for (const element of matchElements(documentXml, "p")) {
    const text = normalizeText(extractTextRuns(element.inner));
    if (!text) continue;
    paragraphs.push({
      paragraphNumber: paragraphs.length + 1,
      text,
      style: getParagraphStyle(element.inner)
    });
  }
  return paragraphs;
}

function getParagraphStyle(paragraphInnerXml: string) {
  const styleElement = extractFirstElement(paragraphInnerXml, "pStyle");
  if (!styleElement) return undefined;
  const attrs = parseAttributes(styleElement.attributes);
  return attrs["w:val"] ?? attrs.val;
}

function extractDocxTables(documentXml: string): TableSummary[] {
  return matchElements(documentXml, "tbl").map((table, tableIndex) => {
    const rows = matchElements(table.inner, "tr").map((row) =>
      matchElements(row.inner, "tc")
        .map((cell) => extractParagraphTexts(cell.inner).join(" "))
        .map((text) => normalizeText(text))
    );
    return {
      tableNumber: tableIndex + 1,
      rowCount: rows.length,
      cellCount: rows.reduce((sum, row) => sum + row.length, 0),
      previewRows: rows.slice(0, 5).map((row) => row.slice(0, 8))
    };
  });
}

function isHeadingLike(text: string, style?: string) {
  const normalizedStyle = style?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  if (normalizedStyle.startsWith("heading") || normalizedStyle === "title" || normalizedStyle === "subtitle") return true;
  if (/^\d+(?:\.\d+)*\s+[A-Z][A-Za-z0-9 ,:&/-]{3,80}$/.test(text)) return true;
  if (text.length <= 80 && /[A-Z]/.test(text) && text === text.toUpperCase() && !/[.!?]$/.test(text)) return true;
  return false;
}

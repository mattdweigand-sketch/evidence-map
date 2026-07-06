import type { Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { inferDateCandidates } from "../date-candidates.ts";
import type { FileInspectionRecord } from "../types.ts";
import { expandInputPaths } from "../ingest/expand-input-paths.ts";
import { inspectDocxDocument } from "./docx.ts";
import { extractPdfText } from "./pdf.ts";
import { inspectPptxDeck } from "./pptx.ts";
import { inspectXlsxWorkbook } from "./xlsx.ts";

type FileInspectionDraft = Omit<FileInspectionRecord, "id" | "runId" | "sourceId">;
export interface InspectableFile {
  path: string;
  stat: Stats;
}

export async function buildFileInspections(inputPaths: string[]): Promise<FileInspectionDraft[]> {
  const filePaths = await expandInputPaths(inputPaths);
  const files = await Promise.all(filePaths.map(async (path) => ({ path, stat: await stat(path) })));
  return inspectFiles(files);
}

export async function inspectFiles(files: InspectableFile[]): Promise<FileInspectionDraft[]> {
  return Promise.all(files.map((file) => inspectFileWithStat(file.path, file.stat)));
}

export async function inspectFile(path: string): Promise<FileInspectionDraft> {
  const info = await stat(path);
  return inspectFileWithStat(path, info);
}

async function inspectFileWithStat(path: string, info: Stats): Promise<FileInspectionDraft> {
  const name = basename(path);
  const fileType = extname(path).replace(".", "").toLowerCase() || "unknown";
  const base = {
    name,
    path,
    fileType,
    sizeBytes: info.size,
    modifiedAt: info.mtime.toISOString()
  };

  try {
    if (fileType === "csv" || fileType === "tsv") return await inspectDelimitedText(base, fileType);
    if (fileType === "md" || fileType === "txt") return await inspectPlainText(base, fileType);
    if (fileType === "xlsx" || fileType === "xlsm") {
      return await inspectXlsxWorkbook(base, { inferDateCandidates, inferOwnerCandidates, previewText });
    }
    if (fileType === "pptx") return await inspectPptxDeck(base, { inferDateCandidates, inferOwnerCandidates, previewText });
    if (fileType === "docx") return await inspectDocxDocument(base, { inferDateCandidates, inferOwnerCandidates, previewText });
    if (fileType === "pdf") return await inspectPdf(base);

    return {
      ...base,
      parser: "metadata",
      status: "unsupported",
      sourceDateCandidates: inferDateCandidates(name),
      ownerCandidates: [],
      structuredSummary: {},
      warnings: [`No parser is available for .${fileType} files yet.`]
    };
  } catch (error) {
    return {
      ...base,
      parser: "error",
      status: "failed",
      sourceDateCandidates: inferDateCandidates(name),
      ownerCandidates: [],
      structuredSummary: {},
      warnings: [error instanceof Error ? error.message : "Unknown inspection failure."]
    };
  }
}

async function inspectDelimitedText(
  base: Pick<FileInspectionDraft, "name" | "path" | "fileType" | "sizeBytes" | "modifiedAt">,
  fileType: string
): Promise<FileInspectionDraft> {
  const content = await readSmallText(base.path);
  const delimiter = fileType === "tsv" ? "\t" : ",";
  const rows = parseDelimitedRows(content, delimiter);
  const nonEmptyRows = rows.filter((row) => row.some((value) => value.trim().length > 0));
  const header = nonEmptyRows[0] ?? [];
  const headers = header.map((value) => value.trim()).filter(Boolean);
  const columnCounts = nonEmptyRows.map((row) => row.length);
  const expectedColumnCount = columnCounts[0] ?? 0;
  const inconsistentRows = columnCounts.filter((count) => count !== expectedColumnCount).length;
  const duplicateHeaders = headers.filter((headerValue, index) => headers.indexOf(headerValue) !== index);
  const numberCandidateCount = nonEmptyRows.slice(1).flat().filter(isNumberLike).length;
  const warnings = [
    ...(headers.length === 0 ? ["No header row detected."] : []),
    ...(duplicateHeaders.length > 0 ? [`Duplicate headers detected: ${[...new Set(duplicateHeaders)].join(", ")}.`] : []),
    ...(inconsistentRows > 0 ? [`${inconsistentRows} rows have a different column count from the header row.`] : [])
  ];

  return {
    ...base,
    parser: "delimited-text-v1",
    status: "inspected",
    sourceDateCandidates: inferDateCandidates(`${base.name}\n${content}`),
    ownerCandidates: inferOwnerCandidates(content),
    structuredSummary: {
      delimiter,
      rowCount: rows.length,
      nonEmptyRowCount: nonEmptyRows.length,
      headerCount: headers.length,
      headers,
      blankRowCount: rows.length - nonEmptyRows.length,
      inconsistentRowCount: inconsistentRows,
      numberCandidateCount
    },
    textPreview: previewText(content),
    warnings
  };
}

async function inspectPlainText(
  base: Pick<FileInspectionDraft, "name" | "path" | "fileType" | "sizeBytes" | "modifiedAt">,
  fileType: string
): Promise<FileInspectionDraft> {
  const content = await readSmallText(base.path);
  const lines = content.split(/\r?\n/);
  const headings = lines.filter((line) => /^#{1,6}\s+\S/.test(line) || /^[A-Z][A-Za-z0-9 ,:&/-]{4,}$/.test(line.trim()));
  const numberLikeValues = content.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/g) ?? [];

  return {
    ...base,
    parser: fileType === "md" ? "markdown-text-v1" : "plain-text-v1",
    status: "inspected",
    sourceDateCandidates: inferDateCandidates(`${base.name}\n${content}`),
    ownerCandidates: inferOwnerCandidates(content),
    structuredSummary: {
      lineCount: lines.length,
      nonEmptyLineCount: lines.filter((line) => line.trim()).length,
      headingCount: headings.length,
      headings: headings.slice(0, 20).map((heading) => heading.replace(/^#{1,6}\s+/, "").trim()),
      numberCandidateCount: numberLikeValues.length
    },
    textPreview: previewText(content),
    warnings: []
  };
}

async function inspectPdf(base: Pick<FileInspectionDraft, "name" | "path" | "fileType" | "sizeBytes" | "modifiedAt">): Promise<FileInspectionDraft> {
  const header = await readBytes(base.path, 5);
  const isPdf = Buffer.from(header).toString("utf8") === "%PDF-";
  if (!isPdf) {
    return {
      ...base,
      parser: "pdf-metadata-v1",
      status: "metadata_only",
      sourceDateCandidates: inferDateCandidates(base.name),
      ownerCandidates: [],
      structuredSummary: {
        pdfSignature: false
      },
      warnings: ["File does not have the expected PDF signature."]
    };
  }

  try {
    const extraction = await extractPdfText(base.path);
    const hasText = extraction.paragraphCount > 0;
    return {
      ...base,
      parser: "pdf-text-v1",
      status: hasText ? "inspected" : "metadata_only",
      sourceDateCandidates: inferDateCandidates(`${base.name}\n${extraction.text}`),
      ownerCandidates: inferOwnerCandidates(extraction.text),
      structuredSummary: {
        pdfSignature: true,
        pageCount: extraction.pageCount,
        extractablePageCount: extraction.extractablePageCount,
        paragraphCount: extraction.paragraphCount,
        numberCandidateCount: extraction.numberCandidateCount
      },
      textPreview: previewText(extraction.text),
      warnings: hasText ? [] : ["PDF parser did not return extractable text."]
    };
  } catch (error) {
    return {
      ...base,
      parser: "pdf-text-v1",
      status: "failed",
      sourceDateCandidates: inferDateCandidates(base.name),
      ownerCandidates: [],
      structuredSummary: {
        pdfSignature: true
      },
      warnings: [`PDF text extraction failed: ${error instanceof Error ? error.message : "Unknown extraction failure."}`]
    };
  }
}

async function readSmallText(path: string) {
  const buffer = await readFilePrefix(path, 250_000);
  return buffer.toString("utf8");
}

async function readBytes(path: string, length: number) {
  return [...(await readFilePrefix(path, length))];
}

async function readFilePrefix(path: string, length: number) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function inferOwnerCandidates(value: string) {
  const candidates = new Set<string>();
  for (const match of value.matchAll(/\b(?:owner|prepared by|author)\s*:\s*([^\n\r]+)/gi)) {
    candidates.add(match[1].trim().slice(0, 120));
  }
  return [...candidates];
}

function parseDelimitedRows(content: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function isNumberLike(value: string) {
  return /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?$|^-?\d+(?:\.\d+)?%?$/.test(value.trim());
}

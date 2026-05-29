import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { FileInspectionRecord } from "../types.ts";
import { expandInputPaths } from "../ingest/expand-input-paths.ts";
import { inspectXlsxWorkbook } from "./xlsx.ts";

type FileInspectionDraft = Omit<FileInspectionRecord, "id" | "runId" | "sourceId">;

export async function buildFileInspections(inputPaths: string[]): Promise<FileInspectionDraft[]> {
  const filePaths = await expandInputPaths(inputPaths);
  return Promise.all(filePaths.map(inspectFile));
}

export async function inspectFile(path: string): Promise<FileInspectionDraft> {
  const info = await stat(path);
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
    if (fileType === "pptx" || fileType === "docx") return await inspectOfficePackage(base, fileType);
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
  const rows = content.split(/\r?\n/);
  const nonEmptyRows = rows.filter((row) => row.trim().length > 0);
  const header = nonEmptyRows[0] ?? "";
  const headers = header.split(delimiter).map((value) => value.trim()).filter(Boolean);
  const columnCounts = nonEmptyRows.map((row) => row.split(delimiter).length);
  const expectedColumnCount = columnCounts[0] ?? 0;
  const inconsistentRows = columnCounts.filter((count) => count !== expectedColumnCount).length;
  const duplicateHeaders = headers.filter((headerValue, index) => headers.indexOf(headerValue) !== index);
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
      inconsistentRowCount: inconsistentRows
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

async function inspectOfficePackage(
  base: Pick<FileInspectionDraft, "name" | "path" | "fileType" | "sizeBytes" | "modifiedAt">,
  fileType: string
): Promise<FileInspectionDraft> {
  const header = await readBytes(base.path, 4);
  const isZipPackage = header[0] === 0x50 && header[1] === 0x4b;

  return {
    ...base,
    parser: "office-package-metadata-v1",
    status: "metadata_only",
    sourceDateCandidates: inferDateCandidates(base.name),
    ownerCandidates: [],
    structuredSummary: {
      packageType: fileType,
      zipPackage: isZipPackage
    },
    warnings: [
      ...(isZipPackage ? [] : ["File does not have the expected Office ZIP package signature."]),
      `Deep .${fileType} inspection is not implemented yet.`
    ]
  };
}

async function inspectPdf(base: Pick<FileInspectionDraft, "name" | "path" | "fileType" | "sizeBytes" | "modifiedAt">): Promise<FileInspectionDraft> {
  const header = await readBytes(base.path, 5);
  const isPdf = Buffer.from(header).toString("utf8") === "%PDF-";

  return {
    ...base,
    parser: "pdf-metadata-v1",
    status: "metadata_only",
    sourceDateCandidates: inferDateCandidates(base.name),
    ownerCandidates: [],
    structuredSummary: {
      pdfSignature: isPdf
    },
    warnings: [
      ...(isPdf ? [] : ["File does not have the expected PDF signature."]),
      "Deep PDF text and table inspection is not implemented yet."
    ]
  };
}

async function readSmallText(path: string) {
  const buffer = await readFile(path);
  return buffer.toString("utf8").slice(0, 250_000);
}

async function readBytes(path: string, length: number) {
  const buffer = await readFile(path);
  return [...buffer.subarray(0, length)];
}

function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function inferDateCandidates(value: string) {
  const candidates = new Set<string>();
  for (const match of value.matchAll(/\b(20\d{2})[-_/]?([01]\d)[-_/]?([0-3]\d)\b/g)) {
    candidates.add(`${match[1]}-${match[2]}-${match[3]}`);
  }
  for (const match of value.matchAll(/\b([01]\d)[-_/]([0-3]\d)[-_/](20\d{2})\b/g)) {
    candidates.add(`${match[3]}-${match[1]}-${match[2]}`);
  }
  return [...candidates].sort();
}

function inferOwnerCandidates(value: string) {
  const candidates = new Set<string>();
  for (const match of value.matchAll(/\b(?:owner|prepared by|author)\s*:\s*([^\n\r]+)/gi)) {
    candidates.add(match[1].trim().slice(0, 120));
  }
  return [...candidates];
}

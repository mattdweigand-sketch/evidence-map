import { createHash } from "node:crypto";
import { normalizeSourceDate } from "../date-candidates.ts";
import type { EvidenceSnippetKind, FileInspectionRecord, ReviewStatus, SourceEvidenceRecord, SourceRecord } from "../types.ts";

type SourceEvidenceDraft = Omit<SourceEvidenceRecord, "runId">;

interface DelimitedSummary {
  headers?: unknown;
  rows?: unknown;
}

interface TextExcerpt {
  paragraphNumber?: unknown;
  text?: unknown;
}

interface TextSummary {
  excerpts?: unknown;
}

interface PdfPageSummary {
  pageNumber?: unknown;
  paragraphs?: unknown;
}

interface PdfSummary {
  pages?: unknown;
}

interface DocxTableSummary {
  tableNumber?: unknown;
  previewRows?: unknown;
}

interface DocxSummary {
  excerpts?: unknown;
  tables?: unknown;
}

interface PptxSlideSummary {
  slideNumber?: unknown;
  text?: unknown;
  notesText?: unknown;
}

interface PptxSummary {
  slides?: unknown;
}

interface WorkbookSheetSummary {
  name?: unknown;
  apparentPurpose?: unknown;
  state?: unknown;
  rowCount?: unknown;
  columnCount?: unknown;
  headers?: unknown;
}

interface WorkbookSummary {
  sheets?: unknown;
}

const numberPattern = /\b-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b|\b-?\d+(?:\.\d+)?%?\b/g;

export function buildSourceEvidenceRecords(input: {
  runId: string;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
}): SourceEvidenceDraft[] {
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const evidence: SourceEvidenceDraft[] = [];

  for (const inspection of input.inspections) {
    if (!inspection.sourceId) continue;
    const source = sourceById.get(inspection.sourceId);
    if (!source) continue;
    evidence.push(...snippetsForInspection({ runId: input.runId, source, inspection }));
  }

  return dedupeEvidence(evidence);
}

function snippetsForInspection(input: {
  runId: string;
  source: SourceRecord;
  inspection: FileInspectionRecord;
}): SourceEvidenceDraft[] {
  const snippets: SourceEvidenceDraft[] = [];
  const parser = input.inspection.parser;

  if (parser === "delimited-text-v1") {
    snippets.push(...buildTableRowSnippets(input));
  } else if (parser === "markdown-text-v1" || parser === "plain-text-v1") {
    snippets.push(...buildParagraphSnippets(input, input.inspection.structuredSummary as TextSummary));
  } else if (parser === "pdf-text-v1") {
    snippets.push(...buildPdfSnippets(input));
  } else if (parser === "docx-deep-v1") {
    snippets.push(...buildDocxSnippets(input));
  } else if (parser === "pptx-deep-v1") {
    snippets.push(...buildPptxSnippets(input));
  } else if (parser === "xlsx-workbook-doctor-v1") {
    snippets.push(...buildWorkbookSnippets(input));
  }

  if (snippets.length === 0 && input.inspection.textPreview) {
    const draft = buildSnippet({
      ...input,
      kind: "file_summary",
      anchor: "summary",
      text: input.inspection.textPreview
    });
    if (draft) snippets.push(draft);
  }

  return snippets;
}

function buildTableRowSnippets(input: {
  runId: string;
  source: SourceRecord;
  inspection: FileInspectionRecord;
}) {
  const summary = input.inspection.structuredSummary as DelimitedSummary;
  const headers = arrayOfStrings(summary.headers);
  const rows = arrayOfStringRows(summary.rows);
  const dataRows = rows.slice(headers.length > 0 ? 1 : 0);
  return dataRows.flatMap((row, index) => {
    const rowNumber = index + (headers.length > 0 ? 2 : 1);
    const text = headers.length > 0 ? rowToLabeledText(headers, row) : row.join("; ");
    const draft = buildSnippet({
      ...input,
      kind: "table_row",
      anchor: `row:${rowNumber}`,
      text
    });
    return draft ? [draft] : [];
  });
}

function buildParagraphSnippets(
  input: {
    runId: string;
    source: SourceRecord;
    inspection: FileInspectionRecord;
  },
  summary: TextSummary
) {
  const excerpts = arrayOfExcerptObjects(summary.excerpts);
  return excerpts.flatMap((excerpt) => {
    const draft = buildSnippet({
      ...input,
      kind: "paragraph",
      anchor: `paragraph:${excerpt.paragraphNumber}`,
      text: excerpt.text
    });
    return draft ? [draft] : [];
  });
}

function buildPdfSnippets(input: {
  runId: string;
  source: SourceRecord;
  inspection: FileInspectionRecord;
}) {
  const summary = input.inspection.structuredSummary as PdfSummary;
  const pages = arrayOfPdfPages(summary.pages);
  return pages.flatMap((page) =>
    page.paragraphs.flatMap((paragraph, index) => {
      const draft = buildSnippet({
        ...input,
        kind: "paragraph",
        anchor: `page:${page.pageNumber}:paragraph:${index + 1}`,
        text: paragraph
      });
      return draft ? [draft] : [];
    })
  );
}

function buildDocxSnippets(input: {
  runId: string;
  source: SourceRecord;
  inspection: FileInspectionRecord;
}) {
  const summary = input.inspection.structuredSummary as DocxSummary;
  const excerpts = arrayOfExcerptObjects(summary.excerpts).flatMap((excerpt) => {
    const draft = buildSnippet({
      ...input,
      kind: "paragraph",
      anchor: `paragraph:${excerpt.paragraphNumber}`,
      text: excerpt.text
    });
    return draft ? [draft] : [];
  });
  const tables = arrayOfDocxTables(summary.tables).flatMap((table) =>
    table.previewRows.flatMap((row, index) => {
      const draft = buildSnippet({
        ...input,
        kind: "table_row",
        anchor: `table:${table.tableNumber}:row:${index + 1}`,
        text: row.join("; ")
      });
      return draft ? [draft] : [];
    })
  );
  return [...excerpts, ...tables];
}

function buildPptxSnippets(input: {
  runId: string;
  source: SourceRecord;
  inspection: FileInspectionRecord;
}) {
  const summary = input.inspection.structuredSummary as PptxSummary;
  const slides = arrayOfPptxSlides(summary.slides);
  return slides.flatMap((slide) => {
    const drafts: SourceEvidenceDraft[] = [];
    const textSnippet = buildSnippet({
      ...input,
      kind: "slide_text",
      anchor: `slide:${slide.slideNumber}:text`,
      text: slide.text
    });
    if (textSnippet) drafts.push(textSnippet);
    const notesSnippet = buildSnippet({
      ...input,
      kind: "speaker_notes",
      anchor: `slide:${slide.slideNumber}:notes`,
      text: slide.notesText
    });
    if (notesSnippet) drafts.push(notesSnippet);
    return drafts;
  });
}

function buildWorkbookSnippets(input: {
  runId: string;
  source: SourceRecord;
  inspection: FileInspectionRecord;
}) {
  const summary = input.inspection.structuredSummary as WorkbookSummary;
  return arrayOfWorkbookSheets(summary.sheets).flatMap((sheet) => {
    const details = [
      `Sheet ${sheet.name}`,
      `purpose: ${sheet.apparentPurpose}`,
      `state: ${sheet.state}`,
      `rows: ${sheet.rowCount}`,
      `columns: ${sheet.columnCount}`,
      sheet.headers.length > 0 ? `headers: ${sheet.headers.join(", ")}` : undefined
    ].filter((value): value is string => Boolean(value));
    const draft = buildSnippet({
      ...input,
      kind: "workbook_sheet",
      anchor: `sheet:${sheet.name}`,
      text: details.join("; ")
    });
    return draft ? [draft] : [];
  });
}

function buildSnippet(input: {
  runId: string;
  source: SourceRecord;
  inspection: FileInspectionRecord;
  kind: EvidenceSnippetKind;
  anchor: string;
  text?: string;
}): SourceEvidenceDraft | undefined {
  const text = normalizeSnippetText(input.text ?? "");
  if (!hasMeaningfulText(text)) return undefined;
  const cappedText = text.slice(0, 1_000);
  const id = stableEvidenceId(input.runId, input.source.id, input.kind, input.anchor, cappedText);
  const sourceDate = normalizeSourceDate(input.source.sourceDate) ?? normalizeSourceDate(input.inspection.sourceDateCandidates[0]);
  return {
    id,
    sourceId: input.source.id,
    sourceName: input.source.name,
    kind: input.kind,
    anchor: input.anchor,
    text: cappedText,
    sourceDate,
    numberCandidates: numberCandidates(cappedText),
    ownerCandidates: input.inspection.ownerCandidates,
    reviewStatus: initialReviewStatus(input.source, input.inspection),
    useStatus: "candidate"
  };
}

function initialReviewStatus(source: SourceRecord, inspection: FileInspectionRecord): ReviewStatus {
  if (inspection.status === "inspected" && ["current", "raw_data", "transcript"].includes(source.status)) return "verified";
  return "needs_review";
}

function stableEvidenceId(runId: string, sourceId: string, kind: EvidenceSnippetKind, anchor: string, text: string) {
  const normalized = normalizeForHash(text);
  const hash = createHash("sha256").update([runId, sourceId, kind, anchor, normalized].join("\0")).digest("hex").slice(0, 20);
  return `evidence_${hash}`;
}

function dedupeEvidence(evidence: SourceEvidenceDraft[]) {
  const byId = new Map<string, SourceEvidenceDraft>();
  for (const item of evidence) byId.set(item.id, item);
  return [...byId.values()];
}

function rowToLabeledText(headers: string[], row: string[]) {
  return row
    .map((value, index) => {
      const header = headers[index] ?? `column_${index + 1}`;
      return `${header}: ${value}`;
    })
    .filter((value) => !value.endsWith(": "))
    .join("; ");
}

function normalizeSnippetText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForHash(value: string) {
  return normalizeSnippetText(value).toLowerCase();
}

function hasMeaningfulText(value: string) {
  return value.length >= 3 && /[A-Za-z0-9]/.test(value);
}

function numberCandidates(value: string) {
  return [...new Set(value.match(numberPattern) ?? [])];
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayOfStringRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => (typeof cell === "string" ? cell : String(cell ?? ""))));
}

function arrayOfExcerptObjects(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as TextExcerpt;
    const paragraphNumber = typeof record.paragraphNumber === "number" ? record.paragraphNumber : undefined;
    const text = typeof record.text === "string" ? record.text : undefined;
    if (paragraphNumber === undefined || text === undefined) return [];
    return [{ paragraphNumber, text }];
  });
}

function arrayOfPdfPages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as PdfPageSummary;
    const pageNumber = typeof record.pageNumber === "number" ? record.pageNumber : undefined;
    const paragraphs = arrayOfStrings(record.paragraphs);
    if (pageNumber === undefined || paragraphs.length === 0) return [];
    return [{ pageNumber, paragraphs }];
  });
}

function arrayOfDocxTables(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as DocxTableSummary;
    const tableNumber = typeof record.tableNumber === "number" ? record.tableNumber : undefined;
    const previewRows = arrayOfStringRows(record.previewRows);
    if (tableNumber === undefined || previewRows.length === 0) return [];
    return [{ tableNumber, previewRows }];
  });
}

function arrayOfPptxSlides(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as PptxSlideSummary;
    const slideNumber = typeof record.slideNumber === "number" ? record.slideNumber : undefined;
    if (slideNumber === undefined) return [];
    return [
      {
        slideNumber,
        text: typeof record.text === "string" ? record.text : undefined,
        notesText: typeof record.notesText === "string" ? record.notesText : undefined
      }
    ];
  });
}

function arrayOfWorkbookSheets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as WorkbookSheetSummary;
    const name = typeof record.name === "string" ? record.name : undefined;
    if (!name) return [];
    return [
      {
        name,
        apparentPurpose: typeof record.apparentPurpose === "string" ? record.apparentPurpose : "unclear",
        state: typeof record.state === "string" ? record.state : "unknown",
        rowCount: typeof record.rowCount === "number" ? record.rowCount : 0,
        columnCount: typeof record.columnCount === "number" ? record.columnCount : 0,
        headers: arrayOfStrings(record.headers)
      }
    ];
  });
}

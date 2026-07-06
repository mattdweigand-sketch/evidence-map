import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

export interface PdfTextPage {
  pageNumber: number;
  text: string;
  paragraphs: string[];
  sections: string[];
  citations: string[];
  tableLikeRows: string[][];
}

export interface PdfTextExtraction {
  pageCount: number;
  extractablePageCount: number;
  paragraphCount: number;
  sectionCount: number;
  citationCount: number;
  tableLikeRowCount: number;
  numberCandidateCount: number;
  text: string;
  pages: PdfTextPage[];
}

export async function extractPdfText(path: string): Promise<PdfTextExtraction> {
  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: await readFile(path) });
    const textResult = await parser.getText({ pageJoiner: "" });
    const pages = textResult.pages.map((page) => {
      const text = page.text ?? "";
      return {
        pageNumber: page.num,
        text,
        paragraphs: splitTextParagraphs(text),
        sections: sectionHeadings(text),
        citations: citationCandidates(text),
        tableLikeRows: tableLikeRows(text)
      };
    });
    const text = pages.map((page) => page.text).join("\n");
    const paragraphCount = pages.reduce((total, page) => total + page.paragraphs.length, 0);
    const sectionCount = pages.reduce((total, page) => total + page.sections.length, 0);
    const citationCount = pages.reduce((total, page) => total + page.citations.length, 0);
    const tableLikeRowCount = pages.reduce((total, page) => total + page.tableLikeRows.length, 0);

    return {
      pageCount: textResult.pages.length,
      extractablePageCount: pages.filter((page) => page.paragraphs.length > 0).length,
      paragraphCount,
      sectionCount,
      citationCount,
      tableLikeRowCount,
      numberCandidateCount: countNumberCandidates(text),
      text,
      pages
    };
  } finally {
    await parser?.destroy();
  }
}

function splitTextParagraphs(value: string) {
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

function countNumberCandidates(value: string) {
  return value.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/g)?.length ?? 0;
}

function sectionHeadings(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 120)
    .filter((line) => /^#{1,6}\s+\S/.test(line) || /^\d+(?:\.\d+)*\.?\s+[A-Z][A-Za-z0-9 ,:&/-]+$/.test(line) || /^[A-Z][A-Z0-9 ,:&/-]{4,}$/.test(line))
    .slice(0, 50);
}

function citationCandidates(value: string) {
  const citations = new Set<string>();
  for (const match of value.matchAll(/\b\d+\s+[A-Z][A-Za-z. ]+\s+\d+\b/g)) citations.add(match[0].trim());
  for (const match of value.matchAll(/\b[A-Z][A-Za-z]+ v\. [A-Z][A-Za-z]+,?\s+\d+/g)) citations.add(match[0].trim());
  for (const match of value.matchAll(/\b(?:Exhibit|Appendix|Table|Figure)\s+[A-Z0-9.-]+\b/gi)) citations.add(match[0].trim());
  return [...citations].slice(0, 100);
}

function tableLikeRows(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /\d/.test(line) && (line.includes("|") || /\S\s{2,}\S/.test(line)))
    .map((line) => line.split(/\s*\|\s*|\s{2,}/).map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells.length >= 2)
    .slice(0, 100);
}

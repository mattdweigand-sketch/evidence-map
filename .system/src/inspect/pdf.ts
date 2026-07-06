import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

export interface PdfTextPage {
  pageNumber: number;
  text: string;
  paragraphs: string[];
}

export interface PdfTextExtraction {
  pageCount: number;
  extractablePageCount: number;
  paragraphCount: number;
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
        paragraphs: splitTextParagraphs(text)
      };
    });
    const text = pages.map((page) => page.text).join("\n");
    const paragraphCount = pages.reduce((total, page) => total + page.paragraphs.length, 0);

    return {
      pageCount: textResult.pages.length,
      extractablePageCount: pages.filter((page) => page.paragraphs.length > 0).length,
      paragraphCount,
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

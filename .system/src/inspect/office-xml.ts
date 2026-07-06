import type JSZip from "jszip";

export interface XmlElement {
  attributes: string;
  inner: string;
}

export async function readRequiredXml(zip: JSZip, path: string, packageName: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`${packageName} package is missing ${path}.`);
  return file.async("text");
}

export async function readOptionalXml(zip: JSZip, path: string) {
  return zip.file(path)?.async("text");
}

export function matchElements(xml: string, localName: string): XmlElement[] {
  const tag = `(?:[\\w.-]+:)?${escapeRegExp(localName)}`;
  const pattern = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");
  const elements: XmlElement[] = [];
  for (const match of xml.matchAll(pattern)) {
    elements.push({ attributes: match[1] ?? "", inner: match[2] ?? "" });
  }
  return elements;
}

export function extractFirstElement(xml: string, localName: string) {
  return matchElements(xml, localName)[0];
}

export function extractParagraphTexts(xml: string) {
  return matchElements(xml, "p")
    .map((element) => normalizeText(extractTextRuns(element.inner)))
    .filter(Boolean);
}

export function extractTextRuns(xml: string) {
  const withBreaks = xml.replace(/<(?:[\w.-]+:)?(?:tab|br)\b[^>]*\/>/g, " ");
  return matchElements(withBreaks, "t")
    .map((element) => decodeXml(element.inner))
    .join("");
}

export function parseAttributes(value: string) {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1] ?? ""] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

export function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function countNumberCandidates(value: string) {
  return value.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/g)?.length ?? 0;
}

export function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => decodeCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodeCodePoint(value: number) {
  return Number.isFinite(value) ? String.fromCodePoint(value) : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

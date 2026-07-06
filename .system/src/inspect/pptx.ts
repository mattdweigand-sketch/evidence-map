import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import JSZip from "jszip";
import type { FileInspectionRecord } from "../types.ts";
import { countNumberCandidates, extractParagraphTexts, matchElements, parseAttributes, readOptionalXml, readRequiredXml } from "./office-xml.ts";

type FileInspectionDraft = Omit<FileInspectionRecord, "id" | "runId" | "sourceId">;
type BaseFileInspection = Pick<FileInspectionDraft, "name" | "path" | "fileType" | "sizeBytes" | "modifiedAt">;

interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
}

interface SlideSummary {
  slideNumber: number;
  title?: string;
  text: string;
  textTruncated: boolean;
  notesText?: string;
  notesTextTruncated: boolean;
  chartReferenceCount: number;
}

export async function inspectPptxDeck(
  base: BaseFileInspection,
  helpers: {
    inferDateCandidates(value: string): string[];
    inferOwnerCandidates(value: string): string[];
    previewText(value: string): string;
  }
): Promise<FileInspectionDraft> {
  const zip = await JSZip.loadAsync(await readFile(base.path));
  await readRequiredXml(zip, "[Content_Types].xml", "PPTX");
  await readRequiredXml(zip, "ppt/presentation.xml", "PPTX");

  const slideFiles = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((left, right) => officePartNumber(left.name) - officePartNumber(right.name) || left.name.localeCompare(right.name));
  const slideResults = [];
  for (const file of slideFiles) {
    slideResults.push(await inspectSlide(zip, file.name));
  }
  const slides = slideResults.map((result) => result.slide);
  const warnings = slideResults.flatMap((result) => result.warnings);
  const textCorpus = slides
    .flatMap((slide) => [slide.text, slide.notesText ?? ""])
    .filter(Boolean)
    .join("\n");
  const hasText = textCorpus.trim().length > 0;

  return {
    ...base,
    parser: "pptx-deep-v1",
    status: hasText ? "inspected" : "metadata_only",
    sourceDateCandidates: helpers.inferDateCandidates(`${base.name}\n${textCorpus}`),
    ownerCandidates: helpers.inferOwnerCandidates(textCorpus),
    structuredSummary: {
      slideCount: slides.length,
      slideTextCount: slides.filter((slide) => slide.text.length > 0).length,
      noteSlideCount: slides.filter((slide) => (slide.notesText ?? "").length > 0).length,
      chartReferenceCount: slides.reduce((sum, slide) => sum + slide.chartReferenceCount, 0),
      numberCandidateCount: countNumberCandidates(textCorpus),
      slides
    },
    textPreview: helpers.previewText(textCorpus),
    warnings: [
      ...warnings,
      ...(slides.length === 0 ? ["PPTX package did not contain slide XML parts."] : []),
      ...(hasText ? [] : ["PPTX parser did not find extractable slide or speaker notes text."])
    ]
  };
}

async function inspectSlide(zip: JSZip, slidePath: string): Promise<{ slide: SlideSummary; warnings: string[] }> {
  const slideNumber = officePartNumber(slidePath);
  const slideXml = await readRequiredXml(zip, slidePath, "PPTX");
  const relationships = await readRelationships(zip, slidePath);
  const slideParagraphs = extractParagraphTexts(slideXml);
  const text = slideParagraphs.join("\n");
  const notesRelationship = relationships.find((relationship) => relationship.type.includes("/notesSlide"));
  const notesPath = notesRelationship ? resolveOfficeTarget(slidePath, notesRelationship.target) : `ppt/notesSlides/notesSlide${slideNumber}.xml`;
  const notesXml = await readOptionalXml(zip, notesPath);
  const notesText = notesXml ? extractParagraphTexts(notesXml).join("\n") : "";
  const chartRelationshipCount = relationships.filter((relationship) => isChartRelationship(relationship)).length;
  const chartXmlReferenceCount = matchElements(slideXml, "chart").length;

  return {
    slide: {
      slideNumber,
      title: slideParagraphs[0]?.slice(0, 180),
      text: text.slice(0, 2_000),
      textTruncated: text.length > 2_000,
      notesText: notesText ? notesText.slice(0, 2_000) : undefined,
      notesTextTruncated: notesText.length > 2_000,
      chartReferenceCount: Math.max(chartRelationshipCount, chartXmlReferenceCount)
    },
    warnings: notesRelationship && !notesXml ? [`Slide ${slideNumber}: notes relationship target ${notesPath} was not found.`] : []
  };
}

async function readRelationships(zip: JSZip, sourcePath: string) {
  const relsPath = posix.join(posix.dirname(sourcePath), "_rels", `${posix.basename(sourcePath)}.rels`);
  const relsXml = await readOptionalXml(zip, relsPath);
  if (!relsXml) return [];
  return matchElements(relsXml, "Relationship")
    .map((element): Relationship => {
      const attrs = parseAttributes(element.attributes);
      return {
        id: attrs.Id ?? "",
        type: attrs.Type ?? "",
        target: attrs.Target ?? "",
        targetMode: attrs.TargetMode
      };
    })
    .filter((relationship) => relationship.target && relationship.targetMode !== "External");
}

function isChartRelationship(relationship: Relationship) {
  return relationship.type.includes("/chart") || relationship.target.includes("/charts/") || relationship.target.includes("../charts/");
}

function resolveOfficeTarget(sourcePath: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  return posix.normalize(posix.join(posix.dirname(sourcePath), target));
}

function officePartNumber(path: string) {
  const match = path.match(/(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

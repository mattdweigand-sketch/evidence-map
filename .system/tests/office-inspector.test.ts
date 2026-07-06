import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { inspectFile } from "../src/inspect/index.ts";

test("pptx inspection extracts slide text, notes text, and chart references", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-pptx-"));
  const path = join(dir, "2026-05-01-board-deck.pptx");
  await writeZip(path, {
    "[Content_Types].xml": contentTypesXml(),
    "ppt/presentation.xml": presentationXml(),
    "ppt/slides/slide1.xml": slideXml(),
    "ppt/slides/_rels/slide1.xml.rels": slideRelsXml(),
    "ppt/notesSlides/notesSlide1.xml": notesSlideXml(),
    "ppt/charts/chart1.xml": chartXml()
  });

  const inspection = await inspectFile(path);
  const slides = inspection.structuredSummary.slides as Array<{ title?: string; text: string; notesText?: string; chartReferenceCount: number }>;

  assert.equal(inspection.parser, "pptx-deep-v1");
  assert.equal(inspection.status, "inspected");
  assert.equal(inspection.structuredSummary.slideCount, 1);
  assert.equal(inspection.structuredSummary.noteSlideCount, 1);
  assert.equal(inspection.structuredSummary.chartReferenceCount, 1);
  assert.equal(slides[0]?.title, "Q2 Enrollment Review");
  assert.match(slides[0]?.text ?? "", /Revenue increased to 42/);
  assert.match(slides[0]?.notesText ?? "", /Owner: Research Team/);
  assert.match(inspection.textPreview ?? "", /Q2 Enrollment Review/);
  assert.ok(inspection.ownerCandidates.some((candidate) => candidate.startsWith("Research Team")));
  assert.deepEqual(inspection.warnings, []);
});

test("docx inspection extracts paragraphs, headings, and table text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-docx-"));
  const path = join(dir, "2026-05-01-research-memo.docx");
  await writeZip(path, {
    "[Content_Types].xml": contentTypesXml(),
    "word/document.xml": documentXml()
  });

  const inspection = await inspectFile(path);
  const headings = inspection.structuredSummary.headings as Array<{ text: string; style?: string }>;
  const tables = inspection.structuredSummary.tables as Array<{ rowCount: number; cellCount: number; previewRows: string[][] }>;

  assert.equal(inspection.parser, "docx-deep-v1");
  assert.equal(inspection.status, "inspected");
  assert.equal(inspection.structuredSummary.paragraphCount, 4);
  assert.equal(inspection.structuredSummary.headingCount, 1);
  assert.equal(inspection.structuredSummary.tableCount, 1);
  assert.equal(inspection.structuredSummary.tableCellCount, 2);
  assert.deepEqual(headings[0], { paragraphNumber: 1, text: "Executive Summary", style: "Heading1" });
  assert.deepEqual(tables[0]?.previewRows, [["Metric", "Enrollment"]]);
  assert.match(inspection.textPreview ?? "", /Enrollment was 42/);
  assert.ok(inspection.ownerCandidates.some((candidate) => candidate.startsWith("Research Team")));
  assert.deepEqual(inspection.warnings, []);
});

test("invalid office packages fail inspection instead of succeeding as metadata only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-office-invalid-"));

  for (const extension of ["pptx", "docx"]) {
    const path = join(dir, `broken.${extension}`);
    await writeFile(path, "not an office zip package");

    const inspection = await inspectFile(path);

    assert.equal(inspection.status, "failed");
    assert.equal(inspection.parser, "error");
    assert.match(inspection.warnings.join(" "), /zip|central directory|package/i);
  }
});

async function writeZip(path: string, entries: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`;
}

function presentationXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`;
}

function slideXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Q2 Enrollment Review</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:txBody><a:p><a:r><a:t>Revenue increased to 42 in the pilot cohort.</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function slideRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`;
}

function notesSlideXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Owner: Research Team.</a:t></a:r></a:p>
    <a:p><a:r><a:t>Use the 2026-05-01 source packet for support.</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;
}

function chartXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>`;
}

function documentXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Executive Summary</w:t></w:r></w:p>
    <w:p><w:r><w:t>Owner: Research Team. Enrollment was 42 on 2026-05-01.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Metric</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Enrollment</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
}

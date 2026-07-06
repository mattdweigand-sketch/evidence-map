import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inferDateCandidates } from "../src/date-candidates.ts";
import { buildSourcePacket } from "../src/ingest/source-packet.ts";
import { inspectFile } from "../src/inspect/index.ts";

test("source packet labels obvious source roles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "2026-05-01-raw-export.csv"), "a,b\n1,2\n");
  await writeFile(join(input, "plan-estimate.xlsx"), "placeholder");

  const packet = await buildSourcePacket([input]);
  assert.equal(packet.sources.length, 2);
  assert.equal(packet.inspections.length, 2);
  assert.equal(packet.sources.find((source) => source.name.endsWith(".csv"))?.status, "raw_data");
  assert.equal(packet.sources.find((source) => source.name.endsWith(".xlsx"))?.status, "estimate");
  const csvInspection = packet.inspections.find((inspection) => inspection.name.endsWith(".csv"));
  assert.equal(csvInspection?.status, "inspected");
  assert.deepEqual(csvInspection?.structuredSummary.headers, ["a", "b"]);
});

test("source packet uses recursive input paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-recursive-"));
  const input = join(dir, "input");
  const nested = join(input, "nested");
  await mkdir(nested, { recursive: true });
  await writeFile(join(input, "2026-05-01-top.csv"), "a,b\n1,2\n");
  await writeFile(join(nested, "2026-05-01-nested.csv"), "a,b\n3,4\n");

  const packet = await buildSourcePacket([input]);
  assert.deepEqual(packet.sources.map((source) => source.name).sort(), ["2026-05-01-nested.csv", "2026-05-01-top.csv"]);
});

test("source packet avoids substring status and invalid date inference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-inference-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "goldman-2026-19-39-raw-export.csv"), "metric,value\nrevenue,100\n");

  const packet = await buildSourcePacket([input]);
  assert.equal(packet.sources[0]?.status, "raw_data");
  assert.equal(packet.sources[0]?.sourceDate, undefined);
});

test("source packet infers same-metric dated conflicts when statuses match", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-metric-conflict-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "2026-03-02-enrollment-figures.csv"), "metric,value\nenrollment,100\n");
  await writeFile(join(input, "2026-04-30-enrollment-figures.csv"), "metric,value\nenrollment,110\n");

  const packet = await buildSourcePacket([input]);

  assert.equal(packet.conflicts.length, 1);
  assert.equal(packet.conflicts[0]?.severity, "warning");
  assert.equal(packet.conflicts[0]?.status, "open");
  assert.match(packet.conflicts[0]?.description ?? "", /Potential same-metric dated conflict/);
  assert.ok(packet.conflicts[0]?.sourcePaths.some((path) => path.endsWith("2026-03-02-enrollment-figures.csv")));
  assert.ok(packet.conflicts[0]?.sourcePaths.some((path) => path.endsWith("2026-04-30-enrollment-figures.csv")));
});

test("source packet infers same-metric dated conflicts across common metric aliases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-alias-conflict-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "2026-03-02-revenue.csv"), "metric,value\nrevenue,100\n");
  await writeFile(join(input, "2026-04-30-sales.csv"), "metric,value\nsales,110\n");

  const packet = await buildSourcePacket([input]);

  assert.equal(packet.conflicts.length, 1);
  assert.match(packet.conflicts[0]?.description ?? "", /Potential same-metric dated conflict/);
  assert.ok(packet.conflicts[0]?.sourcePaths.some((path) => path.endsWith("2026-03-02-revenue.csv")));
  assert.ok(packet.conflicts[0]?.sourcePaths.some((path) => path.endsWith("2026-04-30-sales.csv")));
});

test("source packet does not infer conflicts for unrelated dated files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-unrelated-dates-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "2026-03-02-enrollment-figures.csv"), "metric,value\nenrollment,100\n");
  await writeFile(join(input, "2026-04-30-staffing-figures.csv"), "metric,value\nstaffing,12\n");

  const packet = await buildSourcePacket([input]);

  assert.deepEqual(packet.conflicts, []);
});

test("source packet does not infer same-metric conflicts for recurring narrative files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-narrative-dates-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "2026-03-02-board-report.pdf"), "%PDF-1.4\nnot parsed in this test\n%%EOF\n");
  await writeFile(join(input, "2026-04-30-board-report.pdf"), "%PDF-1.4\nnot parsed in this test\n%%EOF\n");

  const packet = await buildSourcePacket([input]);

  assert.deepEqual(packet.conflicts, []);
});

test("source packet preserves old/final status conflicts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-status-conflict-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "old-board-model.csv"), "label\nold\n");
  await writeFile(join(input, "final-board-model.csv"), "label\nfinal\n");

  const packet = await buildSourcePacket([input]);

  assert.equal(packet.conflicts.length, 1);
  assert.match(packet.conflicts[0]?.description ?? "", /Potential version\/status conflict/);
  assert.equal(packet.conflicts[0]?.severity, "warning");
  assert.equal(packet.conflicts[0]?.status, "open");
});

test("source packet does not infer same-metric conflicts from invalid date-like names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-invalid-date-conflict-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "2026-19-39-enrollment-figures.csv"), "metric,value\nenrollment,100\n");
  await writeFile(join(input, "2026-20-40-enrollment-figures.csv"), "metric,value\nenrollment,110\n");

  const packet = await buildSourcePacket([input]);

  assert.equal(packet.sources[0]?.sourceDate, undefined);
  assert.equal(packet.sources[1]?.sourceDate, undefined);
  assert.deepEqual(packet.conflicts, []);
});

test("date inference handles single-digit US dates and strict compact year-first dates", () => {
  assert.deepEqual(inferDateCandidates("survey exported 4/12/2026"), ["2026-04-12"]);
  assert.deepEqual(inferDateCandidates("bad compact date 2026-0430"), []);
  assert.deepEqual(inferDateCandidates("survey exported 20260430"), ["2026-04-30"]);
});

test("csv inspection handles quoted delimiters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-csv-"));
  const path = join(dir, "2026-05-01-quoted.csv");
  await writeFile(path, "name,notes\nAcme,\"hello, world\"\n");

  const inspection = await inspectFile(path);
  assert.equal(inspection.structuredSummary.inconsistentRowCount, 0);
  assert.deepEqual(inspection.warnings, []);
});

test("pdf inspection extracts text-based page content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-pdf-"));
  const path = join(dir, "2026-05-01-report.pdf");
  await writeFile(path, makePdfBuffer("Owner: Research Team. Revenue was 42."));

  const inspection = await inspectFile(path);

  assert.equal(inspection.parser, "pdf-text-v1");
  assert.equal(inspection.status, "inspected");
  assert.equal(inspection.structuredSummary.pdfSignature, true);
  assert.equal(inspection.structuredSummary.pageCount, 1);
  assert.equal(inspection.structuredSummary.extractablePageCount, 1);
  assert.equal(inspection.structuredSummary.paragraphCount, 1);
  assert.equal(inspection.structuredSummary.sectionCount, 0);
  assert.equal(inspection.structuredSummary.citationCount, 0);
  assert.equal(inspection.structuredSummary.tableLikeRowCount, 0);
  assert.equal(inspection.structuredSummary.numberCandidateCount, 1);
  assert.deepEqual(inspection.ownerCandidates, ["Research Team. Revenue was 42."]);
  assert.match(inspection.textPreview ?? "", /Revenue was 42/);
  assert.deepEqual(inspection.warnings, []);
});

test("pdf inspection fails malformed pdfs with parser detail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-bad-pdf-"));
  const path = join(dir, "bad-report.pdf");
  await writeFile(path, "%PDF-1.4\nnot a parseable pdf\n%%EOF\n");

  const inspection = await inspectFile(path);

  assert.equal(inspection.parser, "pdf-text-v1");
  assert.equal(inspection.status, "failed");
  assert.equal(inspection.structuredSummary.pdfSignature, true);
  assert.match(inspection.warnings.join(" "), /PDF text extraction failed:/);
});

function makePdfBuffer(text: string) {
  const contentStream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(contentStream)} >>\nstream\n${contentStream}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function escapePdfText(value: string) {
  return value.replace(/[\\()]/g, "\\$&");
}

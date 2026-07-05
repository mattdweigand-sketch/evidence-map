import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { runEvidenceMapWorkflow } from "../src/chains/evidence-map/workflow.ts";
import { MemoryEvidenceMapStore } from "../src/db/memory-store.ts";
import { inspectFile } from "../src/inspect/index.ts";

test("xlsx inspection flags hidden sheets, hardcodes, missing checks, and repeated static formulas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-workbook-"));
  try {
    const workbookPath = join(dir, "2026-05-01-board-model.xlsx");
    await writeRiskyWorkbook(workbookPath);

    const inspection = await inspectFile(workbookPath);
    const workbook = inspection.structuredSummary.workbook as {
      sheetCount: number;
      hiddenSheetCount: number;
      formulaCellCount: number;
      hardcodedNumberCellCount: number;
      checksSheetDetected: boolean;
      formulaIssueCount: number;
    };
    const formulaIssues = inspection.structuredSummary.formulaIssues as Array<{ issueType: string; evidence: string }>;
    const hardcodeIssues = inspection.structuredSummary.hardcodeIssues as Array<{ address: string }>;

    assert.equal(inspection.status, "inspected");
    assert.equal(inspection.parser, "xlsx-workbook-doctor-v1");
    assert.equal(workbook.sheetCount, 2);
    assert.equal(workbook.hiddenSheetCount, 1);
    assert.equal(workbook.checksSheetDetected, false);
    assert.ok(workbook.formulaCellCount >= 2);
    assert.ok(workbook.hardcodedNumberCellCount >= 1);
    assert.ok(formulaIssues.some((issue) => issue.issueType === "repeated_formula_static_references"));
    assert.deepEqual(new Set(hardcodeIssues.map((issue) => issue.address)), new Set(["B2", "C2", "D2", "E2", "D4"]));
    assert.equal(hardcodeIssues.length, new Set(hardcodeIssues.map((issue) => issue.address)).size);
    assert.ok(inspection.warnings.some((warning) => warning.includes("No checks sheet detected")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("xlsx inspection does not flag numeric constants on assumptions sheets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-workbook-assumptions-"));
  try {
    const workbookPath = join(dir, "2026-05-01-assumptions.xlsx");
    await writeWorkbook(workbookPath, [
      {
        name: "Assumptions",
        rows: [
          ["Input", "Value"],
          ["Discount rate", 0.08],
          ["Enrollment", 1200]
        ]
      }
    ]);

    const inspection = await inspectFile(workbookPath);
    const sheets = inspection.structuredSummary.sheets as Array<{ name: string; hardcodedNumberCellCount: number }>;
    const assumptionsSummary = sheets.find((sheet) => sheet.name === "Assumptions");

    assert.equal(assumptionsSummary?.hardcodedNumberCellCount, 0);
    assert.equal((inspection.structuredSummary.hardcodeIssues as unknown[]).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("xlsx inspection excludes numeric year labels in detected calculation headers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-workbook-headers-"));
  try {
    const workbookPath = join(dir, "2026-05-01-calculations.xlsx");
    await writeWorkbook(workbookPath, [
      {
        name: "Calculations",
        rows: [
          ["Metric", 2024, 2025],
          ["Revenue", 100, 110],
          [undefined, { formula: "B2*1.1", result: 110 }, { formula: "C2*1.1", result: 121 }]
        ]
      }
    ]);

    const inspection = await inspectFile(workbookPath);
    const hardcodeIssues = inspection.structuredSummary.hardcodeIssues as Array<{ address: string }>;

    assert.deepEqual(new Set(hardcodeIssues.map((issue) => issue.address)), new Set(["B2", "C2"]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("xlsx hardcode warning reports uncapped total and notes capped details", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-workbook-cap-"));
  try {
    const workbookPath = join(dir, "2026-05-01-many-hardcodes.xlsx");
    await writeWorkbook(workbookPath, [
      {
        name: "Calculations",
        rows: [["Metric", "Value"], ...Array.from({ length: 35 }, (_, index) => [`Metric ${index + 1}`, index + 1])]
      }
    ]);

    const inspection = await inspectFile(workbookPath);
    const workbookSummary = inspection.structuredSummary.workbook as { hardcodedNumberCellCount: number };
    const hardcodeIssues = inspection.structuredSummary.hardcodeIssues as unknown[];

    assert.equal(workbookSummary.hardcodedNumberCellCount, 35);
    assert.equal(hardcodeIssues.length, 25);
    assert.ok(inspection.warnings.some((warning) => warning === "35 hardcoded numeric cells found in calculation-like zones. (showing first 25 per sheet)"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("workflow promotes workbook doctor risks into verification findings", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-workflow-workbook-"));
  try {
    const inputDir = join(baseDir, "input", "model-review");
    await mkdir(inputDir, { recursive: true });
    await writeRiskyWorkbook(join(inputDir, "2026-05-01-board-model.xlsx"));

    const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
      baseDir,
      name: "model-review",
      artifactKind: "workbook",
      inputPaths: ["input/model-review"]
    });

    assert.ok(result.findings.some((finding) => finding.issue === "Formula is copied with static relative references."));
    assert.ok(result.findings.some((finding) => finding.issue === "Hardcoded numbers appear in calculation-like zones."));
    assert.ok(result.findings.some((finding) => finding.issue === "No checks sheet detected."));
    assert.equal(result.trustReport.readiness, "blocked");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

async function writeRiskyWorkbook(path: string) {
  await writeWorkbook(path, [
    {
      name: "Model",
      rows: [
        ["Metric", "2024", "2025", "2026", "2027"],
        ["Revenue", 100, 110, 120, 130],
        ["Growth", "", { formula: "C2/B2-1", result: 0.1 }, { formula: "C2/B2-1", result: 0.1 }, { formula: "C2/B2-1", result: 0.1 }],
        [undefined, undefined, undefined, 42]
      ]
    },
    {
      name: "Old Hidden Export",
      state: "hidden",
      rows: [
        ["legacy", "value"],
        ["Revenue", 99]
      ]
    }
  ]);
}

type TestCell = string | number | { formula: string; result?: number } | undefined;

interface TestWorksheet {
  name: string;
  state?: string;
  rows: TestCell[][];
}

async function writeWorkbook(path: string, sheets: TestWorksheet[]) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  );
  zip.file("xl/workbook.xml", workbookXml(sheets));
  zip.file("xl/_rels/workbook.xml.rels", workbookRelationshipsXml(sheets));
  sheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet));
  });

  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

function workbookXml(sheets: TestWorksheet[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${sheet.state && sheet.state !== "visible" ? ` state="${escapeXml(sheet.state)}"` : ""} r:id="rId${index + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`;
}

function workbookRelationshipsXml(sheets: TestWorksheet[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("\n  ")}
</Relationships>`;
}

function worksheetXml(sheet: TestWorksheet) {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row.map((cell, cellIndex) => cellXml(cell, `${columnName(cellIndex + 1)}${rowNumber}`)).join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows}</sheetData>
</worksheet>`;
}

function cellXml(cell: TestCell, address: string) {
  if (cell === undefined) return "";
  if (typeof cell === "number") return `<c r="${address}"><v>${cell}</v></c>`;
  if (typeof cell === "string") return `<c r="${address}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
  const result = cell.result === undefined ? "" : `<v>${cell.result}</v>`;
  return `<c r="${address}"><f>${escapeXml(cell.formula)}</f>${result}</c>`;
}

function columnName(value: number) {
  let name = "";
  let remaining = value;
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name || "A";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

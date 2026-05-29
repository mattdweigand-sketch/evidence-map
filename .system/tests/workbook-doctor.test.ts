import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { runTruthLayerWorkflow } from "../src/chains/truth-layer/workflow.ts";
import { MemoryTruthLayerStore } from "../src/db/memory-store.ts";
import { inspectFile } from "../src/inspect/index.ts";

test("xlsx inspection flags hidden sheets, hardcodes, missing checks, and repeated static formulas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "truth-layer-workbook-"));
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

    assert.equal(inspection.status, "inspected");
    assert.equal(inspection.parser, "xlsx-workbook-doctor-v1");
    assert.equal(workbook.sheetCount, 2);
    assert.equal(workbook.hiddenSheetCount, 1);
    assert.equal(workbook.checksSheetDetected, false);
    assert.ok(workbook.formulaCellCount >= 2);
    assert.ok(workbook.hardcodedNumberCellCount >= 1);
    assert.ok(formulaIssues.some((issue) => issue.issueType === "repeated_formula_static_references"));
    assert.ok(inspection.warnings.some((warning) => warning.includes("No checks sheet detected")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("workflow promotes workbook doctor risks into verification findings", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "truth-layer-workflow-workbook-"));
  try {
    const inputDir = join(baseDir, "input", "model-review");
    await mkdir(inputDir, { recursive: true });
    await writeRiskyWorkbook(join(inputDir, "2026-05-01-board-model.xlsx"));

    const result = await runTruthLayerWorkflow(new MemoryTruthLayerStore(), {
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
  const workbook = new ExcelJS.Workbook();
  const model = workbook.addWorksheet("Model");
  model.addRow(["Metric", "2024", "2025", "2026", "2027"]);
  model.addRow(["Revenue", 100, 110, 120, 130]);
  model.addRow(["Growth", "", "", "", ""]);
  model.getCell("C3").value = { formula: "C2/B2-1", result: 0.1 };
  model.getCell("D3").value = { formula: "C2/B2-1", result: 0.1 };
  model.getCell("E3").value = { formula: "C2/B2-1", result: 0.1 };
  model.getCell("D4").value = 42;

  const hidden = workbook.addWorksheet("Old Hidden Export");
  hidden.state = "hidden";
  hidden.addRow(["legacy", "value"]);
  hidden.addRow(["Revenue", 99]);

  await workbook.xlsx.writeFile(path);
}

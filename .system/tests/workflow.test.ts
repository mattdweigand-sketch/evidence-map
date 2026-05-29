import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runTruthLayerWorkflow } from "../src/chains/truth-layer/workflow.ts";
import { MemoryTruthLayerStore } from "../src/db/memory-store.ts";

test("workflow creates source packet, spec, verification report, and export gate", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "truth-layer-os-"));
  const inputDir = join(baseDir, "input", "board-qbr");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-finance-export.xlsx"), "placeholder");
  await writeFile(join(inputDir, "old-board-deck.pptx"), "placeholder");

  const result = await runTruthLayerWorkflow(new MemoryTruthLayerStore(), {
    baseDir,
    name: "board-qbr",
    artifactKind: "deck",
    inputPaths: ["input/board-qbr"]
  });

  assert.equal(result.sources.length, 2);
  assert.equal(result.inspections.length, 2);
  assert.equal(result.spec.artifactKind, "deck");
  assert.equal(result.trustReport.readiness, "blocked");
  assert.ok(result.findings.some((finding) => finding.issue.includes("Claim has no source")));
  assert.match(result.artifacts.runDir, /deliverables\/board-qbr$/);
  const inspections = JSON.parse(await readFile(join(result.artifacts.sourceDir, "file-inspections.json"), "utf8"));
  assert.equal(inspections.length, 2);
});

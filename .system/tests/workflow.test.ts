import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runTruthLayerWorkflow } from "../src/chains/truth-layer/workflow.ts";
import { JsonFileTruthLayerStore } from "../src/db/json-file-store.ts";
import { MemoryTruthLayerStore } from "../src/db/memory-store.ts";

const execFileAsync = promisify(execFile);

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
  assert.match(result.artifacts.runDir, /deliverables\/board-qbr-[a-f0-9]{8}$/);
  const inspections = JSON.parse(await readFile(join(result.artifacts.sourceDir, "file-inspections.json"), "utf8"));
  assert.equal(inspections.length, 2);
});

test("workflow writes each same-name run to a unique artifact folder", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "truth-layer-os-unique-"));
  await mkdir(join(baseDir, "input", "one"), { recursive: true });
  await mkdir(join(baseDir, "input", "two"), { recursive: true });
  await writeFile(join(baseDir, "input", "one", "2026-05-01-one.csv"), "metric,value\nrevenue,100\n");
  await writeFile(join(baseDir, "input", "two", "2026-05-01-two.csv"), "metric,value\nrevenue,200\n");

  const store = new MemoryTruthLayerStore();
  const first = await runTruthLayerWorkflow(store, {
    baseDir,
    name: "same name",
    artifactKind: "workbook",
    inputPaths: ["input/one"]
  });
  const second = await runTruthLayerWorkflow(store, {
    baseDir,
    name: "same name",
    artifactKind: "workbook",
    inputPaths: ["input/two"]
  });

  assert.notEqual(first.artifacts.runDir, second.artifacts.runDir);
  const firstInventory = JSON.parse(await readFile(join(first.artifacts.sourceDir, "source-inventory.json"), "utf8"));
  const secondInventory = JSON.parse(await readFile(join(second.artifacts.sourceDir, "source-inventory.json"), "utf8"));
  assert.equal(firstInventory[0]?.name, "2026-05-01-one.csv");
  assert.equal(secondInventory[0]?.name, "2026-05-01-two.csv");
});

test("workflow maps inferred conflicts to persisted source ids", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "truth-layer-os-conflict-"));
  const inputDir = join(baseDir, "input", "conflict");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "board-model.csv"), "label\ncurrent\n");
  await writeFile(join(inputDir, "old-board-model.csv"), "label\nold\n");

  const result = await runTruthLayerWorkflow(new MemoryTruthLayerStore(), {
    baseDir,
    name: "conflict",
    artifactKind: "deck",
    inputPaths: ["input/conflict"]
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.sourceIds.length, 2);
  assert.ok(result.conflicts[0]?.sourceIds.every((id) => id.startsWith("src_")));
});

test("failed durable workflow runs are not left running", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "truth-layer-os-failed-"));
  const storePath = join(baseDir, "deliverables", "truth-layer-store.json");

  await assert.rejects(
    runTruthLayerWorkflow(new JsonFileTruthLayerStore(storePath), {
      baseDir,
      name: "missing input",
      artifactKind: "deck",
      inputPaths: ["input/missing"]
    })
  );

  const data = JSON.parse(await readFile(storePath, "utf8"));
  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0]?.status, "failed");
});

test("verify command recomputes findings without duplicating old ones", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "truth-layer-os-verify-"));
  const inputDir = join(baseDir, "input", "board-qbr");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
  const storePath = join(baseDir, "deliverables", "truth-layer-store.json");
  const result = await runTruthLayerWorkflow(new JsonFileTruthLayerStore(storePath), {
    baseDir,
    name: "board-qbr",
    artifactKind: "deck",
    inputPaths: ["input/board-qbr"]
  });
  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));

  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${result.run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${result.run.slug}`]);

  const data = JSON.parse(await readFile(storePath, "utf8"));
  const findingsForRun = data.findings.filter((finding: { runId: string }) => finding.runId === result.run.id);
  const report = JSON.parse(await readFile(join(result.artifacts.verifyDir, "trust-report.json"), "utf8"));
  assert.equal(findingsForRun.length, result.findings.length);
  assert.equal(report.readiness, "blocked");
});

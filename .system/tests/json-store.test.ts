import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runEvidenceMapWorkflow } from "../src/chains/evidence-map/workflow.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";

test("JSON store serializes concurrent source writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-json-store-"));
  try {
    const storePath = join(dir, "evidence-map-store.json");
    const store = new JsonFileEvidenceMapStore(storePath);
    const run = await store.createRun({
      name: "concurrent sources",
      artifactKind: "document",
      inputPaths: []
    });

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.createSources(run.id, [
          {
            name: `source-${index}.csv`,
            path: join(dir, `source-${index}.csv`),
            fileType: "csv",
            status: "raw_data",
            intendedUse: "Test source.",
            notes: "Concurrent write test."
          }
        ])
      )
    );

    const reloaded = new JsonFileEvidenceMapStore(storePath);
    const sources = await reloaded.listSources(run.id);
    assert.equal(sources.length, 10);
    assert.deepEqual(
      sources.map((source) => source.name).sort(),
      Array.from({ length: 10 }, (_, index) => `source-${index}.csv`)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("JSON store serializes writes across store instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-json-store-cross-instance-"));
  try {
    const storePath = join(dir, "evidence-map-store.json");
    const setupStore = new JsonFileEvidenceMapStore(storePath);
    const run = await setupStore.createRun({
      name: "cross instance sources",
      artifactKind: "document",
      inputPaths: []
    });
    const firstStore = new JsonFileEvidenceMapStore(storePath);
    const secondStore = new JsonFileEvidenceMapStore(storePath);

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const store = index % 2 === 0 ? firstStore : secondStore;
        return store.createSources(run.id, [
          {
            name: `cross-instance-${index}.csv`,
            path: join(dir, `cross-instance-${index}.csv`),
            fileType: "csv",
            status: "raw_data",
            intendedUse: "Cross-instance write test.",
            notes: "Concurrent cross-instance write test."
          }
        ]);
      })
    );

    const reloaded = new JsonFileEvidenceMapStore(storePath);
    const sources = await reloaded.listSources(run.id);
    assert.equal(sources.length, 20);
    assert.deepEqual(
      sources.map((source) => source.name).sort(),
      Array.from({ length: 20 }, (_, index) => `cross-instance-${index}.csv`).sort()
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("JSON store reload preserves generated output records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-json-generated-"));
  try {
    const inputDir = join(dir, "input", "generated");
    await mkdir(inputDir, { recursive: true });
    await writeFile(join(inputDir, "2026-05-01-current-metrics.csv"), "metric,value,as_of_date\nactive_users,42,2026-05-01\n");
    const storePath = join(dir, "deliverables", "evidence-map-store.json");
    const store = new JsonFileEvidenceMapStore(storePath);

    const result = await runEvidenceMapWorkflow(store, {
      baseDir: dir,
      name: "generated",
      artifactKind: "report",
      inputPaths: ["input/generated"],
      generate: true
    });

    const reloaded = new JsonFileEvidenceMapStore(storePath);
    const [sourceEvidence, generatedClaims, evidenceLinkSuggestions, evidenceMap, generatedOutput] = await Promise.all([
      reloaded.listSourceEvidence(result.run.id),
      reloaded.listGeneratedClaims(result.run.id),
      reloaded.listEvidenceLinkSuggestions(result.run.id),
      reloaded.getEvidenceMap(result.run.id),
      reloaded.getGeneratedOutput(result.run.id)
    ]);

    assert.ok(sourceEvidence.length > 0);
    assert.ok(generatedClaims.length > 0);
    assert.ok(Array.isArray(evidenceLinkSuggestions));
    assert.equal(evidenceMap?.summary.generatedClaimCount, generatedClaims.length);
    assert.equal(generatedOutput?.status, "export_ready");
    assert.equal(generatedOutput?.pathRelativeToRun, "04_export/final-output.md");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

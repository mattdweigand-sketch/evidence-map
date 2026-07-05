import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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

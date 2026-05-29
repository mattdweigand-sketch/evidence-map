import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSourcePacket } from "../src/ingest/source-packet.ts";

test("source packet labels obvious source roles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "truth-layer-source-"));
  const input = join(dir, "input");
  await mkdir(input);
  await writeFile(join(input, "2026-05-01-raw-export.csv"), "a,b\n1,2\n");
  await writeFile(join(input, "qbr-plan-estimate.xlsx"), "placeholder");

  const packet = await buildSourcePacket([input]);
  assert.equal(packet.sources.length, 2);
  assert.equal(packet.inspections.length, 2);
  assert.equal(packet.sources.find((source) => source.name.endsWith(".csv"))?.status, "raw_data");
  assert.equal(packet.sources.find((source) => source.name.endsWith(".xlsx"))?.status, "estimate");
  const csvInspection = packet.inspections.find((inspection) => inspection.name.endsWith(".csv"));
  assert.equal(csvInspection?.status, "inspected");
  assert.deepEqual(csvInspection?.structuredSummary.headers, ["a", "b"]);
});

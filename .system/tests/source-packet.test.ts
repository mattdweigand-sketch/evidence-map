import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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

test("csv inspection handles quoted delimiters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-source-csv-"));
  const path = join(dir, "2026-05-01-quoted.csv");
  await writeFile(path, "name,notes\nAcme,\"hello, world\"\n");

  const inspection = await inspectFile(path);
  assert.equal(inspection.structuredSummary.inconsistentRowCount, 0);
  assert.deepEqual(inspection.warnings, []);
});

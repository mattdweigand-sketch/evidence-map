import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JsonFileTruthLayerStore } from "../src/db/json-file-store.ts";
import { MemoryTruthLayerStore } from "../src/db/memory-store.ts";
import { createTruthLayerMcpServer } from "../src/mcp/server.ts";

const fixtureDirs: string[] = [];

after(async () => {
  await Promise.all(fixtureDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test("MCP run state persists across JSON store reloads", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "truth-layer-mcp-json-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "board-qbr");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
  const storePath = join(baseDir, "deliverables", "truth-layer-store.json");

  const first = createTruthLayerMcpServer(new JsonFileTruthLayerStore(storePath));
  const firstClient = new Client({ name: "truth-layer-test-client", version: "0.1.0" });
  const [firstClientTransport, firstServerTransport] = InMemoryTransport.createLinkedPair();
  await first.server.connect(firstServerTransport);
  await firstClient.connect(firstClientTransport);

  const runResult = await firstClient.callTool({
    name: "truthlayer_run_workflow",
    arguments: {
      baseDir,
      name: "board-qbr",
      artifactKind: "deck",
      inputPaths: ["input/board-qbr"]
    }
  });
  const runId = (runResult.structuredContent as { runId?: string }).runId;
  assert.ok(runId);

  await firstClient.close();
  await first.server.close();

  const second = createTruthLayerMcpServer(new JsonFileTruthLayerStore(storePath));
  const secondClient = new Client({ name: "truth-layer-test-client", version: "0.1.0" });
  const [secondClientTransport, secondServerTransport] = InMemoryTransport.createLinkedPair();
  await second.server.connect(secondServerTransport);
  await secondClient.connect(secondClientTransport);

  const status = await secondClient.callTool({
    name: "truthlayer_status",
    arguments: { runId }
  });
  assert.equal((status.structuredContent as { counts?: { sources?: number } }).counts?.sources, 1);

  await secondClient.close();
  await second.server.close();
});

test("MCP server exposes source prep, workflow, status, next action, and verification tools", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "truth-layer-mcp-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "board-qbr");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
  await writeFile(join(inputDir, "old-board-deck.pptx"), "placeholder");

  const { server } = createTruthLayerMcpServer(new MemoryTruthLayerStore());
  const client = new Client({ name: "truth-layer-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "truthlayer_inspect_source_packet"));
  assert.ok(tools.tools.some((tool) => tool.name === "truthlayer_run_workflow"));
  assert.ok(tools.tools.some((tool) => tool.name === "truthlayer_status"));
  assert.ok(tools.tools.some((tool) => tool.name === "truthlayer_next_action"));
  assert.ok(tools.tools.some((tool) => tool.name === "truthlayer_get_verification_report"));

  const sourcePacket = await client.callTool({
    name: "truthlayer_inspect_source_packet",
    arguments: {
      baseDir,
      inputPaths: ["input/board-qbr"]
    }
  });
  assert.equal((sourcePacket.structuredContent as { sources?: unknown[] }).sources?.length, 2);
  assert.equal((sourcePacket.structuredContent as { inspections?: unknown[] }).inspections?.length, 2);

  const runResult = await client.callTool({
    name: "truthlayer_run_workflow",
    arguments: {
      baseDir,
      name: "board-qbr",
      artifactKind: "deck",
      inputPaths: ["input/board-qbr"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; status?: string; readiness?: string; sourceCount?: number; inspectionCount?: number };
  assert.ok(run.runId);
  assert.equal(run.status, "blocked");
  assert.equal(run.readiness, "blocked");
  assert.equal(run.sourceCount, 2);
  assert.equal(run.inspectionCount, 2);

  const status = await client.callTool({
    name: "truthlayer_status",
    arguments: { runId: run.runId }
  });
  assert.equal((status.structuredContent as { counts?: { sources?: number } }).counts?.sources, 2);
  assert.equal((status.structuredContent as { counts?: { inspections?: number } }).counts?.inspections, 2);

  const nextAction = await client.callTool({
    name: "truthlayer_next_action",
    arguments: { runId: run.runId }
  });
  assert.equal((nextAction.structuredContent as { gate?: string }).gate, "RESOLVE_VERIFICATION_FINDINGS");

  const verification = await client.callTool({
    name: "truthlayer_get_verification_report",
    arguments: { runId: run.runId }
  });
  assert.equal((verification.structuredContent as { trustReport?: { readiness?: string } }).trustReport?.readiness, "blocked");

  await client.close();
  await server.close();
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { MemoryEvidenceMapStore } from "../src/db/memory-store.ts";
import { LEGAL_REVIEW_APPROVAL_TOKEN } from "../src/legal/review-decisions.ts";
import { createEvidenceMapMcpServer } from "../src/mcp/server.ts";

const fixtureDirs: string[] = [];
const execFileAsync = promisify(execFile);

after(async () => {
  await Promise.all(fixtureDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test("MCP run state persists across JSON store reloads", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-json-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "sample-project");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
  const storePath = join(baseDir, "deliverables", "evidence-map-store.json");

  const first = createEvidenceMapMcpServer(new JsonFileEvidenceMapStore(storePath));
  const firstClient = new Client({ name: "evidence-map-test-client", version: "0.1.0" });
  const [firstClientTransport, firstServerTransport] = InMemoryTransport.createLinkedPair();
  await first.server.connect(firstServerTransport);
  await firstClient.connect(firstClientTransport);

  const runResult = await firstClient.callTool({
    name: "evidencemap_run_workflow",
    arguments: {
      baseDir,
      name: "sample-project",
      artifactKind: "deck",
      inputPaths: ["input/sample-project"]
    }
  });
  const runId = (runResult.structuredContent as { runId?: string }).runId;
  assert.ok(runId);

  await firstClient.close();
  await first.server.close();

  const second = createEvidenceMapMcpServer(new JsonFileEvidenceMapStore(storePath));
  const secondClient = new Client({ name: "evidence-map-test-client", version: "0.1.0" });
  const [secondClientTransport, secondServerTransport] = InMemoryTransport.createLinkedPair();
  await second.server.connect(secondServerTransport);
  await secondClient.connect(secondClientTransport);

  const status = await secondClient.callTool({
    name: "evidencemap_status",
    arguments: { runId }
  });
  assert.equal((status.structuredContent as { counts?: { sources?: number } }).counts?.sources, 1);

  await secondClient.close();
  await second.server.close();
});

test("MCP server exposes source prep, workflow, status, next action, and verification tools", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "sample-project");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
  await writeFile(join(inputDir, "old-board-deck.pptx"), "placeholder");

  const { server } = createEvidenceMapMcpServer(new MemoryEvidenceMapStore());
  const client = new Client({ name: "evidence-map-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_inspect_source_packet"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_run_workflow"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_status"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_next_action"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_get_verification_report"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_attach_legal_passage_support"));

  const sourcePacket = await client.callTool({
    name: "evidencemap_inspect_source_packet",
    arguments: {
      baseDir,
      inputPaths: ["input/sample-project"]
    }
  });
  assert.equal((sourcePacket.structuredContent as { sources?: unknown[] }).sources?.length, 2);
  assert.equal((sourcePacket.structuredContent as { inspections?: unknown[] }).inspections?.length, 2);

  const runResult = await client.callTool({
    name: "evidencemap_run_workflow",
    arguments: {
      baseDir,
      name: "sample-project",
      artifactKind: "deck",
      inputPaths: ["input/sample-project"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; status?: string; readiness?: string; sourceCount?: number; inspectionCount?: number };
  assert.ok(run.runId);
  assert.equal(run.status, "blocked");
  assert.equal(run.readiness, "blocked");
  assert.equal(run.sourceCount, 2);
  assert.equal(run.inspectionCount, 2);

  const status = await client.callTool({
    name: "evidencemap_status",
    arguments: { runId: run.runId }
  });
  assert.equal((status.structuredContent as { counts?: { sources?: number } }).counts?.sources, 2);
  assert.equal((status.structuredContent as { counts?: { inspections?: number } }).counts?.inspections, 2);

  const nextAction = await client.callTool({
    name: "evidencemap_next_action",
    arguments: { runId: run.runId }
  });
  assert.equal((nextAction.structuredContent as { gate?: string }).gate, "RESOLVE_VERIFICATION_FINDINGS");

  const verification = await client.callTool({
    name: "evidencemap_get_verification_report",
    arguments: { runId: run.runId }
  });
  assert.equal((verification.structuredContent as { trustReport?: { readiness?: string } }).trustReport?.readiness, "blocked");

  await client.close();
  await server.close();
});

test("MCP tools accept legal workflow profile", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-legal-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "legal-project");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "assignment-prompt.md"), "# Assignment\nUse only the supplied packet.\n");
  await writeFile(join(inputDir, "case-excerpt.md"), "# Hawkins v. McGee\n84 N.H. 114\nSupreme Court of New Hampshire\n");

  const { server } = createEvidenceMapMcpServer(new MemoryEvidenceMapStore());
  const client = new Client({ name: "evidence-map-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const sourcePacket = await client.callTool({
    name: "evidencemap_inspect_source_packet",
    arguments: {
      baseDir,
      profile: "legal",
      inputPaths: ["input/legal-project"]
    }
  });
  assert.equal((sourcePacket.structuredContent as { legalSourcePacket?: { profile?: string } }).legalSourcePacket?.profile, "legal");

  const runResult = await client.callTool({
    name: "evidencemap_run_workflow",
    arguments: {
      baseDir,
      name: "legal-project",
      artifactKind: "document",
      profile: "legal",
      inputPaths: ["input/legal-project"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; profile?: string };
  assert.ok(run.runId);
  assert.equal(run.profile, "legal");

  const verification = await client.callTool({
    name: "evidencemap_get_verification_report",
    arguments: { runId: run.runId }
  });
  assert.ok(
    (verification.structuredContent as { findings?: Array<{ issue?: string }> }).findings?.some(
      (finding) => finding.issue === "Legal proposition has no source support."
    )
  );

  await client.close();
  await server.close();
});

test("MCP legal passage support decision writes an audit trail and verifies idempotently", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-legal-review-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "legal-review");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "case-excerpt.md"), "# Hawkins v. McGee\n\nA promise may create a warranty.\n");
  await writeFile(
    join(inputDir, "legal-memo-draft.md"),
    [
      "# Legal Memo Draft",
      "",
      "LEGAL-MAP [rule] source=case-excerpt.md authority=persuasive_ok: A promise may create a warranty.",
      "LEGAL-DRAFT [rule]: A promise may create a warranty."
    ].join("\n")
  );
  const storePath = join(baseDir, "deliverables", "evidence-map-store.json");
  const { server } = createEvidenceMapMcpServer(new JsonFileEvidenceMapStore(storePath));
  const client = new Client({ name: "evidence-map-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const runResult = await client.callTool({
    name: "evidencemap_run_workflow",
    arguments: {
      baseDir,
      name: "legal-review",
      artifactKind: "document",
      profile: "legal",
      inputPaths: ["input/legal-review"]
    }
  });
  const run = runResult.structuredContent as {
    runId?: string;
    slug?: string;
    artifacts?: { sourceDir?: string; verifyDir?: string };
  };
  assert.ok(run.runId);
  assert.ok(run.slug);
  assert.ok(run.artifacts?.sourceDir);
  assert.ok(run.artifacts?.verifyDir);

  const initialFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.ok(initialFindings.some((finding) => finding.issue === "Legal proposition lacks passage or pinpoint support."));
  const legalEvidenceMap = JSON.parse(await readFile(join(run.artifacts.verifyDir, "legal-evidence-map.json"), "utf8")) as {
    propositions: Array<{ id: string; passageIds: string[]; sourceIds: string[]; pinCites: string[]; reviewStatus: string }>;
  };
  const proposition = legalEvidenceMap.propositions[0];
  assert.ok(proposition);
  assert.deepEqual(proposition.passageIds, []);
  const legalPassages = JSON.parse(await readFile(join(run.artifacts.sourceDir, "legal-passages.json"), "utf8")) as Array<{
    passageId: string;
    pinpoint?: string;
  }>;
  const passage = legalPassages.find((item) => item.passageId === "passage_case-excerpt_p0002");
  assert.ok(passage);

  const rejected = await client.callTool({
    name: "evidencemap_attach_legal_passage_support",
    arguments: {
      baseDir,
      runId: run.runId,
      propositionId: proposition.id,
      passageId: passage.passageId,
      approvalToken: "not-approved"
    }
  });
  assert.equal(rejected.isError, true);

  const decisionResult = await client.callTool({
    name: "evidencemap_attach_legal_passage_support",
    arguments: {
      baseDir,
      runId: run.runId,
      propositionId: proposition.id,
      passageId: passage.passageId,
      reviewer: "fixture-reviewer",
      approvalToken: LEGAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const decision = decisionResult.structuredContent as {
    changed?: boolean;
    decisionCount?: number;
    auditEventCount?: number;
    findingCount?: number;
  };
  assert.equal(decision.changed, true);
  assert.equal(decision.decisionCount, 1);
  assert.equal(decision.auditEventCount, 1);

  const reviewedMap = JSON.parse(await readFile(join(run.artifacts.verifyDir, "legal-evidence-map.json"), "utf8")) as {
    propositions: Array<{ id: string; passageIds: string[]; sourceIds: string[]; pinCites: string[]; reviewStatus: string }>;
  };
  const reviewedProposition = reviewedMap.propositions.find((item) => item.id === proposition.id);
  assert.ok(reviewedProposition);
  assert.deepEqual(reviewedProposition.passageIds, [passage.passageId]);
  assert.deepEqual(reviewedProposition.pinCites, [passage.pinpoint]);
  assert.equal(reviewedProposition.reviewStatus, "needs_review");
  const reviewedFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.ok(!reviewedFindings.some((finding) => finding.issue === "Legal proposition lacks passage or pinpoint support."));
  const reviewDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "legal-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(reviewDecisionSet.decisions.length, 1);
  assert.equal(reviewDecisionSet.auditEvents.length, 1);
  const reviewDecisionMarkdown = await readFile(join(run.artifacts.verifyDir, "legal-review-decisions.md"), "utf8");
  assert.match(reviewDecisionMarkdown, /Legal Review Decisions/);

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);

  const rerunDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "legal-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(rerunDecisionSet.decisions.length, 1);
  assert.equal(rerunDecisionSet.auditEvents.length, 1);
  const storeData = JSON.parse(await readFile(storePath, "utf8")) as { findings: Array<{ runId: string }> };
  assert.equal(storeData.findings.filter((finding) => finding.runId === run.runId).length, decision.findingCount);

  await client.close();
  await server.close();
});

test("MCP source packet rejects input paths outside baseDir", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-guard-"));
  fixtureDirs.push(baseDir);
  const { server } = createEvidenceMapMcpServer(new MemoryEvidenceMapStore());
  const client = new Client({ name: "evidence-map-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({
    name: "evidencemap_inspect_source_packet",
    arguments: {
      baseDir,
      inputPaths: ["../outside"]
    }
  });

  assert.equal(result.isError, true);
  const content = result.content as Array<{ type: string; text?: string }>;
  assert.match(String(content[0]?.type === "text" ? content[0].text : ""), /\.\.\/outside/);

  await client.close();
  await server.close();
});

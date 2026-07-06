import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
import {
  applyGeneralClaimReviewDecisions,
  GENERAL_REVIEW_APPROVAL_TOKEN,
  type GeneralReviewDecisionRecord
} from "../src/review/general-decisions.ts";
import type { ClaimRecord } from "../src/types.ts";

const fixtureDirs: string[] = [];
const execFileAsync = promisify(execFile);

after(async () => {
  await Promise.all(fixtureDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test("MCP server version matches package version", async () => {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageVersion = (JSON.parse(await readFile(packagePath, "utf8")) as { version?: string }).version;
  const { server } = createEvidenceMapMcpServer(new MemoryEvidenceMapStore());
  const serverInfo = (server as unknown as { server?: { _serverInfo?: { version?: string } } }).server?._serverInfo;

  assert.equal(serverInfo?.version, packageVersion);
  const versionModule = await import("../src/version.ts").catch(() => undefined);
  assert.equal(versionModule?.PACKAGE_VERSION, packageVersion);

  await server.close();
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
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_refresh_workflow"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_status"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_next_action"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_get_verification_report"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_get_evidence_link_suggestions"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_create_general_claim"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_edit_general_claim"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_delete_general_claim"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_merge_general_claims"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_attach_claim_source_support"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_resolve_calculation_risk"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_resolve_source_conflict"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_accept_general_risk"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_apply_general_final_artifacts"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_attach_legal_passage_support"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_update_legal_source_authority"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_update_legal_source_treatment"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_accept_legal_risk"));
  assert.ok(tools.tools.some((tool) => tool.name === "evidencemap_resolve_legal_source_conflict"));

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
  assert.equal(typeof (status.structuredContent as { counts?: { evidenceLinkSuggestions?: number } }).counts?.evidenceLinkSuggestions, "number");

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

  const suggestions = await client.callTool({
    name: "evidencemap_get_evidence_link_suggestions",
    arguments: { runId: run.runId }
  });
  assert.equal(typeof (suggestions.structuredContent as { suggestionCount?: number }).suggestionCount, "number");

  const refresh = await client.callTool({
    name: "evidencemap_refresh_workflow",
    arguments: {
      baseDir,
      priorRunId: run.runId,
      name: "sample-project-refresh",
      artifactKind: "deck",
      inputPaths: ["input/sample-project"]
    }
  });
  assert.equal((refresh.structuredContent as { priorRunId?: string }).priorRunId, run.runId);
  assert.equal(typeof (refresh.structuredContent as { carriedArtifactCount?: number }).carriedArtifactCount, "number");

  const rejectedApply = await client.callTool({
    name: "evidencemap_apply_general_final_artifacts",
    arguments: {
      baseDir,
      runId: run.runId,
      artifactPaths: ["input/sample-project/old-board-deck.pptx"],
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal(rejectedApply.isError, true);
  assert.match(String((rejectedApply.structuredContent as { error?: string }).error), /requires ready gates/);

  await client.close();
  await server.close();
});

test("MCP source packet rejects symlink targets outside baseDir", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-symlink-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-outside-"));
  fixtureDirs.push(baseDir, outsideDir);
  const inputDir = join(baseDir, "input", "linked-source");
  await mkdir(inputDir, { recursive: true });
  const outsideSource = join(outsideDir, "private-source.md");
  await writeFile(outsideSource, "# Private Source\n\nsecret outside content\n");
  await symlink(outsideSource, join(inputDir, "linked-private.md"));

  const { server } = createEvidenceMapMcpServer(new MemoryEvidenceMapStore());
  const client = new Client({ name: "evidence-map-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const sourcePacket = await client.callTool({
    name: "evidencemap_inspect_source_packet",
    arguments: {
      baseDir,
      inputPaths: ["input/linked-source"]
    }
  });
  assert.equal(sourcePacket.isError, true);
  assert.match(String((sourcePacket.structuredContent as { error?: string }).error), /linked-private\.md/);
  assert.match(String((sourcePacket.structuredContent as { error?: string }).error), /real path escapes baseDir|escapes baseDir/);

  await client.close();
  await server.close();
});

test("MCP workflow generation returns generated-output metadata", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-generate-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "generated-report");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-current-metrics.csv"), "metric,value,as_of_date\nactive_users,42,2026-05-01\n");

  const { server } = createEvidenceMapMcpServer(new MemoryEvidenceMapStore());
  const client = new Client({ name: "evidence-map-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const runResult = await client.callTool({
    name: "evidencemap_run_workflow",
    arguments: {
      baseDir,
      name: "generated-report",
      artifactKind: "report",
      inputPaths: ["input/generated-report"],
      generate: true
    }
  });
  const run = runResult.structuredContent as {
    runId?: string;
    status?: string;
    readiness?: string;
    generatedOutput?: {
      status?: string;
      format?: string;
      pathRelativeToRun?: string;
      formattedPathRelativeToRun?: string;
      formattingReceiptPathRelativeToRun?: string;
      generatedClaimCount?: number;
      selectedEvidenceCount?: number;
      excludedSourceCount?: number;
    } | null;
    artifacts?: { exportDir?: string };
  };

  assert.equal(run.status, "export_ready");
  assert.equal(run.readiness, "ready");
  assert.equal(run.generatedOutput?.status, "export_ready");
  assert.equal(run.generatedOutput?.format, "markdown");
  assert.equal(run.generatedOutput?.pathRelativeToRun, "04_export/final-output.md");
  assert.equal(run.generatedOutput?.formattedPathRelativeToRun, "04_export/formatted-output.md");
  assert.equal(run.generatedOutput?.formattingReceiptPathRelativeToRun, "04_export/formatting-receipt.json");
  assert.ok((run.generatedOutput?.generatedClaimCount ?? 0) > 0);
  assert.ok((run.generatedOutput?.selectedEvidenceCount ?? 0) > 0);
  assert.equal(run.generatedOutput?.excludedSourceCount, 0);
  assert.ok(run.artifacts?.exportDir);
  await readFile(join(run.artifacts.exportDir, "final-output.md"), "utf8");
  await readFile(join(run.artifacts.exportDir, "formatted-output.md"), "utf8");
  await readFile(join(run.artifacts.exportDir, "formatting-receipt.json"), "utf8");

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

  const rejectedGeneralDelete = await client.callTool({
    name: "evidencemap_delete_general_claim",
    arguments: {
      baseDir,
      runId: run.runId,
      claimId: "claim_fixture",
      reason: "General claim deletion must not apply to legal runs.",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal(rejectedGeneralDelete.isError, true);
  assert.match(String((rejectedGeneralDelete.structuredContent as { error?: string }).error), /general-profile run/);

  const rejectedGeneralMerge = await client.callTool({
    name: "evidencemap_merge_general_claims",
    arguments: {
      baseDir,
      runId: run.runId,
      targetClaimId: "claim_fixture_target",
      mergedClaimIds: ["claim_fixture_merged"],
      reason: "General claim merge must not apply to legal runs.",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal(rejectedGeneralMerge.isError, true);
  assert.match(String((rejectedGeneralMerge.structuredContent as { error?: string }).error), /general-profile run/);

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

test("MCP general claim source decision writes an audit trail and verifies idempotently", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-general-review-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "general-review");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
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
      name: "general-review",
      artifactKind: "document",
      inputPaths: ["input/general-review"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; slug?: string; artifacts?: { sourceDir?: string; verifyDir?: string } };
  assert.ok(run.runId);
  assert.ok(run.slug);
  assert.ok(run.artifacts?.sourceDir);
  assert.ok(run.artifacts?.verifyDir);

  const initialFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.ok(initialFindings.some((finding) => finding.issue === "Claim has no source attribution."));
  assert.ok(initialFindings.some((finding) => finding.issue === "Claim is marked unsupported."));
  const storeData = JSON.parse(await readFile(storePath, "utf8")) as {
    claims: Array<{ id: string; runId: string }>;
    sources: Array<{ id: string; runId: string; name: string }>;
  };
  const claim = storeData.claims.find((item) => item.runId === run.runId);
  const source = storeData.sources.find((item) => item.runId === run.runId && item.name === "2026-05-01-raw-export.csv");
  assert.ok(claim);
  assert.ok(source);

  const rejected = await client.callTool({
    name: "evidencemap_attach_claim_source_support",
    arguments: {
      baseDir,
      runId: run.runId,
      claimId: claim.id,
      sourceId: source.id,
      approvalToken: "not-approved"
    }
  });
  assert.equal(rejected.isError, true);

  const decisionResult = await client.callTool({
    name: "evidencemap_attach_claim_source_support",
    arguments: {
      baseDir,
      runId: run.runId,
      claimId: claim.id,
      sourceId: source.id,
      reviewStatus: "verified",
      evidenceAnchor: "row 2",
      evidenceQuote: "revenue,100",
      rationale: "The CSV row directly supports the seeded claim.",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const decision = decisionResult.structuredContent as {
    changed?: boolean;
    readiness?: string;
    status?: string;
    decisionCount?: number;
    auditEventCount?: number;
    findingCount?: number;
  };
  assert.equal(decision.changed, true);
  assert.equal(decision.readiness, "ready");
  assert.equal(decision.status, "export_ready");
  assert.equal(decision.decisionCount, 1);
  assert.equal(decision.auditEventCount, 1);
  assert.equal(decision.findingCount, 0);

  const reviewedFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.equal(reviewedFindings.length, 0);
  const reviewDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: Array<{ action?: string; evidenceAnchor?: string; evidenceQuote?: string; rationale?: string }>;
    auditEvents: unknown[];
  };
  assert.equal(reviewDecisionSet.decisions.length, 1);
  assert.equal(reviewDecisionSet.auditEvents.length, 1);
  assert.equal(reviewDecisionSet.decisions[0]?.action, "attach_claim_source");
  assert.equal(reviewDecisionSet.decisions[0]?.evidenceAnchor, "row 2");
  assert.equal(reviewDecisionSet.decisions[0]?.evidenceQuote, "revenue,100");
  assert.equal(reviewDecisionSet.decisions[0]?.rationale, "The CSV row directly supports the seeded claim.");
  const reviewDecisionMarkdown = await readFile(join(run.artifacts.verifyDir, "general-review-decisions.md"), "utf8");
  assert.match(reviewDecisionMarkdown, /General Review Decisions/);

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);

  const rerunDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(rerunDecisionSet.decisions.length, 1);
  assert.equal(rerunDecisionSet.auditEvents.length, 1);

  await client.close();
  await server.close();
});

test("MCP general delete claim decision removes effective claim findings idempotently", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-general-delete-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "general-delete");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
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
      name: "general-delete",
      artifactKind: "document",
      inputPaths: ["input/general-delete"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; slug?: string; artifacts?: { verifyDir?: string } };
  assert.ok(run.runId);
  assert.ok(run.slug);
  assert.ok(run.artifacts?.verifyDir);

  const initialFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.ok(initialFindings.some((finding) => finding.issue === "Claim has no source attribution."));
  assert.ok(initialFindings.some((finding) => finding.issue === "Claim is marked unsupported."));
  const storeData = JSON.parse(await readFile(storePath, "utf8")) as {
    claims: Array<{ id: string; runId: string }>;
  };
  const claim = storeData.claims.find((item) => item.runId === run.runId);
  assert.ok(claim);

  const rejected = await client.callTool({
    name: "evidencemap_delete_general_claim",
    arguments: {
      baseDir,
      runId: run.runId,
      claimId: claim.id,
      reason: "The seeded placeholder claim is not part of the reviewed deliverable.",
      approvalToken: "not-approved"
    }
  });
  assert.equal(rejected.isError, true);

  const deleted = await client.callTool({
    name: "evidencemap_delete_general_claim",
    arguments: {
      baseDir,
      runId: run.runId,
      claimId: claim.id,
      reason: "The seeded placeholder claim is not part of the reviewed deliverable.",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const deletion = deleted.structuredContent as {
    changed?: boolean;
    readiness?: string;
    status?: string;
    decisionCount?: number;
    auditEventCount?: number;
    findingCount?: number;
  };
  assert.equal(deletion.changed, true);
  assert.equal(deletion.readiness, "ready");
  assert.equal(deletion.status, "export_ready");
  assert.equal(deletion.decisionCount, 1);
  assert.equal(deletion.auditEventCount, 1);
  assert.equal(deletion.findingCount, 0);

  const repeatedDelete = await client.callTool({
    name: "evidencemap_delete_general_claim",
    arguments: {
      baseDir,
      runId: run.runId,
      claimId: claim.id,
      reason: "The seeded placeholder claim is not part of the reviewed deliverable.",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((repeatedDelete.structuredContent as { changed?: boolean; decisionCount?: number; auditEventCount?: number }).changed, false);
  assert.equal((repeatedDelete.structuredContent as { changed?: boolean; decisionCount?: number; auditEventCount?: number }).decisionCount, 1);
  assert.equal((repeatedDelete.structuredContent as { changed?: boolean; decisionCount?: number; auditEventCount?: number }).auditEventCount, 1);

  const reviewedFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.equal(reviewedFindings.length, 0);
  const reviewDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: Array<{ action?: string; reason?: string }>;
    auditEvents: Array<{ action?: string; before?: { id?: string }; after?: { deleted?: boolean; reason?: string } }>;
  };
  assert.equal(reviewDecisionSet.decisions.length, 1);
  assert.equal(reviewDecisionSet.auditEvents.length, 1);
  assert.equal(reviewDecisionSet.decisions[0]?.action, "delete_claim");
  assert.equal(reviewDecisionSet.decisions[0]?.reason, "The seeded placeholder claim is not part of the reviewed deliverable.");
  assert.equal(reviewDecisionSet.auditEvents[0]?.action, "delete_claim");
  assert.equal(reviewDecisionSet.auditEvents[0]?.before?.id, claim.id);
  assert.equal(reviewDecisionSet.auditEvents[0]?.after?.deleted, true);
  assert.equal(reviewDecisionSet.auditEvents[0]?.after?.reason, "The seeded placeholder claim is not part of the reviewed deliverable.");
  const reviewDecisionMarkdown = await readFile(join(run.artifacts.verifyDir, "general-review-decisions.md"), "utf8");
  assert.match(reviewDecisionMarkdown, /delete_claim/);

  const persistedStoreData = JSON.parse(await readFile(storePath, "utf8")) as {
    claims: Array<{ id: string; runId: string }>;
  };
  assert.ok(persistedStoreData.claims.some((item) => item.runId === run.runId && item.id === claim.id));

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);

  const rerunDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(rerunDecisionSet.decisions.length, 1);
  assert.equal(rerunDecisionSet.auditEvents.length, 1);

  await client.close();
  await server.close();
});

test("MCP general merge claim decision overlays target and merged-away claims idempotently", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-general-merge-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "general-merge");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
  await writeFile(join(inputDir, "2026-05-01-supporting-export.csv"), "metric,value\nbookings,120\n");
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
      name: "general-merge",
      artifactKind: "document",
      inputPaths: ["input/general-merge"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; slug?: string; artifacts?: { verifyDir?: string } };
  assert.ok(run.runId);
  assert.ok(run.slug);
  assert.ok(run.artifacts?.verifyDir);

  const storeData = JSON.parse(await readFile(storePath, "utf8")) as {
    claims: Array<{ id: string; runId: string; sourceIds: string[]; assumptions: string[]; reviewStatus: string }>;
    sources: Array<{ id: string; runId: string; name: string }>;
  };
  const seededClaim = storeData.claims.find((item) => item.runId === run.runId);
  const rawSource = storeData.sources.find((item) => item.runId === run.runId && item.name === "2026-05-01-raw-export.csv");
  const supportingSource = storeData.sources.find((item) => item.runId === run.runId && item.name === "2026-05-01-supporting-export.csv");
  assert.ok(seededClaim);
  assert.ok(rawSource);
  assert.ok(supportingSource);

  const rejected = await client.callTool({
    name: "evidencemap_merge_general_claims",
    arguments: {
      baseDir,
      runId: run.runId,
      targetClaimId: seededClaim.id,
      mergedClaimIds: ["claim_fixture_missing"],
      reason: "Merge fixture should require approval before claim lookup.",
      approvalToken: "not-approved"
    }
  });
  assert.equal(rejected.isError, true);

  const createdClaim = await client.callTool({
    name: "evidencemap_create_general_claim",
    arguments: {
      baseDir,
      runId: run.runId,
      artifactLocation: "section-map:Revenue",
      claim: "Revenue and bookings are supported by the supplied exports.",
      sourceIds: [supportingSource.id, rawSource.id],
      assumptions: ["zeta assumption", "alpha assumption"],
      transformation: "Derived from both fixture sources.",
      reviewStatus: "verified",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const createdClaimId = (createdClaim.structuredContent as { decision?: { claimId?: string } }).decision?.claimId;
  assert.ok(createdClaimId);

  const merged = await client.callTool({
    name: "evidencemap_merge_general_claims",
    arguments: {
      baseDir,
      runId: run.runId,
      targetClaimId: seededClaim.id,
      mergedClaimIds: [createdClaimId],
      claim: "Revenue and bookings are supported by the supplied exports.",
      reviewStatus: "verified",
      reason: "Merge the reviewed explicit claim into the seeded artifact claim.",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const mergeResult = merged.structuredContent as {
    changed?: boolean;
    readiness?: string;
    status?: string;
    decisionCount?: number;
    auditEventCount?: number;
    findingCount?: number;
  };
  assert.equal(mergeResult.changed, true);
  assert.equal(mergeResult.readiness, "ready");
  assert.equal(mergeResult.status, "export_ready");
  assert.equal(mergeResult.decisionCount, 2);
  assert.equal(mergeResult.auditEventCount, 2);
  assert.equal(mergeResult.findingCount, 0);

  const repeatedMerge = await client.callTool({
    name: "evidencemap_merge_general_claims",
    arguments: {
      baseDir,
      runId: run.runId,
      targetClaimId: seededClaim.id,
      mergedClaimIds: [createdClaimId],
      claim: "Revenue and bookings are supported by the supplied exports.",
      reviewStatus: "verified",
      reason: "Merge the reviewed explicit claim into the seeded artifact claim.",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((repeatedMerge.structuredContent as { changed?: boolean; decisionCount?: number; auditEventCount?: number }).changed, false);
  assert.equal((repeatedMerge.structuredContent as { changed?: boolean; decisionCount?: number; auditEventCount?: number }).decisionCount, 2);
  assert.equal((repeatedMerge.structuredContent as { changed?: boolean; decisionCount?: number; auditEventCount?: number }).auditEventCount, 2);

  const reviewedFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.equal(reviewedFindings.length, 0);
  const reviewDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: Array<{ action?: string }>;
    auditEvents: Array<{
      action?: string;
      before?: { target?: { id?: string }; mergedClaims?: Array<{ id?: string }> };
      after?: { target?: { id?: string; sourceIds?: string[]; assumptions?: string[]; transformation?: string; reviewStatus?: string }; removedClaimIds?: string[] };
    }>;
  };
  assert.deepEqual(
    reviewDecisionSet.decisions.map((decision) => decision.action),
    ["create_claim", "merge_claims"]
  );
  assert.equal(reviewDecisionSet.auditEvents.length, 2);
  const mergeAudit = reviewDecisionSet.auditEvents.find((event) => event.action === "merge_claims");
  assert.ok(mergeAudit);
  assert.equal(mergeAudit.before?.target?.id, seededClaim.id);
  assert.deepEqual(mergeAudit.before?.mergedClaims?.map((claim) => claim.id), [createdClaimId]);
  assert.equal(mergeAudit.after?.target?.id, seededClaim.id);
  assert.deepEqual(mergeAudit.after?.removedClaimIds, [createdClaimId]);
  assert.deepEqual(mergeAudit.after?.target?.sourceIds, [rawSource.id, supportingSource.id].sort());
  assert.deepEqual(mergeAudit.after?.target?.assumptions, mergeAudit.after?.target?.assumptions ? [...mergeAudit.after.target.assumptions].sort() : []);
  assert.ok(mergeAudit.after?.target?.assumptions?.includes("alpha assumption"));
  assert.ok(mergeAudit.after?.target?.assumptions?.includes("zeta assumption"));
  assert.equal(mergeAudit.after?.target?.transformation, "Derived from both fixture sources.");
  assert.equal(mergeAudit.after?.target?.reviewStatus, "verified");

  const latestStoreData = JSON.parse(await readFile(storePath, "utf8")) as {
    claims: ClaimRecord[];
  };
  assert.ok(latestStoreData.claims.some((item) => item.runId === run.runId && item.id === seededClaim.id));
  assert.ok(!latestStoreData.claims.some((item) => item.runId === run.runId && item.id === createdClaimId));
  const effectiveClaims = applyGeneralClaimReviewDecisions({
    claims: latestStoreData.claims.filter((item) => item.runId === run.runId),
    decisions: reviewDecisionSet.decisions as GeneralReviewDecisionRecord[]
  });
  assert.equal(effectiveClaims.length, 1);
  assert.equal(effectiveClaims[0]?.id, seededClaim.id);
  assert.deepEqual(effectiveClaims[0]?.sourceIds, [rawSource.id, supportingSource.id].sort());
  assert.equal(effectiveClaims[0]?.reviewStatus, "verified");

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);

  const rerunDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(rerunDecisionSet.decisions.length, 2);
  assert.equal(rerunDecisionSet.auditEvents.length, 2);

  await client.close();
  await server.close();
});

test("MCP general claim and calculation decisions regenerate ready export idempotently", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-general-advanced-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "general-advanced");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
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
      name: "general-advanced",
      artifactKind: "mixed",
      inputPaths: ["input/general-advanced"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; slug?: string; artifacts?: { verifyDir?: string; exportDir?: string } };
  assert.ok(run.runId);
  assert.ok(run.slug);
  assert.ok(run.artifacts?.verifyDir);
  assert.ok(run.artifacts?.exportDir);

  const storeData = JSON.parse(await readFile(storePath, "utf8")) as {
    claims: Array<{ id: string; runId: string }>;
    calculations: Array<{ id: string; runId: string; riskFlags: string[] }>;
    sources: Array<{ id: string; runId: string; name: string }>;
  };
  const seededClaim = storeData.claims.find((item) => item.runId === run.runId);
  const calculation = storeData.calculations.find((item) => item.runId === run.runId);
  const source = storeData.sources.find((item) => item.runId === run.runId && item.name === "2026-05-01-raw-export.csv");
  assert.ok(seededClaim);
  assert.ok(calculation);
  assert.deepEqual(calculation.riskFlags, ["formula_map_missing", "checks_tab_required"]);
  assert.ok(source);

  const createdClaim = await client.callTool({
    name: "evidencemap_create_general_claim",
    arguments: {
      baseDir,
      runId: run.runId,
      artifactLocation: "section-map:Revenue",
      claim: "Revenue was 100 in the supplied raw export.",
      sourceIds: [source.id],
      reviewStatus: "verified",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((createdClaim.structuredContent as { changed?: boolean; decisionCount?: number }).changed, true);
  assert.equal((createdClaim.structuredContent as { decisionCount?: number }).decisionCount, 1);

  const editedClaim = await client.callTool({
    name: "evidencemap_edit_general_claim",
    arguments: {
      baseDir,
      runId: run.runId,
      claimId: seededClaim.id,
      claim: "The primary artifact claim is supported by the supplied raw export.",
      sourceIds: [source.id],
      reviewStatus: "verified",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((editedClaim.structuredContent as { changed?: boolean; decisionCount?: number }).changed, true);
  assert.equal((editedClaim.structuredContent as { decisionCount?: number }).decisionCount, 2);

  const resolvedCalculation = await client.callTool({
    name: "evidencemap_resolve_calculation_risk",
    arguments: {
      baseDir,
      runId: run.runId,
      calculationId: calculation.id,
      riskFlags: ["formula_map_missing", "checks_tab_required"],
      inputs: [source.id],
      resolution: "Fixture reviewer mapped the raw export as the calculation input and accepted the checks coverage for this run.",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const resolved = resolvedCalculation.structuredContent as {
    changed?: boolean;
    readiness?: string;
    status?: string;
    decisionCount?: number;
    auditEventCount?: number;
    findingCount?: number;
  };
  assert.equal(resolved.changed, true);
  assert.equal(resolved.readiness, "ready");
  assert.equal(resolved.status, "export_ready");
  assert.equal(resolved.decisionCount, 3);
  assert.equal(resolved.auditEventCount, 3);
  assert.equal(resolved.findingCount, 0);

  const decisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: Array<{ action?: string }>;
    auditEvents: unknown[];
  };
  assert.deepEqual(
    decisionSet.decisions.map((decision) => decision.action),
    ["create_claim", "edit_claim", "resolve_calculation_risk"]
  );
  assert.equal(decisionSet.auditEvents.length, 3);
  const trustReport = JSON.parse(await readFile(join(run.artifacts.verifyDir, "trust-report.json"), "utf8")) as { readiness?: string };
  assert.equal(trustReport.readiness, "ready");
  const readyManifest = JSON.parse(await readFile(join(run.artifacts.exportDir, "ready-manifest.json"), "utf8")) as {
    status?: string;
    summary?: { generalReviewDecisionCount?: number };
  };
  assert.equal(readyManifest.status, "export_ready");
  assert.equal(readyManifest.summary?.generalReviewDecisionCount, 3);

  const finalArtifactPath = join(baseDir, "final", "reviewed-report.md");
  await mkdir(join(baseDir, "final"), { recursive: true });
  await writeFile(finalArtifactPath, "# Reviewed Report\n\nRevenue was 100 in the supplied raw export.\n");

  const preview = await client.callTool({
    name: "evidencemap_apply_general_final_artifacts",
    arguments: {
      baseDir,
      runId: run.runId,
      artifactPaths: ["final/reviewed-report.md"],
      dryRun: true,
      reviewer: "fixture-reviewer",
      notes: "Preview the reviewed report handoff.",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const previewContent = preview.structuredContent as {
    status?: string;
    dryRun?: boolean;
    artifactCount?: number;
    approvedArtifacts?: Array<{ copiedPath?: string; sha256?: string }>;
    receiptJsonPath?: string;
  };
  assert.equal(previewContent.status, "preview_ready");
  assert.equal(previewContent.dryRun, true);
  assert.equal(previewContent.artifactCount, 1);
  const plannedCopiedPath = previewContent.approvedArtifacts?.[0]?.copiedPath;
  assert.ok(plannedCopiedPath);
  assert.ok(previewContent.approvedArtifacts?.[0]?.sha256);
  assert.equal(previewContent.receiptJsonPath, undefined);
  await assert.rejects(readFile(plannedCopiedPath, "utf8"));
  await assert.rejects(readFile(join(run.artifacts.exportDir, "general-final-artifact-receipt.json"), "utf8"));

  const applied = await client.callTool({
    name: "evidencemap_apply_general_final_artifacts",
    arguments: {
      baseDir,
      runId: run.runId,
      artifactPaths: ["final/reviewed-report.md"],
      reviewer: "fixture-reviewer",
      notes: "Apply the reviewed report for local handoff.",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const appliedContent = applied.structuredContent as {
    status?: string;
    dryRun?: boolean;
    artifactCount?: number;
    approvedArtifacts?: Array<{ copiedPath?: string; copiedPathRelativeToRun?: string; sha256?: string }>;
    receiptJsonPath?: string;
    receiptMarkdownPath?: string;
  };
  assert.equal(appliedContent.status, "applied");
  assert.equal(appliedContent.dryRun, false);
  assert.equal(appliedContent.artifactCount, 1);
  const copiedArtifact = appliedContent.approvedArtifacts?.[0];
  assert.ok(copiedArtifact?.copiedPath);
  assert.match(copiedArtifact.copiedPathRelativeToRun ?? "", /^04_export\/approved-artifacts\/reviewed-report-[a-f0-9]{12}\.md$/);
  assert.equal(await readFile(copiedArtifact.copiedPath, "utf8"), "# Reviewed Report\n\nRevenue was 100 in the supplied raw export.\n");
  assert.ok(appliedContent.receiptJsonPath);
  assert.ok(appliedContent.receiptMarkdownPath);
  const receipt = JSON.parse(await readFile(appliedContent.receiptJsonPath, "utf8")) as {
    status?: string;
    readiness?: string;
    artifacts?: { sourcePacket?: string; readyManifest?: string; verificationReport?: string; trustReport?: string; reviewAudit?: string };
    approvedArtifacts?: Array<{ originalPathRelativeToBaseDir?: string; copiedPathRelativeToRun?: string; sha256?: string }>;
  };
  assert.equal(receipt.status, "applied");
  assert.equal(receipt.readiness, "ready");
  assert.equal(receipt.artifacts?.sourcePacket, "01_source-packet/source-inventory.json");
  assert.equal(receipt.artifacts?.readyManifest, "04_export/ready-manifest.json");
  assert.equal(receipt.artifacts?.verificationReport, "03_verification/verification-report.md");
  assert.equal(receipt.artifacts?.trustReport, "03_verification/trust-report.json");
  assert.equal(receipt.artifacts?.reviewAudit, "03_verification/general-review-decisions.json");
  assert.equal(receipt.approvedArtifacts?.[0]?.originalPathRelativeToBaseDir, "final/reviewed-report.md");
  assert.equal(receipt.approvedArtifacts?.[0]?.copiedPathRelativeToRun, copiedArtifact.copiedPathRelativeToRun);
  assert.equal(receipt.approvedArtifacts?.[0]?.sha256, copiedArtifact.sha256);
  const receiptMarkdown = await readFile(appliedContent.receiptMarkdownPath, "utf8");
  assert.match(receiptMarkdown, /General Final Artifact Receipt/);
  assert.match(receiptMarkdown, /No model calls, external sending, filing, submission, or publication were performed/);

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  const rerunDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(rerunDecisionSet.decisions.length, 3);
  assert.equal(rerunDecisionSet.auditEvents.length, 3);
  const rerunTrustReport = JSON.parse(await readFile(join(run.artifacts.verifyDir, "trust-report.json"), "utf8")) as { readiness?: string };
  assert.equal(rerunTrustReport.readiness, "ready");

  await client.close();
  await server.close();
});

test("MCP general risk and conflict decisions regenerate verification idempotently", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-general-conflict-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "general-conflict");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "board-model.csv"), "metric,value\nrevenue,100\n");
  await writeFile(join(inputDir, "old-board-model.csv"), "metric,value\nrevenue,90\n");
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
      name: "general-conflict",
      artifactKind: "document",
      inputPaths: ["input/general-conflict"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; slug?: string; artifacts?: { sourceDir?: string; verifyDir?: string } };
  assert.ok(run.runId);
  assert.ok(run.slug);
  assert.ok(run.artifacts?.sourceDir);
  assert.ok(run.artifacts?.verifyDir);

  const conflicts = JSON.parse(await readFile(join(run.artifacts.sourceDir, "source-conflicts.json"), "utf8")) as Array<{
    id: string;
    status: string;
  }>;
  const conflict = conflicts[0];
  assert.ok(conflict);
  assert.equal(conflict.status, "open");
  const initialFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    location: string;
    issue: string;
  }>;
  assert.ok(initialFindings.some((finding) => finding.location === "source-conflict"));
  const sourceStatusFinding = initialFindings.find(
    (finding) => finding.location === "source:board-model.csv" && finding.issue === "Source status is unclear."
  );
  assert.ok(sourceStatusFinding);

  const accepted = await client.callTool({
    name: "evidencemap_accept_general_risk",
    arguments: {
      baseDir,
      runId: run.runId,
      location: sourceStatusFinding.location,
      issue: sourceStatusFinding.issue,
      reason: "Fixture reviewer accepts source status for this narrow run.",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((accepted.structuredContent as { changed?: boolean }).changed, true);

  const resolved = await client.callTool({
    name: "evidencemap_resolve_source_conflict",
    arguments: {
      baseDir,
      runId: run.runId,
      conflictId: conflict.id,
      resolution: "Use board-model.csv as current and keep old-board-model.csv as historical background.",
      reviewer: "fixture-reviewer",
      approvalToken: GENERAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((resolved.structuredContent as { decisionCount?: number; auditEventCount?: number }).decisionCount, 2);
  assert.equal((resolved.structuredContent as { decisionCount?: number; auditEventCount?: number }).auditEventCount, 2);

  const reviewedConflicts = JSON.parse(await readFile(join(run.artifacts.sourceDir, "source-conflicts.json"), "utf8")) as Array<{
    status: string;
    resolution?: string;
  }>;
  assert.equal(reviewedConflicts[0]?.status, "resolved");
  assert.match(reviewedConflicts[0]?.resolution ?? "", /Use board-model\.csv/);
  const reviewedFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    location: string;
    issue: string;
    severity: string;
    humanReviewRequired: boolean;
  }>;
  assert.ok(!reviewedFindings.some((finding) => finding.location === "source-conflict"));
  const acceptedFinding = reviewedFindings.find((finding) => finding.location === sourceStatusFinding.location && finding.issue === sourceStatusFinding.issue);
  assert.ok(acceptedFinding);
  assert.equal(acceptedFinding.severity, "polish");
  assert.equal(acceptedFinding.humanReviewRequired, false);
  const decisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(decisionSet.decisions.length, 2);
  assert.equal(decisionSet.auditEvents.length, 2);

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  const rerunDecisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "general-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(rerunDecisionSet.decisions.length, 2);
  assert.equal(rerunDecisionSet.auditEvents.length, 2);

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

test("MCP legal source authority and treatment decisions update packet artifacts", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-legal-source-review-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "legal-source-review");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "mystery.md"), "# Mystery Source\n\nThis source needs legal classification review.\n");
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
      name: "legal-source-review",
      artifactKind: "document",
      profile: "legal",
      inputPaths: ["input/legal-source-review"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; artifacts?: { sourceDir?: string; verifyDir?: string } };
  assert.ok(run.runId);
  assert.ok(run.artifacts?.sourceDir);
  assert.ok(run.artifacts?.verifyDir);

  const initialFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.ok(initialFindings.some((finding) => finding.issue === "Legal source authority level requires review."));
  assert.ok(initialFindings.some((finding) => finding.issue === "Legal source treatment has not been checked."));
  const legalPacket = JSON.parse(await readFile(join(run.artifacts.sourceDir, "legal-source-packet.json"), "utf8")) as {
    sources: Array<{ sourceId: string; title: string; authorityLevel: string; treatmentStatus: string; reviewStatus: string }>;
  };
  const source = legalPacket.sources.find((item) => item.title === "mystery.md");
  assert.ok(source);

  await client.callTool({
    name: "evidencemap_update_legal_source_authority",
    arguments: {
      baseDir,
      runId: run.runId,
      sourceId: source.sourceId,
      authorityLevel: "persuasive",
      sourceKind: "case",
      reviewer: "fixture-reviewer",
      approvalToken: LEGAL_REVIEW_APPROVAL_TOKEN
    }
  });
  const treatmentResult = await client.callTool({
    name: "evidencemap_update_legal_source_treatment",
    arguments: {
      baseDir,
      runId: run.runId,
      sourceId: source.sourceId,
      treatmentStatus: "checked_current",
      sourceStatus: "current",
      reviewer: "fixture-reviewer",
      approvalToken: LEGAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((treatmentResult.structuredContent as { decisionCount?: number; auditEventCount?: number }).decisionCount, 2);
  assert.equal((treatmentResult.structuredContent as { decisionCount?: number; auditEventCount?: number }).auditEventCount, 2);

  const reviewedPacket = JSON.parse(await readFile(join(run.artifacts.sourceDir, "legal-source-packet.json"), "utf8")) as {
    sources: Array<{ sourceId: string; sourceKind: string; authorityLevel: string; treatmentStatus: string; sourceStatus: string; reviewStatus: string }>;
  };
  const reviewedSource = reviewedPacket.sources.find((item) => item.sourceId === source.sourceId);
  assert.ok(reviewedSource);
  assert.equal(reviewedSource.sourceKind, "case");
  assert.equal(reviewedSource.authorityLevel, "persuasive");
  assert.equal(reviewedSource.treatmentStatus, "checked_current");
  assert.equal(reviewedSource.sourceStatus, "current");
  assert.equal(reviewedSource.reviewStatus, "verified");
  const reviewedFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue?: string;
  }>;
  assert.ok(!reviewedFindings.some((finding) => finding.issue === "Legal source authority level requires review."));
  assert.ok(!reviewedFindings.some((finding) => finding.issue === "Legal source treatment has not been checked."));

  await client.close();
  await server.close();
});

test("MCP legal risk acceptance carries a finding without blocking", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-legal-risk-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "legal-risk");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "risk-case.md"), "# Hawkins v. McGee\n\nA promise may create a warranty.\n");
  await writeFile(
    join(inputDir, "legal-memo-draft.md"),
    [
      "# Legal Memo Draft",
      "",
      "LEGAL-MAP [rule] source=risk-case.md passage=passage_risk-case_p0002 pin=\"para. 2\" authority=binding: A promise may create a warranty.",
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
      name: "legal-risk",
      artifactKind: "document",
      profile: "legal",
      inputPaths: ["input/legal-risk"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; artifacts?: { verifyDir?: string } };
  assert.ok(run.runId);
  assert.ok(run.artifacts?.verifyDir);
  const initialFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    location: string;
    issue: string;
    category?: string;
    severity: string;
    humanReviewRequired: boolean;
  }>;
  const bindingFinding = initialFindings.find((finding) => finding.issue === "Binding-law proposition lacks binding authority support.");
  assert.ok(bindingFinding);
  assert.equal(bindingFinding.severity, "must_fix");

  const accepted = await client.callTool({
    name: "evidencemap_accept_legal_risk",
    arguments: {
      baseDir,
      runId: run.runId,
      location: bindingFinding.location,
      issue: bindingFinding.issue,
      category: bindingFinding.category,
      reason: "Fixture reviewer accepts persuasive authority for coursework discussion.",
      reviewer: "fixture-reviewer",
      approvalToken: LEGAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((accepted.structuredContent as { changed?: boolean }).changed, true);
  const reviewedFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    issue: string;
    severity: string;
    humanReviewRequired: boolean;
    recommendedRepair: string;
  }>;
  const acceptedFinding = reviewedFindings.find((finding) => finding.issue === bindingFinding.issue);
  assert.ok(acceptedFinding);
  assert.equal(acceptedFinding.severity, "polish");
  assert.equal(acceptedFinding.humanReviewRequired, false);
  assert.match(acceptedFinding.recommendedRepair, /Accepted or carried by legal review decision/);

  await client.close();
  await server.close();
});

test("MCP legal source conflict decisions regenerate verification idempotently", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-mcp-legal-conflict-"));
  fixtureDirs.push(baseDir);
  const inputDir = join(baseDir, "input", "legal-conflict");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "case.md"), "# Case\n\nCurrent case excerpt.\n");
  await writeFile(join(inputDir, "old-case.md"), "# Old Case\n\nSuperseded case excerpt.\n");
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
      name: "legal-conflict",
      artifactKind: "document",
      profile: "legal",
      inputPaths: ["input/legal-conflict"]
    }
  });
  const run = runResult.structuredContent as { runId?: string; slug?: string; artifacts?: { sourceDir?: string; verifyDir?: string } };
  assert.ok(run.runId);
  assert.ok(run.slug);
  assert.ok(run.artifacts?.sourceDir);
  assert.ok(run.artifacts?.verifyDir);
  const conflicts = JSON.parse(await readFile(join(run.artifacts.sourceDir, "source-conflicts.json"), "utf8")) as Array<{
    id: string;
    status: string;
    resolution?: string;
  }>;
  const conflict = conflicts[0];
  assert.ok(conflict);
  assert.equal(conflict.status, "open");
  const initialFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    location: string;
  }>;
  assert.ok(initialFindings.some((finding) => finding.location === "source-conflict"));

  const resolved = await client.callTool({
    name: "evidencemap_resolve_legal_source_conflict",
    arguments: {
      baseDir,
      runId: run.runId,
      conflictId: conflict.id,
      resolution: "Use case.md and carry old-case.md only as background.",
      carryAsRisk: true,
      reviewer: "fixture-reviewer",
      approvalToken: LEGAL_REVIEW_APPROVAL_TOKEN
    }
  });
  assert.equal((resolved.structuredContent as { decisionCount?: number; auditEventCount?: number }).decisionCount, 1);
  assert.equal((resolved.structuredContent as { decisionCount?: number; auditEventCount?: number }).auditEventCount, 1);
  const reviewedConflicts = JSON.parse(await readFile(join(run.artifacts.sourceDir, "source-conflicts.json"), "utf8")) as Array<{
    status: string;
    resolution?: string;
  }>;
  assert.equal(reviewedConflicts[0]?.status, "resolved");
  assert.match(reviewedConflicts[0]?.resolution ?? "", /Carried as accepted legal risk/);
  const reviewedFindings = JSON.parse(await readFile(join(run.artifacts.verifyDir, "verification-findings.json"), "utf8")) as Array<{
    location: string;
  }>;
  assert.ok(!reviewedFindings.some((finding) => finding.location === "source-conflict"));

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${run.slug}`]);
  const decisionSet = JSON.parse(await readFile(join(run.artifacts.verifyDir, "legal-review-decisions.json"), "utf8")) as {
    decisions: unknown[];
    auditEvents: unknown[];
  };
  assert.equal(decisionSet.decisions.length, 1);
  assert.equal(decisionSet.auditEvents.length, 1);

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

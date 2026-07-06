import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import JSZip from "jszip";
import { writeRunArtifacts } from "../src/artifacts/write.ts";
import { runEvidenceMapWorkflow } from "../src/chains/evidence-map/workflow.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { MemoryEvidenceMapStore } from "../src/db/memory-store.ts";
import { runEvidenceMapRefresh } from "../src/refresh/workflow.ts";
import {
  appendMarkOcrRequiredDecision,
  appendSetSourceDateDecision,
  emptySourcePrepReviewDecisionSet,
  readSourcePrepReviewDecisionSet,
  SOURCE_PREP_APPROVAL_TOKEN,
  sourcePrepReviewDecisionSetPath
} from "../src/review/source-prep-decisions.ts";
import { evaluateTrust } from "../src/trust/evaluate.ts";
import { buildHostileReviewFindings } from "../src/verify/hostile-review.ts";

const execFileAsync = promisify(execFile);

test("workflow creates source packet, spec, verification report, and export gate", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-"));
  const inputDir = join(baseDir, "input", "sample-project");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-finance-export.xlsx"), "placeholder");
  await writeFile(join(inputDir, "old-board-deck.pptx"), "placeholder");

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "sample-project",
    artifactKind: "deck",
    inputPaths: ["input/sample-project"]
  });

  assert.equal(result.sources.length, 2);
  assert.equal(result.inspections.length, 2);
  assert.equal(result.spec.artifactKind, "deck");
  assert.equal(result.trustReport.readiness, "blocked");
  assert.ok(result.findings.some((finding) => finding.issue.includes("Claim has no source")));
  assert.match(result.artifacts.runDir, /deliverables\/sample-project-[a-f0-9]{8}$/);
  const inspections = JSON.parse(await readFile(join(result.artifacts.sourceDir, "file-inspections.json"), "utf8"));
  assert.equal(inspections.length, 2);
  const exportReadme = await readFile(join(result.artifacts.exportDir, "README.md"), "utf8");
  assert.match(exportReadme, /General Export Gate Receipt/);
  assert.match(exportReadme, /Status: refused/);
  assert.match(exportReadme, /Ready manifest: not written/);
  const sourceEvidence = JSON.parse(await readFile(join(result.artifacts.sourceDir, "source-evidence.json"), "utf8"));
  assert.ok(Array.isArray(sourceEvidence));
  const repairPacket = JSON.parse(await readFile(join(result.artifacts.verifyDir, "calculation-repair-packet.json"), "utf8"));
  assert.equal(repairPacket.profile, "general");
  const refusal = await readFile(join(result.artifacts.exportDir, "general-export-refusal.md"), "utf8");
  assert.match(refusal, /General Export Refusal/);
  assert.match(refusal, /Claim has no source attribution/);
  const reviewQueue = JSON.parse(await readFile(join(result.artifacts.verifyDir, "review-queue.json"), "utf8"));
  assert.equal(reviewQueue.readiness, "blocked");
  assert.equal(reviewQueue.artifactRefs.trustReport, "03_verification/trust-report.json");
  assert.ok(reviewQueue.items.some((item: { action?: string }) => item.action === "attach_source_support"));
  const reviewQueueMarkdown = await readFile(join(result.artifacts.verifyDir, "review-queue.md"), "utf8");
  assert.match(reviewQueueMarkdown, /Review Queue/);
  assert.match(reviewQueueMarkdown, /Attach source support/);
  assert.match(reviewQueueMarkdown, /Evidence link suggestions/);
  assert.match(reviewQueueMarkdown, /Calculation repair packet/);
  await assert.rejects(readFile(join(result.artifacts.exportDir, "ready-manifest.json"), "utf8"));
});

test("review workflow writes evidence link suggestions and calculation repair packet", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-review-suggestions-"));
  const inputDir = join(baseDir, "input", "review-suggestions");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-current-metrics.csv"), "metric,value,as_of_date\nrevenue,100,2026-05-01\n");
  await writeFile(join(inputDir, "summary.md"), "# Summary\n\nRevenue was 100 as of 2026-05-01 and should be reviewed against the current metrics export.\n");

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "review-suggestions",
    artifactKind: "mixed",
    inputPaths: ["input/review-suggestions"]
  });

  const suggestions = JSON.parse(await readFile(join(result.artifacts.verifyDir, "evidence-link-suggestions.json"), "utf8"));
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.some((suggestion: { matchedNumbers?: string[] }) => suggestion.matchedNumbers?.includes("100")));
  const suggestionsMarkdown = await readFile(join(result.artifacts.verifyDir, "evidence-link-suggestions.md"), "utf8");
  assert.match(suggestionsMarkdown, /Evidence Link Suggestions/);
  const repairPacket = JSON.parse(await readFile(join(result.artifacts.verifyDir, "calculation-repair-packet.json"), "utf8"));
  assert.ok(repairPacket.itemCount > 0);
  assert.ok(repairPacket.items.some((item: { suggestedDecision?: { tool?: string } }) => item.suggestedDecision?.tool === "evidencemap_resolve_general_calculation_risk"));
});

test("deck workflow seeds unsupported claims from PPTX slide and notes text", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-pptx-claims-"));
  const inputDir = join(baseDir, "input", "deck-claims");
  await mkdir(inputDir, { recursive: true });
  await writeWorkflowPptx(join(inputDir, "2026-05-01-board-deck.pptx"));

  const store = new MemoryEvidenceMapStore();
  const result = await runEvidenceMapWorkflow(store, {
    baseDir,
    name: "deck-claims",
    artifactKind: "deck",
    inputPaths: ["input/deck-claims"]
  });
  const claims = await store.listClaims(result.run.id);

  assert.ok(claims.some((claim) => claim.claim === "Revenue increased to 42 in the pilot cohort."));
  assert.ok(claims.some((claim) => claim.claim === "Customer churn declined by 12% after onboarding changes."));
  assert.ok(claims.every((claim) => claim.claim !== "Primary artifact claim must be supplied by the human owner or source packet."));
  assert.ok(claims.some((claim) => claim.artifactLocation.endsWith(":slide:1")));
  assert.ok(claims.some((claim) => claim.artifactLocation.endsWith(":slide:1:notes")));
  assert.ok(
    result.findings.some(
      (finding) => finding.issue === "Claim has no source attribution." && finding.location === "deck:2026-05-01-board-deck.pptx:slide:1"
    )
  );
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.issue === "Claim is marked unsupported." &&
        finding.location === "deck:2026-05-01-board-deck.pptx:slide:1:notes" &&
        finding.evidence === "Customer churn declined by 12% after onboarding changes."
    )
  );
});

test("declared draft files limit claim seeding to the draft", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-draft-"));
  const inputDir = join(baseDir, "input", "draft-scope");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-06-01-response-draft.md"), "Revenue was $12 million as of 2026-05-31.\n\nHeadcount grew to 84 people in May 2026.\n");
  await writeFile(join(inputDir, "2026-05-15-reference-report.md"), "The reference report shows revenue reached $12 million by late May.\n\nBackground staffing tables list 84 employees.\n");

  const store = new MemoryEvidenceMapStore();
  const result = await runEvidenceMapWorkflow(store, {
    baseDir,
    name: "draft-scope",
    artifactKind: "document",
    inputPaths: ["input/draft-scope"],
    draftFiles: ["2026-06-01-response-draft.md"]
  });
  const claims = await store.listClaims(result.run.id);

  assert.equal(result.run.draftFiles?.length, 1);
  assert.ok(claims.length > 0);
  assert.ok(claims.every((claim) => claim.artifactLocation.includes(":2026-06-01-response-draft.md:")));
  assert.ok(result.evidenceLinkSuggestions?.some((suggestion) => suggestion.sourceName === "2026-05-15-reference-report.md"));
});

test("unknown draft file names fail the run", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-draft-unknown-"));
  const inputDir = join(baseDir, "input", "draft-unknown");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-06-01-response-draft.md"), "Revenue was $12 million as of 2026-05-31.\n");

  const store = new MemoryEvidenceMapStore();
  await assert.rejects(
    runEvidenceMapWorkflow(store, {
      baseDir,
      name: "draft-unknown",
      artifactKind: "document",
      inputPaths: ["input/draft-unknown"],
      draftFiles: ["missing-draft.md"]
    }),
    /Unknown draft file\(s\): missing-draft.md/
  );
});

test("declared draft with no extractable claims is a blocking finding", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-draft-empty-"));
  const inputDir = join(baseDir, "input", "draft-empty");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-06-01-scanned-draft.md"), "ok\n");
  await writeFile(join(inputDir, "2026-05-15-reference-report.md"), "The reference report shows revenue reached $12 million by late May.\n");

  const store = new MemoryEvidenceMapStore();
  const result = await runEvidenceMapWorkflow(store, {
    baseDir,
    name: "draft-empty",
    artifactKind: "document",
    inputPaths: ["input/draft-empty"],
    draftFiles: ["2026-06-01-scanned-draft.md"]
  });

  assert.equal(result.trustReport.readiness, "blocked");
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.issue === "Declared draft produced no extractable claims." &&
        finding.location === "source:2026-06-01-scanned-draft.md" &&
        finding.severity === "must_fix"
    )
  );
});

test("clean end-to-end generation writes final Markdown and ready manifest", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-generate-clean-"));
  const inputDir = join(baseDir, "input", "clean-report");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-current-metrics.csv"), "metric,value,as_of_date\nactive_users,42,2026-05-01\n");
  await writeFile(join(inputDir, "interview-notes.md"), "# Interview Notes\n\nOperators report that onboarding was completed before the pilot launch.\n");

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "clean-report",
    artifactKind: "report",
    inputPaths: ["input/clean-report"],
    generate: true
  });

  assert.equal(result.trustReport.readiness, "ready");
  assert.equal(result.run.status, "export_ready");
  assert.equal(result.generatedOutput?.status, "export_ready");
  const finalMarkdown = await readFile(join(result.artifacts.exportDir, "final-output.md"), "utf8");
  assert.match(finalMarkdown, /active users was 42 as of 2026-05-01/);
  assert.match(finalMarkdown, /sources: src_/);
  assert.match(finalMarkdown, /evidence: evidence_/);
  assert.match(finalMarkdown, /Readiness applies to this generated Markdown receipt and the review packet/);
  const formattedMarkdown = await readFile(join(result.artifacts.exportDir, "formatted-output.md"), "utf8");
  assert.match(formattedMarkdown, /deterministic formatted derivative/);
  assert.match(formattedMarkdown, /active users was 42 as of 2026-05-01/);
  assert.match(formattedMarkdown, /generated claim: generated_claim_/);
  assert.match(formattedMarkdown, /sources: src_/);
  assert.match(formattedMarkdown, /evidence: evidence_/);
  const manifest = JSON.parse(await readFile(join(result.artifacts.exportDir, "ready-manifest.json"), "utf8"));
  assert.equal(manifest.artifacts.finalOutput, "04_export/final-output.md");
  assert.equal(manifest.artifacts.evidenceMap, "03_verification/evidence-map.json");
  assert.equal(manifest.artifacts.generatedOutputReceipt, "04_export/generated-output-receipt.json");
  assert.equal(manifest.artifacts.formattedOutput, "04_export/formatted-output.md");
  assert.equal(manifest.artifacts.formattingReceipt, "04_export/formatting-receipt.json");
  assert.equal(manifest.artifacts.generatedEditProposal, "04_export/generated-edit-proposal.json");
  assert.equal(manifest.artifacts.editedOutput, "04_export/edited-output.md");
  await readFile(join(result.artifacts.verifyDir, "generated-claims.json"), "utf8");
  await readFile(join(result.artifacts.verifyDir, "evidence-map.json"), "utf8");
  await readFile(join(result.artifacts.exportDir, "generated-output-receipt.json"), "utf8");
  const formattingReceipt = JSON.parse(await readFile(join(result.artifacts.exportDir, "formatting-receipt.json"), "utf8"));
  assert.equal(formattingReceipt.status, "formatted");
  assert.equal(formattingReceipt.canonicalOutput, "04_export/final-output.md");
  assert.equal(formattingReceipt.formattedOutput, "04_export/formatted-output.md");
  assert.ok(formattingReceipt.invariantChecks.every((check: { status: string }) => check.status === "passed"));
  const editProposal = JSON.parse(await readFile(join(result.artifacts.exportDir, "generated-edit-proposal.json"), "utf8"));
  assert.equal(editProposal.editedOutput, "04_export/edited-output.md");
  const editedOutput = await readFile(join(result.artifacts.exportDir, "edited-output.md"), "utf8");
  assert.match(editedOutput, /generated claim: generated_claim_/);
  assert.match(editedOutput, /sources: src_/);
  assert.match(editedOutput, /evidence: evidence_/);
});

test("refresh workflow writes receipt and snapshots prior review trail", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-refresh-"));
  const inputDir = join(baseDir, "input", "refresh-report");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-current-metrics.csv"), "metric,value,as_of_date\nactive_users,42,2026-05-01\n");
  const store = new JsonFileEvidenceMapStore(join(baseDir, "deliverables", "evidence-map-store.json"));

  const firstRun = await runEvidenceMapWorkflow(store, {
    baseDir,
    name: "refresh-report",
    artifactKind: "report",
    inputPaths: ["input/refresh-report"],
    generate: true
  });
  const refreshed = await runEvidenceMapRefresh(store, {
    baseDir,
    priorRunId: firstRun.run.id,
    name: "refresh-report-next",
    artifactKind: "report",
    inputPaths: ["input/refresh-report"],
    generate: true
  });

  assert.equal(refreshed.refreshReceipt.priorRunId, firstRun.run.id);
  assert.equal(refreshed.refreshReceipt.newRunId, refreshed.run.id);
  assert.ok(refreshed.refreshReceipt.carriedArtifacts.some((artifact) => artifact.priorRunPath.endsWith("trust-report.json")));
  const receiptMarkdown = await readFile(join(refreshed.artifacts.runDir, "00_refresh", "refresh-receipt.md"), "utf8");
  assert.match(receiptMarkdown, /Prior approvals were not automatically replayed/);
});

test("verify command preserves generated output mode and final artifacts", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-verify-generated-"));
  const inputDir = join(baseDir, "input", "generated-report");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-current-metrics.csv"), "metric,value,as_of_date\nactive_users,42,2026-05-01\n");
  const storePath = join(baseDir, "deliverables", "evidence-map-store.json");
  const result = await runEvidenceMapWorkflow(new JsonFileEvidenceMapStore(storePath), {
    baseDir,
    name: "generated-report",
    artifactKind: "report",
    inputPaths: ["input/generated-report"],
    generate: true
  });
  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));

  const firstVerify = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--base-dir",
    baseDir,
    "--run",
    `deliverables/${result.run.slug}`,
    "--json"
  ]);
  const secondVerify = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--base-dir",
    baseDir,
    "--run",
    `deliverables/${result.run.slug}`,
    "--json"
  ]);

  assert.equal(JSON.parse(firstVerify.stdout).readiness, "ready");
  assert.equal(JSON.parse(secondVerify.stdout).readiness, "ready");
  await readFile(join(result.artifacts.exportDir, "final-output.md"), "utf8");
  await readFile(join(result.artifacts.exportDir, "generated-output-receipt.json"), "utf8");
  await readFile(join(result.artifacts.exportDir, "formatted-output.md"), "utf8");
  await readFile(join(result.artifacts.exportDir, "formatting-receipt.json"), "utf8");

  const report = JSON.parse(await readFile(join(result.artifacts.verifyDir, "trust-report.json"), "utf8"));
  const data = JSON.parse(await readFile(storePath, "utf8"));
  const findingsForRun = data.findings.filter((finding: { runId: string }) => finding.runId === result.run.id);
  assert.equal(report.readiness, "ready");
  assert.equal(findingsForRun.length, result.findings.length);
});

test("generated metric dates must be valid dates", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-invalid-generated-date-"));
  const inputDir = join(baseDir, "input", "invalid-date-report");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-current-metrics.csv"), "metric,value,as_of_date\nactive_users,42,TBD\n");

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "invalid-date-report",
    artifactKind: "report",
    inputPaths: ["input/invalid-date-report"],
    generate: true
  });

  assert.equal(result.trustReport.readiness, "blocked");
  assert.ok(result.findings.some((finding) => /generated numeric claim has (?:no|invalid|no valid) source date/i.test(finding.issue)));
  const generatedClaims = JSON.parse(await readFile(join(result.artifacts.verifyDir, "generated-claims.json"), "utf8")) as Array<{
    claim?: string;
    reviewStatus?: string;
    sourceDates?: string[];
  }>;
  assert.ok(generatedClaims.some((claim) => claim.claim?.includes("active users was 42")));
  assert.ok(generatedClaims.every((claim) => !claim.claim?.includes("as of TBD")));
  assert.ok(generatedClaims.every((claim) => !claim.sourceDates?.includes("TBD")));
  await assert.rejects(readFile(join(result.artifacts.exportDir, "final-output.md"), "utf8"));
});

test("CSV generation does not silently drop rows beyond 100", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-csv-full-capture-"));
  const inputDir = join(baseDir, "input", "full-csv-report");
  await mkdir(inputDir, { recursive: true });
  const rows = ["metric,value,as_of_date"];
  for (let index = 1; index <= 150; index += 1) {
    rows.push(`metric_${index},${index},2026-05-01`);
  }
  rows.push("late_metric,151,2026-05-01");
  await writeFile(join(inputDir, "2026-05-01-current-metrics.csv"), `${rows.join("\n")}\n`);

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "full-csv-report",
    artifactKind: "report",
    inputPaths: ["input/full-csv-report"],
    generate: true
  });

  assert.equal(result.trustReport.readiness, "ready");
  const inspections = JSON.parse(await readFile(join(result.artifacts.sourceDir, "file-inspections.json"), "utf8")) as Array<{
    structuredSummary?: Record<string, unknown>;
  }>;
  const summary = inspections[0]?.structuredSummary ?? {};
  assert.equal(summary.nonEmptyRowCount, 152);
  assert.equal(summary.capturedRowCount, 152);
  assert.equal(summary.omittedRowCount, 0);
  assert.equal(summary.rowCaptureTruncated, false);

  const generatedClaims = JSON.parse(await readFile(join(result.artifacts.verifyDir, "generated-claims.json"), "utf8")) as Array<{
    claim?: string;
  }>;
  assert.ok(generatedClaims.some((claim) => claim.claim?.includes("late metric was 151 as of 2026-05-01")));
  const evidenceMap = JSON.parse(await readFile(join(result.artifacts.verifyDir, "evidence-map.json"), "utf8"));
  assert.equal(evidenceMap.summary.generatedClaimCount, generatedClaims.length);
});

test("CSV generation refuses when row capture is truncated", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-csv-truncated-"));
  const inputDir = join(baseDir, "input", "truncated-csv-report");
  await mkdir(inputDir, { recursive: true });
  const rows = ["metric,value,as_of_date"];
  for (let index = 1; index <= 10_001; index += 1) {
    rows.push(`m${index},${index},2026-05-01`);
  }
  await writeFile(join(inputDir, "2026-05-01-current-large.csv"), `${rows.join("\n")}\n`);

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "truncated-csv-report",
    artifactKind: "report",
    inputPaths: ["input/truncated-csv-report"],
    generate: true
  });

  assert.equal(result.trustReport.readiness, "blocked");
  assert.ok(result.findings.some((finding) => /row capture truncated/i.test(finding.issue)));
  const inspections = JSON.parse(await readFile(join(result.artifacts.sourceDir, "file-inspections.json"), "utf8")) as Array<{
    structuredSummary?: Record<string, unknown>;
  }>;
  const summary = inspections[0]?.structuredSummary ?? {};
  assert.equal(summary.nonEmptyRowCount, 10002);
  assert.equal(summary.capturedRowCount, 10000);
  assert.equal(summary.omittedRowCount, 2);
  assert.equal(summary.rowCaptureTruncated, true);
  const refusal = await readFile(join(result.artifacts.exportDir, "general-export-refusal.md"), "utf8");
  assert.match(refusal, /row capture truncated/i);
  await assert.rejects(readFile(join(result.artifacts.exportDir, "final-output.md"), "utf8"));
});

test("capstone messy-folder generation writes final Markdown and excludes old or risky sources", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-generate-capstone-"));
  const fixtureDir = fileURLToPath(new URL("../../input/examples/capstone-report", import.meta.url));
  await cp(fixtureDir, join(baseDir, "input", "capstone-report"), { recursive: true });

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "capstone-report",
    artifactKind: "report",
    inputPaths: ["input/capstone-report"],
    generate: true
  });

  assert.equal(result.trustReport.readiness, "ready");
  const finalMarkdown = await readFile(join(result.artifacts.exportDir, "final-output.md"), "utf8");
  assert.match(finalMarkdown, /2026-04-12-survey-raw-export\.csv/);
  assert.match(finalMarkdown, /enrollment-figures-final\.csv/);
  assert.match(finalMarkdown, /interview-notes\.md/);
  const supportSections = finalMarkdown.split("## Excluded Sources")[0] ?? finalMarkdown;
  assert.doesNotMatch(supportSections, /enrollment-figures-old\.csv/);
  assert.doesNotMatch(supportSections, /enrollment-analysis\.xlsx/);
  assert.match(finalMarkdown, /enrollment-figures-old\.csv \| Superseded or archived source excluded/);
  assert.match(finalMarkdown, /enrollment-analysis\.xlsx \| Workbook has unresolved calculation risks/);
  const formattedMarkdown = await readFile(join(result.artifacts.exportDir, "formatted-output.md"), "utf8");
  assert.match(formattedMarkdown, /enrollment-figures-final\.csv/);
  assert.match(formattedMarkdown, /enrollment-figures-old\.csv: Superseded or archived source excluded/);
  assert.match(formattedMarkdown, /enrollment-analysis\.xlsx: Workbook has unresolved calculation risks/);
  assert.match(formattedMarkdown, /30 records in 01_source-packet\/source-evidence\.json/);
  const sourceEvidence = await readFile(join(result.artifacts.sourceDir, "source-evidence.md"), "utf8");
  assert.match(sourceEvidence, /enrollment-figures-old\.csv/);
  assert.match(sourceEvidence, /Workbook has unresolved calculation risks/);
  assert.match(finalMarkdown, /30 records in 01_source-packet\/source-evidence\.json/);
  assert.doesNotMatch(finalMarkdown, /evidence_[a-f0-9]{20}, evidence_[a-f0-9]{20}, evidence_[a-f0-9]{20}, evidence_[a-f0-9]{20}/);
  const generatedClaimsMarkdown = await readFile(join(result.artifacts.verifyDir, "generated-claims.md"), "utf8");
  assert.match(generatedClaimsMarkdown, /30 records in 01_source-packet\/source-evidence\.json/);
  const generatedClaimsJson = JSON.parse(await readFile(join(result.artifacts.verifyDir, "generated-claims.json"), "utf8")) as Array<{
    claim: string;
    evidenceIds: string[];
  }>;
  assert.ok(generatedClaimsJson.some((claim) => claim.claim.includes("included 30 rows") && claim.evidenceIds.length === 30));
});

test("generation refuses unresolved current-source conflicts", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-generate-conflict-"));
  const inputDir = join(baseDir, "input", "conflict-report");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-current-enrollment.csv"), "metric,value,as_of_date\nenrollment,100,2026-05-01\n");
  await writeFile(join(inputDir, "2026-05-02-current-enrollment.csv"), "metric,value,as_of_date\nenrollment,120,2026-05-02\n");

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "conflict-report",
    artifactKind: "report",
    inputPaths: ["input/conflict-report"],
    generate: true
  });

  assert.equal(result.trustReport.readiness, "blocked");
  const refusal = await readFile(join(result.artifacts.exportDir, "general-export-refusal.md"), "utf8");
  assert.match(refusal, /Unresolved current-source conflict for enrollment/);
  await assert.rejects(readFile(join(result.artifacts.exportDir, "final-output.md"), "utf8"));
  await assert.rejects(readFile(join(result.artifacts.exportDir, "formatted-output.md"), "utf8"));
  await assert.rejects(readFile(join(result.artifacts.exportDir, "formatting-receipt.json"), "utf8"));
});

test("generation refuses undated numeric evidence", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-generate-undated-"));
  const inputDir = join(baseDir, "input", "undated-report");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "current-metrics.csv"), "metric,value\nactive_users,42\n");

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "undated-report",
    artifactKind: "report",
    inputPaths: ["input/undated-report"],
    generate: true
  });

  assert.equal(result.trustReport.readiness, "blocked");
  const refusal = await readFile(join(result.artifacts.exportDir, "general-export-refusal.md"), "utf8");
  assert.match(refusal, /no source date/i);
  await assert.rejects(readFile(join(result.artifacts.exportDir, "final-output.md"), "utf8"));
  await assert.rejects(readFile(join(result.artifacts.exportDir, "formatted-output.md"), "utf8"));
  await assert.rejects(readFile(join(result.artifacts.exportDir, "formatting-receipt.json"), "utf8"));
});

test("general final export writes ready manifest when gates are ready", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-general-export-ready-"));
  const runId = "run_general_export_ready";
  const sourceId = "src_general";
  const decisionId = "general_review_decision_1234567890abcdef";
  const run = {
    id: runId,
    slug: "general-export-ready-12345678",
    name: "general-export-ready",
    artifactKind: "document" as const,
    profile: "general" as const,
    status: "export_ready" as const,
    inputPaths: [],
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  };
  const source = {
    id: sourceId,
    runId,
    name: "2026-05-01-source.md",
    path: join(baseDir, "2026-05-01-source.md"),
    fileType: "md",
    status: "current" as const,
    sourceDate: "2026-05-01",
    intendedUse: "Decision support source."
  };
  const findings = [
    {
      id: "finding_accepted_general",
      runId,
      location: "section-map",
      issue: "Source status is unclear.",
      severity: "polish" as const,
      evidence: `Accepted general review risk by ${decisionId}. Reason: Fixture review.`,
      recommendedRepair: `Accepted or carried by general review decision ${decisionId}.`,
      humanReviewRequired: false
    }
  ];
  const artifacts = await writeRunArtifacts({
    baseDir,
    run,
    sources: [source],
    inspections: [
      {
        id: "inspect_general",
        runId,
        sourceId,
        name: source.name,
        path: source.path,
        fileType: "md",
        parser: "markdown-text-v1",
        status: "inspected" as const,
        sizeBytes: 100,
        sourceDateCandidates: ["2026-05-01"],
        ownerCandidates: [],
        structuredSummary: {},
        textPreview: "Supported claim.",
        warnings: []
      }
    ],
    conflicts: [],
    spec: {
      id: "spec_general_export",
      runId,
      artifactKind: "document",
      audience: "Reviewer.",
      decisionContext: "Ready general artifact.",
      narrativeSpine: "Review a supported general artifact.",
      structure: ["Section map"],
      requiredChecks: ["Every claim has source support."],
      reviewRules: ["Run hostile verification before export."]
    },
    findings,
    trustReport: {
      id: "trust_general_ready",
      runId,
      readiness: "ready",
      summary: {
        sourceCount: 1,
        claimCount: 1,
        calculationCount: 0,
        assumptionCount: 0,
        findingCount: findings.length,
        blockingCount: 0,
        needsReviewCount: 0
      },
      blockingIssues: [],
      warnings: []
    },
    generalReviewDecisionSet: {
      runId,
      profile: "general",
      decisions: [
        {
          id: decisionId,
          runId,
          action: "accept_general_risk",
          location: "section-map",
          issue: "Source status is unclear.",
          reason: "Fixture review accepted this carried risk.",
          reviewer: "fixture-reviewer",
          createdAt: "2026-07-06T00:00:00.000Z",
          approvalTokenAccepted: true
        }
      ],
      auditEvents: [
        {
          id: "general_review_audit_1234567890abcdef",
          runId,
          decisionId,
          action: "accept_general_risk",
          actor: "fixture-reviewer",
          createdAt: "2026-07-06T00:00:00.000Z",
          summary: "Accepted fixture risk.",
          before: {},
          after: {}
        }
      ]
    }
  });

  const readme = await readFile(join(artifacts.exportDir, "README.md"), "utf8");
  assert.match(readme, /General Export Gate Receipt/);
  assert.match(readme, /Status: export_ready/);
  assert.match(readme, /04_export\/ready-manifest\.json/);
  assert.match(readme, /03_verification\/general-review-decisions\.json/);
  assert.match(readme, new RegExp(decisionId));
  assert.match(readme, /Unresolved Risks\n\n- None/);
  const manifest = JSON.parse(await readFile(join(artifacts.exportDir, "ready-manifest.json"), "utf8"));
  assert.equal(manifest.status, "export_ready");
  assert.equal(manifest.readiness, "ready");
  assert.equal(manifest.summary.sourceCount, 1);
  assert.equal(manifest.summary.generalReviewDecisionCount, 1);
  const manifestMarkdown = await readFile(join(artifacts.exportDir, "ready-manifest.md"), "utf8");
  assert.match(manifestMarkdown, /General Ready Manifest/);
  assert.match(manifestMarkdown, /No external sending, filing, submission, or publication was performed/);
  await assert.rejects(readFile(join(artifacts.exportDir, "general-export-refusal.md"), "utf8"));
});

test("general export refuses accepted risk without audit trail", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-general-export-audit-"));
  const runId = "run_general_export_audit";
  const decisionId = "general_review_decision_abcdef1234567890";
  const run = {
    id: runId,
    slug: "general-export-audit-12345678",
    name: "general-export-audit",
    artifactKind: "report" as const,
    profile: "general" as const,
    status: "export_ready" as const,
    inputPaths: [],
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  };
  const findings = [
    {
      id: "finding_accepted_without_audit",
      runId,
      location: "section-map",
      issue: "Source status is unclear.",
      severity: "polish" as const,
      evidence: `Accepted general review risk by ${decisionId}.`,
      recommendedRepair: `Accepted or carried by general review decision ${decisionId}.`,
      humanReviewRequired: false
    }
  ];
  const artifacts = await writeRunArtifacts({
    baseDir,
    run,
    sources: [],
    inspections: [],
    conflicts: [],
    spec: {
      id: "spec_general_export_audit",
      runId,
      artifactKind: "report",
      audience: "Reviewer.",
      decisionContext: "Audit check.",
      narrativeSpine: "Do not bypass accepted risk audit.",
      structure: ["Report"],
      requiredChecks: ["Accepted risks have audit events."],
      reviewRules: ["Do not bypass verification gates."]
    },
    findings,
    trustReport: {
      id: "trust_general_audit",
      runId,
      readiness: "ready",
      summary: {
        sourceCount: 0,
        claimCount: 0,
        calculationCount: 0,
        assumptionCount: 0,
        findingCount: findings.length,
        blockingCount: 0,
        needsReviewCount: 0
      },
      blockingIssues: [],
      warnings: []
    },
    generalReviewDecisionSet: {
      runId,
      profile: "general",
      decisions: [],
      auditEvents: []
    }
  });

  const readme = await readFile(join(artifacts.exportDir, "README.md"), "utf8");
  assert.match(readme, /Status: refused/);
  const refusal = await readFile(join(artifacts.exportDir, "general-export-refusal.md"), "utf8");
  assert.match(refusal, /missing a review decision or audit event/);
  await assert.rejects(readFile(join(artifacts.exportDir, "ready-manifest.json"), "utf8"));
});

test("workflow writes each same-name run to a unique artifact folder", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-unique-"));
  await mkdir(join(baseDir, "input", "one"), { recursive: true });
  await mkdir(join(baseDir, "input", "two"), { recursive: true });
  await writeFile(join(baseDir, "input", "one", "2026-05-01-one.csv"), "metric,value\nrevenue,100\n");
  await writeFile(join(baseDir, "input", "two", "2026-05-01-two.csv"), "metric,value\nrevenue,200\n");

  const store = new MemoryEvidenceMapStore();
  const first = await runEvidenceMapWorkflow(store, {
    baseDir,
    name: "same name",
    artifactKind: "workbook",
    inputPaths: ["input/one"]
  });
  const second = await runEvidenceMapWorkflow(store, {
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
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-conflict-"));
  const inputDir = join(baseDir, "input", "conflict");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "board-model.csv"), "label\ncurrent\n");
  await writeFile(join(inputDir, "old-board-model.csv"), "label\nold\n");

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "conflict",
    artifactKind: "deck",
    inputPaths: ["input/conflict"]
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.sourceIds.length, 2);
  assert.ok(result.conflicts[0]?.sourceIds.every((id) => id.startsWith("src_")));
});

test("legal profile workflow writes legal source packet artifacts", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-legal-"));
  const inputDir = join(baseDir, "input", "legal-duty");
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    join(inputDir, "assignment-prompt.md"),
    "# Assignment Prompt\nPrepare a case brief using only the supplied packet.\n"
  );
  await writeFile(
    join(inputDir, "palsgraf-v-long-island-railroad.md"),
    "# Palsgraf v. Long Island Railroad\n248 N.Y. 339\nCourt of Appeals of New York\n"
  );

  const result = await runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
    baseDir,
    name: "legal-duty",
    artifactKind: "document",
    profile: "legal",
    inputPaths: ["input/legal-duty"]
  });

  assert.equal(result.run.profile, "legal");
  assert.ok(result.findings.some((finding) => finding.issue === "Legal proposition has no source support."));
  const legalPacket = JSON.parse(await readFile(join(result.artifacts.sourceDir, "legal-source-packet.json"), "utf8"));
  assert.equal(legalPacket.profile, "legal");
  assert.ok(legalPacket.passages.length > 0);
  assert.ok(legalPacket.sources.some((source: { sourceKind?: string }) => source.sourceKind === "case"));
  assert.ok(legalPacket.sources.some((source: { sourceKind?: string }) => source.sourceKind === "assignment"));
  const legalPassages = JSON.parse(await readFile(join(result.artifacts.sourceDir, "legal-passages.json"), "utf8"));
  assert.equal(legalPassages.length, legalPacket.passages.length);
  const legalPacketMarkdown = await readFile(join(result.artifacts.sourceDir, "legal-source-packet.md"), "utf8");
  assert.match(legalPacketMarkdown, /Legal Source Packet/);
  const legalSourceHistory = JSON.parse(await readFile(join(result.artifacts.sourceDir, "legal-source-history.json"), "utf8"));
  assert.equal(legalSourceHistory.length, legalPacket.sources.length);
  assert.ok(legalSourceHistory.every((source: { sourceVersionKey?: string }) => source.sourceVersionKey?.startsWith("legal_source_version_")));
  const legalSourceHistoryMarkdown = await readFile(join(result.artifacts.sourceDir, "legal-source-history.md"), "utf8");
  assert.match(legalSourceHistoryMarkdown, /Legal Source History/);
  const legalOutputSpec = JSON.parse(await readFile(join(result.artifacts.specDir, "legal-output-spec.json"), "utf8"));
  assert.equal(legalOutputSpec.allowedSourceScope, "provided_packet_only");
  const legalOutputSpecMarkdown = await readFile(join(result.artifacts.specDir, "legal-output-spec.md"), "utf8");
  assert.match(legalOutputSpecMarkdown, /Legal Output Spec/);
  const legalBoundary = JSON.parse(await readFile(join(result.artifacts.specDir, "legal-boundary.json"), "utf8"));
  assert.equal(legalBoundary.profile, "legal");
  assert.match(legalBoundary.boundaryKey, /^legal_boundary_[a-f0-9]{16}$/);
  const legalBoundaryMarkdown = await readFile(join(result.artifacts.specDir, "legal-boundary.md"), "utf8");
  assert.match(legalBoundaryMarkdown, /Legal Boundary/);
  const legalEvidenceMap = JSON.parse(await readFile(join(result.artifacts.verifyDir, "legal-evidence-map.json"), "utf8"));
  assert.equal(legalEvidenceMap.profile, "legal");
  assert.equal(legalEvidenceMap.summary.propositionCount, 1);
  assert.equal(legalEvidenceMap.propositions[0]?.propositionType, "rule");
  assert.ok(Array.isArray(legalEvidenceMap.propositions[0]?.sourceIds));
  assert.ok(Array.isArray(legalEvidenceMap.propositions[0]?.passageIds));
  assert.equal(legalEvidenceMap.propositions[0]?.authorityLevelRequired, "binding");
  assert.equal(legalEvidenceMap.propositions[0]?.reviewStatus, "unsupported");
  const legalEvidenceMapMarkdown = await readFile(join(result.artifacts.verifyDir, "legal-evidence-map.md"), "utf8");
  assert.match(legalEvidenceMapMarkdown, /Legal Evidence Map/);
  const legalDraftPropositions = JSON.parse(await readFile(join(result.artifacts.verifyDir, "legal-draft-propositions.json"), "utf8"));
  assert.deepEqual(legalDraftPropositions, []);
  const legalDraftPropositionsMarkdown = await readFile(join(result.artifacts.verifyDir, "legal-draft-propositions.md"), "utf8");
  assert.match(legalDraftPropositionsMarkdown, /Legal Draft Propositions/);
  const legalReuseLibrary = JSON.parse(await readFile(join(result.artifacts.verifyDir, "legal-reuse-library.json"), "utf8"));
  assert.equal(legalReuseLibrary.profile, "legal");
  assert.deepEqual(legalReuseLibrary.propositions, []);
  const legalReuseLibraryMarkdown = await readFile(join(result.artifacts.verifyDir, "legal-reuse-library.md"), "utf8");
  assert.match(legalReuseLibraryMarkdown, /Legal Reuse Library/);
  const reviewQueue = JSON.parse(await readFile(join(result.artifacts.verifyDir, "review-queue.json"), "utf8"));
  assert.equal(reviewQueue.profile, "legal");
  assert.ok(reviewQueue.legalSummary.treatmentNotCheckedCount >= 1);
  assert.ok(reviewQueue.items.some((item: { action?: string }) => item.action === "check_legal_treatment"));
  const reviewQueueMarkdown = await readFile(join(result.artifacts.verifyDir, "review-queue.md"), "utf8");
  assert.match(reviewQueueMarkdown, /Legal Summary/);
  assert.match(reviewQueueMarkdown, /Check legal treatment/);
  const legalExportReadme = await readFile(join(result.artifacts.exportDir, "README.md"), "utf8");
  assert.match(legalExportReadme, /Legal Final Export Receipt/);
  assert.match(legalExportReadme, /Status: refused/);
  assert.match(legalExportReadme, /01_source-packet\/legal-source-packet\.json/);
  assert.match(legalExportReadme, /03_verification\/legal-evidence-map\.json/);
  assert.match(legalExportReadme, /03_verification\/verification-findings\.json/);
  assert.match(legalExportReadme, /03_verification\/trust-report\.json/);
  const refusal = await readFile(join(result.artifacts.exportDir, "legal-export-refusal.md"), "utf8");
  assert.match(refusal, /Exact Unresolved Blockers/);
  assert.match(refusal, /Legal proposition has no source support/);
  await assert.rejects(readFile(join(result.artifacts.exportDir, "final-legal.md"), "utf8"));
});

test("legal final export writes markdown and receipt when gates are ready", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-legal-export-ready-"));
  const runId = "run_legal_export_ready";
  const sourceId = "src_case";
  const passageId = "passage_hawkins_p0002";
  const decisionId = "legal_review_decision_1234567890abcdef";
  const run = {
    id: runId,
    slug: "legal-export-ready-12345678",
    name: "legal-export-ready",
    artifactKind: "document" as const,
    profile: "legal" as const,
    status: "export_ready" as const,
    inputPaths: [],
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z"
  };
  const source = {
    id: sourceId,
    runId,
    name: "hawkins-case.md",
    path: join(baseDir, "hawkins-case.md"),
    fileType: "md",
    status: "current" as const,
    intendedUse: "Legal authority."
  };
  const legalSource = {
    id: "legal_src_case",
    runId,
    sourceId,
    sourceKind: "case" as const,
    title: "hawkins-case.md",
    citationText: "Hawkins v. McGee, 84 N.H. 114",
    authorityLevel: "binding" as const,
    sourceStatus: "current" as const,
    treatmentStatus: "checked_current" as const,
    extractionStatus: "extracted" as const,
    reviewStatus: "verified" as const
  };
  const passage = {
    id: "legal_passage_hawkins_p0002",
    runId,
    sourceId,
    passageId,
    locationKind: "paragraph" as const,
    paragraphNumber: 2,
    pinpoint: "para. 2",
    quote: "A promise may create a warranty.",
    quoteHash: "quotehash",
    extractionStatus: "extracted" as const
  };
  const proposition = {
    id: "legal_map_prop_hawkins_rule",
    runId,
    artifactLocation: "legal-memo:Rules",
    propositionType: "rule" as const,
    text: "A promise may create a warranty.",
    sourceIds: [sourceId],
    passageIds: [passageId],
    pinCites: ["para. 2"],
    assumptions: [],
    authorityLevelRequired: "binding" as const,
    reviewStatus: "verified" as const
  };
  const findings = [
    {
      id: "finding_accepted",
      runId,
      location: "legal-memo:Rules",
      issue: "Binding-law proposition lacks binding authority support.",
      category: "authority_level_mismatch",
      severity: "polish" as const,
      evidence: `Accepted legal risk by ${decisionId}. Reason: Fixture review.`,
      recommendedRepair: `Accepted or carried by legal review decision ${decisionId}.`,
      humanReviewRequired: false
    }
  ];
  const artifacts = await writeRunArtifacts({
    baseDir,
    run,
    sources: [source],
    inspections: [
      {
        id: "inspect_case",
        runId,
        sourceId,
        name: source.name,
        path: source.path,
        fileType: "md",
        parser: "markdown-text-v1",
        status: "inspected" as const,
        sizeBytes: 100,
        sourceDateCandidates: [],
        ownerCandidates: [],
        structuredSummary: {},
        textPreview: "A promise may create a warranty.",
        warnings: []
      }
    ],
    conflicts: [],
    spec: {
      id: "spec_legal_export",
      runId,
      artifactKind: "document",
      audience: "Reviewer.",
      decisionContext: "Legal memo.",
      narrativeSpine: "Review a supported legal memo.",
      structure: ["Rules"],
      requiredChecks: ["Legal source support"],
      reviewRules: ["Do not treat as legal advice."]
    },
    findings,
    trustReport: {
      id: "trust_ready",
      runId,
      readiness: "ready",
      summary: {
        sourceCount: 1,
        claimCount: 0,
        calculationCount: 0,
        assumptionCount: 0,
        findingCount: findings.length,
        blockingCount: 0,
        needsReviewCount: 0
      },
      blockingIssues: [],
      warnings: []
    },
    legalSourcePacket: {
      runId,
      profile: "legal",
      sources: [legalSource],
      passages: [passage]
    },
    legalOutputSpec: {
      id: "legal_output_spec_ready",
      runId,
      outputKind: "legal_memo",
      audience: "Human legal reviewer.",
      assignmentOrUseCase: "Reviewable legal memo.",
      jurisdiction: "New Hampshire",
      questionPresented: "Can a promise create a warranty?",
      requiredSections: ["Question Presented", "Rules"],
      citationStyle: "plain",
      allowedSourceScope: "provided_packet_only",
      reviewRules: ["Treat as a reliability artifact, not legal advice."]
    },
    legalEvidenceMap: {
      id: "legal_evidence_map_ready",
      runId,
      profile: "legal",
      artifactKind: "document",
      propositions: [proposition],
      summary: {
        propositionCount: 1,
        mappedPropositionCount: 1,
        unsupportedPropositionCount: 0,
        passageSupportedPropositionCount: 1
      },
      notes: []
    },
    legalDraftPropositions: [],
    legalReviewDecisionSet: {
      runId,
      profile: "legal",
      decisions: [
        {
          id: decisionId,
          runId,
          action: "accept_legal_risk",
          location: "legal-memo:Rules",
          issue: "Binding-law proposition lacks binding authority support.",
          category: "authority_level_mismatch",
          reason: "Fixture review accepted the carried risk.",
          reviewer: "fixture-reviewer",
          createdAt: "2026-07-05T00:00:00.000Z",
          approvalTokenAccepted: true
        }
      ],
      auditEvents: [
        {
          id: "legal_review_audit_1234567890abcdef",
          runId,
          decisionId,
          action: "accept_legal_risk",
          actor: "fixture-reviewer",
          createdAt: "2026-07-05T00:00:00.000Z",
          summary: "Accepted fixture risk.",
          before: {},
          after: {}
        }
      ]
    }
  });

  const finalMarkdown = await readFile(join(artifacts.exportDir, "final-legal.md"), "utf8");
  assert.match(finalMarkdown, /legal-export-ready Legal Memo/);
  assert.match(finalMarkdown, /A promise may create a warranty\. \(Hawkins v\. McGee, 84 N\.H\. 114; para\. 2\)/);
  assert.match(finalMarkdown, /not legal advice/);
  const readme = await readFile(join(artifacts.exportDir, "README.md"), "utf8");
  assert.match(readme, /Legal Final Export Receipt/);
  assert.match(readme, /Status: export_ready/);
  assert.match(readme, /04_export\/final-legal\.md/);
  assert.match(readme, /01_source-packet\/legal-source-packet\.json/);
  assert.match(readme, /03_verification\/legal-evidence-map\.json/);
  assert.match(readme, /03_verification\/verification-findings\.json/);
  assert.match(readme, /03_verification\/trust-report\.json/);
  assert.match(readme, /Review audit: `03_verification\/legal-review-decisions\.json`/);
  assert.match(readme, /Accepted Risks/);
  assert.match(readme, new RegExp(decisionId));
  assert.match(readme, /Unresolved Legal Risks\n\n- None/);
  await assert.rejects(readFile(join(artifacts.exportDir, "legal-export-refusal.md"), "utf8"));
});

test("failed durable workflow runs are not left running", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-failed-"));
  const storePath = join(baseDir, "deliverables", "evidence-map-store.json");

  await assert.rejects(
    runEvidenceMapWorkflow(new JsonFileEvidenceMapStore(storePath), {
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

test("workflow rejects symlink source targets outside baseDir before import", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-workflow-symlink-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "evidence-map-workflow-outside-"));
  const inputDir = join(baseDir, "input", "linked-source");
  await mkdir(inputDir, { recursive: true });
  const outsideSource = join(outsideDir, "private-source.md");
  await writeFile(outsideSource, "# Private Source\n\nsecret outside content\n");
  await symlink(outsideSource, join(inputDir, "linked-private.md"));

  await assert.rejects(
    runEvidenceMapWorkflow(new MemoryEvidenceMapStore(), {
      baseDir,
      name: "linked-source",
      artifactKind: "document",
      inputPaths: ["input/linked-source"],
      generate: true
    }),
    /real path escapes baseDir|escapes baseDir/
  );
});

test("verify command recomputes findings without duplicating old ones", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-verify-"));
  const inputDir = join(baseDir, "input", "sample-project");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "2026-05-01-raw-export.csv"), "metric,value\nrevenue,100\n");
  const storePath = join(baseDir, "deliverables", "evidence-map-store.json");
  const result = await runEvidenceMapWorkflow(new JsonFileEvidenceMapStore(storePath), {
    baseDir,
    name: "sample-project",
    artifactKind: "deck",
    inputPaths: ["input/sample-project"]
  });
  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));

  const compactVerify = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--base-dir",
    baseDir,
    "--run",
    `deliverables/${result.run.slug}`
  ]);
  assert.match(compactVerify.stdout, /Review queue:/);
  assert.match(compactVerify.stdout, /Use --json to print the full trust report JSON/);
  const jsonVerify = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--base-dir",
    baseDir,
    "--run",
    `deliverables/${result.run.slug}`,
    "--json"
  ]);
  assert.equal(JSON.parse(jsonVerify.stdout).readiness, "blocked");

  const data = JSON.parse(await readFile(storePath, "utf8"));
  const findingsForRun = data.findings.filter((finding: { runId: string }) => finding.runId === result.run.id);
  const report = JSON.parse(await readFile(join(result.artifacts.verifyDir, "trust-report.json"), "utf8"));
  const reviewQueue = JSON.parse(await readFile(join(result.artifacts.verifyDir, "review-queue.json"), "utf8"));
  assert.equal(findingsForRun.length, result.findings.length);
  assert.equal(report.readiness, "blocked");
  assert.equal(reviewQueue.readiness, "blocked");
});

test("source-prep source date decision removes the matching date blocker", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-source-date-decision-"));
  const inputDir = join(baseDir, "input", "undated-source");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "current-metrics.csv"), "metric,value\nrevenue,100\n");
  const storePath = join(baseDir, "deliverables", "evidence-map-store.json");
  const result = await runEvidenceMapWorkflow(new JsonFileEvidenceMapStore(storePath), {
    baseDir,
    name: "undated-source",
    artifactKind: "document",
    inputPaths: ["input/undated-source"]
  });
  const source = result.sources[0];
  assert.ok(source);
  assert.ok(result.findings.some((finding) => finding.issue === "Number-bearing source has no source date."));

  const decisionSet = await readSourcePrepReviewDecisionSet({ baseDir, run: result.run });
  const decisionResult = appendSetSourceDateDecision({
    decisionSet,
    sources: result.sources,
    sourceId: source.id,
    sourceDate: "2026-05-01",
    reason: "Reviewed source packet and confirmed the metrics are dated 2026-05-01.",
    reviewer: "fixture-reviewer",
    approvalToken: SOURCE_PREP_APPROVAL_TOKEN,
    now: "2026-07-06T00:00:00.000Z"
  });
  await writeFile(sourcePrepReviewDecisionSetPath(baseDir, result.run.slug), `${JSON.stringify(decisionResult.decisionSet, null, 2)}\n`);

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  const firstVerify = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--base-dir",
    baseDir,
    "--run",
    `deliverables/${result.run.slug}`
  ]);
  const secondVerify = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--base-dir",
    baseDir,
    "--run",
    `deliverables/${result.run.slug}`
  ]);
  assert.doesNotMatch(firstVerify.stdout, /add_source_date/);
  assert.doesNotMatch(secondVerify.stdout, /add_source_date/);

  const jsonVerify = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--base-dir",
    baseDir,
    "--run",
    `deliverables/${result.run.slug}`,
    "--json"
  ]);
  const trustReport = JSON.parse(jsonVerify.stdout);
  assert.equal(trustReport.readiness, "blocked");

  const reviewQueue = JSON.parse(await readFile(join(result.artifacts.verifyDir, "review-queue.json"), "utf8"));
  assert.equal(reviewQueue.sourcePrepSummary.sourceDateDecisionCount, 1);
  assert.ok(!reviewQueue.items.some((item: { action?: string }) => item.action === "add_source_date"));
  const sourceInventory = JSON.parse(await readFile(join(result.artifacts.sourceDir, "source-inventory.json"), "utf8"));
  assert.equal(sourceInventory[0]?.sourceDate, "2026-05-01");
  const data = JSON.parse(await readFile(storePath, "utf8"));
  const findingsForRun = data.findings.filter((finding: { runId: string }) => finding.runId === result.run.id);
  assert.equal(findingsForRun.length, trustReport.summary.findingCount);
});

test("source-prep OCR decision is audited without marking extraction inspected", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "evidence-map-ocr-decision-"));
  const storePath = join(baseDir, "deliverables", "evidence-map-store.json");
  const store = new JsonFileEvidenceMapStore(storePath);
  const run = await store.createRun({
    name: "ocr-decision",
    artifactKind: "document",
    profile: "general",
    inputPaths: []
  });
  const sourcePath = join(baseDir, "input", "scanned-invoice.pdf");
  const [source] = await store.createSources(run.id, [
    {
      name: "scanned-invoice.pdf",
      path: sourcePath,
      fileType: "pdf",
      status: "current",
      intendedUse: "Scanned invoice source."
    }
  ]);
  assert.ok(source);
  const [inspection] = await store.createFileInspections(run.id, [
    {
      sourceId: source.id,
      name: source.name,
      path: source.path,
      fileType: "pdf",
      parser: "pdf-text-v1",
      status: "metadata_only",
      sizeBytes: 100,
      sourceDateCandidates: [],
      ownerCandidates: [],
      structuredSummary: {
        pdfSignature: true,
        pageCount: 1,
        extractablePageCount: 0,
        paragraphCount: 0,
        numberCandidateCount: 0
      },
      warnings: ["PDF parser did not return extractable text."]
    }
  ]);
  assert.ok(inspection);
  const spec = await store.createArtifactSpec({
    runId: run.id,
    artifactKind: "document",
    audience: "Reviewer.",
    decisionContext: "OCR decision fixture.",
    narrativeSpine: "Verify OCR source-prep decisions.",
    structure: ["Source packet"],
    requiredChecks: ["No-text PDFs stay blocked or review-routed."],
    reviewRules: ["Do not mark metadata-only PDFs as inspected without text."]
  });
  const findings = await store.createVerificationFindings(run.id, await buildHostileReviewFindings(store, run.id));
  const trustReport = await evaluateTrust(store, run.id);
  const updatedRun = await store.updateRunStatus(run.id, "waiting_for_review");
  const artifacts = await writeRunArtifacts({
    baseDir,
    run: updatedRun,
    sources: [source],
    inspections: [inspection],
    conflicts: [],
    spec,
    findings,
    trustReport
  });

  const decisionResult = appendMarkOcrRequiredDecision({
    decisionSet: emptySourcePrepReviewDecisionSet(run.id),
    sources: [source],
    inspections: [inspection],
    sourceId: source.id,
    reviewPath: "manual_review_required",
    reason: "PDF has no extractable text; route to manual OCR review before reliance.",
    reviewer: "fixture-reviewer",
    approvalToken: SOURCE_PREP_APPROVAL_TOKEN,
    now: "2026-07-06T00:00:00.000Z"
  });
  await writeFile(sourcePrepReviewDecisionSetPath(baseDir, updatedRun.slug), `${JSON.stringify(decisionResult.decisionSet, null, 2)}\n`);

  const scriptPath = fileURLToPath(new URL("../scripts/verify.ts", import.meta.url));
  await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--base-dir",
    baseDir,
    "--run",
    `deliverables/${updatedRun.slug}`
  ]);

  const reviewQueue = JSON.parse(await readFile(join(artifacts.verifyDir, "review-queue.json"), "utf8"));
  assert.equal(reviewQueue.sourcePrepSummary.ocrDecisionCount, 1);
  assert.ok(reviewQueue.items.some((item: { action?: string }) => item.action === "ocr_or_replace_pdf"));
  const sourcePrepDecisions = JSON.parse(await readFile(join(artifacts.verifyDir, "source-prep-decisions.json"), "utf8"));
  assert.equal(sourcePrepDecisions.auditEvents.length, 1);
  assert.equal(sourcePrepDecisions.decisions[0]?.action, "mark_ocr_required");
  const fileInspections = JSON.parse(await readFile(join(artifacts.sourceDir, "file-inspections.json"), "utf8"));
  assert.equal(fileInspections[0]?.status, "metadata_only");
  assert.match(fileInspections[0]?.warnings.join(" "), /manual OCR review required/);
});

test("run command rejects invalid artifact kinds", async () => {
  const scriptPath = fileURLToPath(new URL("../scripts/run.ts", import.meta.url));

  await assert.rejects(
    execFileAsync(process.execPath, [
      "--experimental-strip-types",
      scriptPath,
      "--kind",
      "banana",
      "--input",
      "input/examples/capstone-report"
    ]),
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, 1);
      const stderr = String((error as { stderr?: string }).stderr);
      assert.match(stderr, /Invalid --kind: banana/);
      assert.match(stderr, /Valid kinds: deck, workbook, document, report, mixed/);
      return true;
    }
  );
});

test("run command rejects invalid workflow profiles", async () => {
  const scriptPath = fileURLToPath(new URL("../scripts/run.ts", import.meta.url));

  await assert.rejects(
    execFileAsync(process.execPath, [
      "--experimental-strip-types",
      scriptPath,
      "--profile",
      "banana",
      "--input",
      "input/examples/capstone-report"
    ]),
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, 1);
      const stderr = String((error as { stderr?: string }).stderr);
      assert.match(stderr, /Invalid --profile: banana/);
      assert.match(stderr, /Valid profiles: general, legal/);
      return true;
    }
  );
});

async function writeWorkflowPptx(path: string) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>Q2 Enrollment Review</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody><a:p><a:r><a:t>Revenue increased to 42 in the pilot cohort.</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Owner: Research Team.</a:t></a:r></a:p>
    <a:p><a:r><a:t>Use the 2026-05-01 source packet for support.</a:t></a:r></a:p>
    <a:p><a:r><a:t>Customer churn declined by 12% after onboarding changes.</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`
  );
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

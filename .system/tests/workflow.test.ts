import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { writeRunArtifacts } from "../src/artifacts/write.ts";
import { runEvidenceMapWorkflow } from "../src/chains/evidence-map/workflow.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { MemoryEvidenceMapStore } from "../src/db/memory-store.ts";

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
  const legalOutputSpec = JSON.parse(await readFile(join(result.artifacts.specDir, "legal-output-spec.json"), "utf8"));
  assert.equal(legalOutputSpec.allowedSourceScope, "provided_packet_only");
  const legalOutputSpecMarkdown = await readFile(join(result.artifacts.specDir, "legal-output-spec.md"), "utf8");
  assert.match(legalOutputSpecMarkdown, /Legal Output Spec/);
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

  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${result.run.slug}`]);
  await execFileAsync(process.execPath, ["--experimental-strip-types", scriptPath, "--base-dir", baseDir, "--run", `deliverables/${result.run.slug}`]);

  const data = JSON.parse(await readFile(storePath, "utf8"));
  const findingsForRun = data.findings.filter((finding: { runId: string }) => finding.runId === result.run.id);
  const report = JSON.parse(await readFile(join(result.artifacts.verifyDir, "trust-report.json"), "utf8"));
  assert.equal(findingsForRun.length, result.findings.length);
  assert.equal(report.readiness, "blocked");
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

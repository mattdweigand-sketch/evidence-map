import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceMapStore } from "../src/db/memory-store.ts";
import { buildHostileReviewFindings } from "../src/verify/hostile-review.ts";

test("hostile review flags unsupported and estimated assumptions", async () => {
  const store = new MemoryEvidenceMapStore();
  const run = await store.createRun({
    name: "assumption review",
    artifactKind: "document",
    inputPaths: []
  });
  await store.createAssumptions(run.id, [
    {
      name: "market adoption",
      value: "80%",
      sourceIds: [],
      status: "unsupported"
    },
    {
      name: "launch timing",
      value: "Q4",
      sourceIds: [],
      owner: "Program lead",
      status: "estimate"
    }
  ]);

  const findings = await buildHostileReviewFindings(store, run.id);

  assert.ok(
    findings.some(
      (finding) =>
        finding.location === "assumption:market adoption" &&
        finding.issue === "Assumption is not decision-ready." &&
        finding.severity === "must_fix"
    )
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.location === "assumption:market adoption" &&
        finding.issue === "High-risk assumption lacks an owner." &&
        finding.severity === "must_fix"
    )
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.location === "assumption:launch timing" &&
        finding.issue === "Assumption is an estimate." &&
        finding.severity === "should_fix"
    )
  );
  assert.equal(findings.some((finding) => finding.location === "assumption:launch timing" && finding.issue === "High-risk assumption lacks an owner."), false);
});

test("hostile review flags stale-source claims and undated number-bearing claim sources", async () => {
  const store = new MemoryEvidenceMapStore();
  const run = await store.createRun({
    name: "claim review",
    artifactKind: "document",
    inputPaths: []
  });
  const [supersededSource, undatedNumberSource] = await store.createSources(run.id, [
    {
      name: "old-program-status.csv",
      path: "/tmp/old-program-status.csv",
      fileType: "csv",
      status: "superseded",
      sourceDate: "2026-04-01",
      intendedUse: "Prior status reference."
    },
    {
      name: "enrollment-export.csv",
      path: "/tmp/enrollment-export.csv",
      fileType: "csv",
      status: "current",
      intendedUse: "Enrollment figures."
    }
  ]);
  assert.ok(supersededSource);
  assert.ok(undatedNumberSource);

  await store.createFileInspections(run.id, [
    {
      sourceId: supersededSource.id,
      name: supersededSource.name,
      path: supersededSource.path,
      fileType: supersededSource.fileType,
      parser: "delimited-text-v1",
      status: "inspected",
      sizeBytes: 10,
      sourceDateCandidates: [],
      ownerCandidates: [],
      structuredSummary: {},
      warnings: []
    },
    {
      sourceId: undatedNumberSource.id,
      name: undatedNumberSource.name,
      path: undatedNumberSource.path,
      fileType: undatedNumberSource.fileType,
      parser: "delimited-text-v1",
      status: "inspected",
      sizeBytes: 10,
      sourceDateCandidates: [],
      ownerCandidates: [],
      structuredSummary: { numberCandidateCount: 3 },
      warnings: []
    }
  ]);
  await store.createClaims(run.id, [
    {
      artifactLocation: "slide 2",
      claim: "The old program status is still current.",
      sourceIds: [supersededSource.id],
      assumptions: [],
      reviewStatus: "unreviewed"
    },
    {
      artifactLocation: "slide 3",
      claim: "Enrollment reached 1,200.",
      sourceIds: [undatedNumberSource.id],
      assumptions: [],
      reviewStatus: "unreviewed"
    }
  ]);

  const findings = await buildHostileReviewFindings(store, run.id);

  assert.ok(
    findings.some(
      (finding) =>
        finding.location === "slide 2" &&
        finding.issue === "Claim relies on a stale or background-only source." &&
        finding.severity === "should_fix"
    )
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.location === "slide 3" &&
        finding.issue === "Claim uses numbers without a source date." &&
        finding.severity === "must_fix"
    )
  );
});

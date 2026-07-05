import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildLegalSourcePacket } from "../src/legal/source-packet.ts";
import { buildLegalTrustFindings } from "../src/legal/trust.ts";
import type { FileInspectionRecord, SourceRecord } from "../src/types.ts";
import type { LegalPropositionRecord, LegalSourceRecord } from "../src/legal/types.ts";

test("legal source packet extracts stable md passages with quote hashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-passages-"));
  const path = join(dir, "case-excerpt.md");
  await writeFile(path, "# Hawkins v. McGee\n\nA warranty can be created by a promise.\n\nDamages may use expectation value.\n");

  const first = await buildLegalSourcePacket({
    runId: "run_1",
    sources: [makeGenericSource({ id: "src_first", path })],
    inspections: [makeInspection({ runId: "run_1", sourceId: "src_first", path })]
  });
  const second = await buildLegalSourcePacket({
    runId: "run_2",
    sources: [makeGenericSource({ id: "src_second", runId: "run_2", path })],
    inspections: [makeInspection({ runId: "run_2", sourceId: "src_second", path })]
  });

  assert.equal(first.passages.length, 3);
  assert.equal(first.passages[1]?.passageId, "passage_case-excerpt_p0002");
  assert.equal(first.passages[1]?.pinpoint, "para. 2");
  assert.ok(first.passages[1]?.quoteHash);
  assert.deepEqual(
    first.passages.map((passage) => passage.passageId),
    second.passages.map((passage) => passage.passageId)
  );
});

test("legal trust blocks propositions with no source support", () => {
  const proposition = makeProposition({
    sourceIds: [],
    passageIds: [],
    pinCites: []
  });

  const findings = buildLegalTrustFindings({
    legalSources: [],
    passages: [],
    propositions: [proposition]
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Legal proposition has no source support." &&
        finding.severity === "must_fix" &&
        finding.category === "missing_authority"
    )
  );
});

test("legal trust blocks metadata-only source support", () => {
  const source = makeSource({
    sourceKind: "case",
    authorityLevel: "binding",
    extractionStatus: "metadata_only",
    treatmentStatus: "checked_current"
  });
  const proposition = makeProposition({
    sourceIds: [source.sourceId],
    passageIds: [],
    pinCites: ["p. 12"]
  });

  const findings = buildLegalTrustFindings({
    legalSources: [source],
    passages: [],
    propositions: [proposition]
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Metadata-only legal source cannot support final-ready legal work." &&
        finding.severity === "must_fix"
    )
  );
});

test("legal trust blocks secondary-only binding-law propositions", () => {
  const source = makeSource({
    sourceKind: "secondary",
    authorityLevel: "secondary",
    treatmentStatus: "checked_current"
  });
  const proposition = makeProposition({
    sourceIds: [source.sourceId],
    passageIds: [],
    pinCites: ["section 1"]
  });

  const findings = buildLegalTrustFindings({
    legalSources: [source],
    passages: [],
    propositions: [proposition]
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Binding-law proposition relies only on secondary authority." &&
        finding.severity === "must_fix" &&
        finding.category === "secondary_only_rule"
    )
  );
});

test("legal trust requires review for unknown authority and unchecked treatment", () => {
  const source = makeSource({
    authorityLevel: "unknown",
    treatmentStatus: "not_checked"
  });

  const findings = buildLegalTrustFindings({
    legalSources: [source],
    passages: [],
    propositions: []
  });

  assert.ok(findings.some((finding) => finding.issue === "Legal source authority level requires review." && finding.severity === "should_fix"));
  assert.ok(findings.some((finding) => finding.issue === "Legal source treatment has not been checked." && finding.severity === "should_fix"));
});

test("legal trust blocks quote drift against referenced passage hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-quote-"));
  const path = join(dir, "quote-case.md");
  await writeFile(path, "The court held that the promise created a warranty.\n");
  const packet = await buildLegalSourcePacket({
    runId: "run_1",
    sources: [makeGenericSource({ id: "src_1", path })],
    inspections: [makeInspection({ sourceId: "src_1", path })]
  });
  const passage = packet.passages[0];
  assert.ok(passage);
  const proposition = makeProposition({
    propositionType: "quote",
    text: "The court held that the promise did not create a warranty.",
    sourceIds: [passage.sourceId],
    passageIds: [passage.passageId],
    pinCites: [passage.pinpoint ?? "para. 1"],
    authorityLevelRequired: "persuasive_ok"
  });

  const findings = buildLegalTrustFindings({
    legalSources: [
      makeSource({
        sourceId: passage.sourceId,
        treatmentStatus: "checked_current"
      })
    ],
    passages: packet.passages,
    propositions: [proposition]
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Quoted legal proposition does not match referenced passage text." &&
        finding.severity === "must_fix" &&
        finding.category === "quote_drift"
    )
  );
});

function makeGenericSource(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: "src_1",
    runId: "run_1",
    name: "case-excerpt.md",
    path: "/tmp/case-excerpt.md",
    fileType: "md",
    status: "unclear",
    intendedUse: "Legal fixture.",
    ...overrides
  };
}

function makeInspection(overrides: Partial<FileInspectionRecord> = {}): FileInspectionRecord {
  return {
    id: "inspect_1",
    runId: "run_1",
    sourceId: "src_1",
    name: "case-excerpt.md",
    path: "/tmp/case-excerpt.md",
    fileType: "md",
    parser: "markdown-text-v1",
    status: "inspected",
    sizeBytes: 100,
    sourceDateCandidates: [],
    ownerCandidates: [],
    structuredSummary: {},
    textPreview: "fixture",
    warnings: [],
    ...overrides
  };
}

function makeSource(overrides: Partial<LegalSourceRecord> = {}): LegalSourceRecord {
  return {
    id: "legal_src_1",
    runId: "run_1",
    sourceId: "src_1",
    sourceKind: "case",
    title: "Fixture Source",
    authorityLevel: "persuasive",
    sourceStatus: "unknown",
    treatmentStatus: "not_checked",
    extractionStatus: "extracted",
    reviewStatus: "unreviewed",
    ...overrides
  };
}

function makeProposition(overrides: Partial<LegalPropositionRecord> = {}): LegalPropositionRecord {
  return {
    id: "legal_prop_1",
    runId: "run_1",
    artifactLocation: "legal-section-map",
    propositionType: "rule",
    text: "A duty rule applies.",
    sourceIds: ["src_1"],
    passageIds: [],
    pinCites: ["p. 1"],
    assumptions: [],
    authorityLevelRequired: "binding",
    reviewStatus: "unreviewed",
    ...overrides
  };
}

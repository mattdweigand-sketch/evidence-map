import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { extractLegalPropositionIntake } from "../src/legal/draft.ts";
import { buildLegalEvidenceMap } from "../src/legal/evidence-map.ts";
import { buildLegalReuseFindings, buildLegalReuseLibrary } from "../src/legal/reuse-library.ts";
import { buildLegalSourcePacket } from "../src/legal/source-packet.ts";
import { buildLegalOutputSpec } from "../src/legal/spec.ts";
import { buildLegalDraftDisciplineFindings, buildLegalTrustFindings } from "../src/legal/trust.ts";
import type { EvidenceMapRun, FileInspectionRecord, SourceRecord } from "../src/types.ts";
import type { LegalOutputSpec, LegalPassageRecord, LegalPropositionRecord, LegalSourceRecord } from "../src/legal/types.ts";

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

test("legal evidence map records first-class legal proposition fields", () => {
  const source = makeSource({
    sourceId: "src_case",
    sourceKind: "case",
    authorityLevel: "binding",
    treatmentStatus: "checked_current"
  });
  const proposition = makeProposition({
    id: "legal_prop_rule_1",
    sourceIds: [source.sourceId],
    passageIds: ["passage_case_p0001"],
    pinCites: ["p. 1"],
    reviewStatus: "verified"
  });

  const map = buildLegalEvidenceMap({
    runId: "run_1",
    artifactKind: "document",
    legalSources: [source],
    passages: [
      {
        id: "legal_passage_case_p0001",
        runId: "run_1",
        sourceId: source.sourceId,
        passageId: "passage_case_p0001",
        locationKind: "paragraph",
        paragraphNumber: 1,
        pinpoint: "para. 1",
        quote: "A duty rule applies.",
        quoteHash: "hash",
        extractionStatus: "extracted"
      }
    ],
    propositions: [proposition]
  });

  assert.equal(map.profile, "legal");
  assert.equal(map.summary.propositionCount, 1);
  assert.equal(map.summary.mappedPropositionCount, 1);
  assert.equal(map.summary.passageSupportedPropositionCount, 1);
  assert.equal(map.summary.unsupportedPropositionCount, 0);
  assert.equal(map.propositions[0]?.propositionType, "rule");
  assert.deepEqual(map.propositions[0]?.sourceIds, ["src_case"]);
  assert.deepEqual(map.propositions[0]?.passageIds, ["passage_case_p0001"]);
  assert.equal(map.propositions[0]?.authorityLevelRequired, "binding");
  assert.equal(map.propositions[0]?.reviewStatus, "verified");
});

test("legal reuse library records source versions and reviewed propositions", async () => {
  const fixture = await makeReuseFixture({ runId: "run_reuse_ready", courseOrMatter: "Contracts I" });

  assert.equal(fixture.library.boundary.courseOrMatter, "Contracts I");
  assert.match(fixture.library.boundary.boundaryKey, /^legal_boundary_[a-f0-9]{16}$/);
  assert.equal(fixture.library.sourceVersions.length, 1);
  assert.ok(fixture.library.sourceVersions[0]?.sourceHash);
  assert.equal(fixture.library.sourceVersions[0]?.passageQuoteHashes.length, 1);
  assert.equal(fixture.library.propositions.length, 1);
  assert.equal(fixture.library.propositions[0]?.text, "A promise may create a warranty.");
  assert.equal(fixture.library.propositions[0]?.sourceVersionKeys.length, 1);
});

test("legal reuse library imports supplied reuse library artifacts", async () => {
  const prior = await makeReuseFixture({ runId: "run_reuse_import_prior", courseOrMatter: "Contracts I" });
  const current = await makeReuseFixture({ runId: "run_reuse_import_current", courseOrMatter: "Contracts I" });
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-reuse-import-"));
  const libraryPath = join(dir, "prior-legal-reuse-library.json");
  await writeFile(libraryPath, `${JSON.stringify(prior.library, null, 2)}\n`);
  const importedLibrarySource = makeGenericSource({
    id: "src_imported_library",
    runId: current.run.id,
    name: "prior-legal-reuse-library.json",
    path: libraryPath,
    fileType: "json"
  });

  const library = await buildLegalReuseLibrary({
    run: current.run,
    sources: [current.source, importedLibrarySource],
    legalSourcePacket: {
      runId: current.run.id,
      profile: "legal",
      sources: [current.legalSource],
      passages: [current.passage]
    },
    legalOutputSpec: current.spec,
    legalEvidenceMap: current.map
  });

  assert.equal(library.importedLibraries.length, 1);
  assert.equal(library.importedLibraries[0]?.boundary.boundaryKey, prior.library.boundary.boundaryKey);
  assert.equal(library.importedLibraries[0]?.propositions.length, 1);
});

test("legal reuse allows prior reviewed propositions inside the same boundary", async () => {
  const prior = await makeReuseFixture({ runId: "run_reuse_prior", courseOrMatter: "Contracts I" });
  const current = await makeReuseFixture({ runId: "run_reuse_current", courseOrMatter: "Contracts I" });
  const findings = buildLegalReuseFindings({
    legalReuseLibrary: withImportedLibrary(current.library, prior.library),
    legalEvidenceMap: current.map
  });

  assert.equal(findings.length, 0);
});

test("legal reuse blocks cross-boundary proposition reuse without approval", async () => {
  const prior = await makeReuseFixture({ runId: "run_reuse_contracts", courseOrMatter: "Contracts I" });
  const current = await makeReuseFixture({ runId: "run_reuse_torts", courseOrMatter: "Torts I" });
  const findings = buildLegalReuseFindings({
    legalReuseLibrary: withImportedLibrary(current.library, prior.library),
    legalEvidenceMap: current.map
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Reused legal proposition crosses matter/course boundary without approval." &&
        finding.category === "assignment_scope_violation" &&
        finding.severity === "must_fix"
    )
  );
});

test("legal reuse requires review for stale or unchecked reused authority", async () => {
  const prior = await makeReuseFixture({
    runId: "run_reuse_unchecked_prior",
    courseOrMatter: "Contracts I",
    treatmentStatus: "not_checked"
  });
  const current = await makeReuseFixture({ runId: "run_reuse_unchecked_current", courseOrMatter: "Contracts I" });
  const findings = buildLegalReuseFindings({
    legalReuseLibrary: withImportedLibrary(current.library, prior.library),
    legalEvidenceMap: current.map
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Reused legal authority requires current treatment review." &&
        finding.category === "negative_treatment_not_checked" &&
        finding.severity === "should_fix"
    )
  );
});

test("legal output spec detects supported legal output kinds", () => {
  const cases: Array<{ name: string; expected: string }> = [
    { name: "case brief assignment.md", expected: "case_brief" },
    { name: "legal memo draft.md", expected: "legal_memo" },
    { name: "rule synthesis prompt.md", expected: "rule_synthesis" },
    { name: "issue outline.md", expected: "issue_outline" },
    { name: "citation table.md", expected: "citation_table" }
  ];

  for (const item of cases) {
    const spec = buildLegalOutputSpec({
      runId: "run_1",
      name: item.name,
      artifactKind: "document",
      sources: [makeGenericSource({ name: item.name })],
      inspections: [makeInspection({ name: item.name, textPreview: item.name })]
    });
    assert.equal(spec.outputKind, item.expected);
    assert.equal(spec.allowedSourceScope, "provided_packet_only");
    assert.ok(spec.requiredSections.length > 0);
  }
});

test("legal source packet extracts stable docx passages with quote hashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-docx-"));
  const path = join(dir, "case-excerpt.docx");
  await writeFile(
    path,
    makeDocxBuffer(["Hawkins v. McGee", "A promise may create a warranty.", "Damages may use expectation value."])
  );

  const first = await buildLegalSourcePacket({
    runId: "run_1",
    sources: [makeGenericSource({ id: "src_first", name: "case-excerpt.docx", path, fileType: "docx" })],
    inspections: [
      makeInspection({
        runId: "run_1",
        sourceId: "src_first",
        name: "case-excerpt.docx",
        path,
        fileType: "docx",
        parser: "office-package-metadata-v1",
        status: "metadata_only"
      })
    ]
  });
  const second = await buildLegalSourcePacket({
    runId: "run_2",
    sources: [makeGenericSource({ id: "src_second", runId: "run_2", name: "case-excerpt.docx", path, fileType: "docx" })],
    inspections: [
      makeInspection({
        runId: "run_2",
        sourceId: "src_second",
        name: "case-excerpt.docx",
        path,
        fileType: "docx",
        parser: "office-package-metadata-v1",
        status: "metadata_only"
      })
    ]
  });

  assert.equal(first.passages.length, 3);
  assert.equal(first.passages[1]?.passageId, "passage_case-excerpt_p0002");
  assert.equal(first.passages[1]?.pinpoint, "para. 2");
  assert.ok(first.passages[1]?.quoteHash);
  assert.equal(first.sources[0]?.extractionStatus, "extracted");
  assert.deepEqual(
    first.passages.map((passage) => passage.passageId),
    second.passages.map((passage) => passage.passageId)
  );
});

test("legal draft proposition represented in evidence map passes draft discipline check", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-draft-mapped-"));
  const casePath = join(dir, "case-excerpt.md");
  const draftPath = join(dir, "legal-memo-draft.md");
  await writeFile(casePath, "# Hawkins v. McGee\n\nA promise may create a warranty.\n");
  await writeFile(
    draftPath,
    [
      "# Legal Memo Draft",
      "",
      "LEGAL-MAP [rule] source=case-excerpt.md passage=passage_case-excerpt_p0002 pin=\"para. 2\" authority=binding: A promise may create a warranty.",
      "LEGAL-DRAFT [rule]: A promise may create a warranty."
    ].join("\n")
  );
  const sources = [
    makeGenericSource({ id: "src_case", name: "case-excerpt.md", path: casePath }),
    makeGenericSource({ id: "src_draft", name: "legal-memo-draft.md", path: draftPath })
  ];
  const inspections = [
    makeInspection({ sourceId: "src_case", name: "case-excerpt.md", path: casePath }),
    makeInspection({ sourceId: "src_draft", name: "legal-memo-draft.md", path: draftPath, textPreview: "legal memo draft" })
  ];
  const intake = await extractLegalPropositionIntake({ runId: "run_1", sources, inspections });

  assert.equal(intake.evidenceMapPropositions.length, 1);
  assert.equal(intake.draftPropositions.length, 1);
  assert.deepEqual(intake.evidenceMapPropositions[0]?.sourceIds, ["src_case"]);
  assert.deepEqual(intake.evidenceMapPropositions[0]?.passageIds, ["passage_case-excerpt_p0002"]);

  const map = buildLegalEvidenceMap({
    runId: "run_1",
    artifactKind: "document",
    legalSources: [
      makeSource({
        sourceId: "src_case",
        authorityLevel: "binding",
        treatmentStatus: "checked_current"
      })
    ],
    passages: [],
    propositions: intake.evidenceMapPropositions
  });
  const findings = buildLegalDraftDisciplineFindings({
    legalEvidenceMap: map,
    draftPropositions: intake.draftPropositions
  });

  assert.equal(findings.length, 0);
});

test("legal draft discipline flags unmapped rule fact and conclusion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-draft-unmapped-"));
  const draftPath = join(dir, "legal-memo-draft.md");
  await writeFile(
    draftPath,
    [
      "# Legal Memo Draft",
      "",
      "LEGAL-DRAFT [rule]: A new duty rule appears only in the draft.",
      "LEGAL-DRAFT [record_fact]: The record shows a sudden stop.",
      "LEGAL-DRAFT [conclusion]: The defendant is liable."
    ].join("\n")
  );
  const sources = [makeGenericSource({ id: "src_draft", name: "legal-memo-draft.md", path: draftPath })];
  const inspections = [makeInspection({ sourceId: "src_draft", name: "legal-memo-draft.md", path: draftPath })];
  const intake = await extractLegalPropositionIntake({ runId: "run_1", sources, inspections });
  const map = buildLegalEvidenceMap({
    runId: "run_1",
    artifactKind: "document",
    legalSources: [],
    passages: [],
    propositions: [
      makeProposition({
        id: "legal_prop_other",
        text: "A different mapped proposition."
      })
    ]
  });
  const findings = buildLegalDraftDisciplineFindings({
    legalEvidenceMap: map,
    draftPropositions: intake.draftPropositions
  });

  assert.equal(findings.length, 3);
  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Draft legal proposition is not represented in the legal evidence map." &&
        finding.category === "model_knowledge_leak"
    )
  );
  assert.ok(findings.some((finding) => finding.category === "missing_pinpoint"));
  assert.ok(findings.some((finding) => finding.category === "conclusion_outpaces_support"));
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

test("legal trust flags failed docx extraction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-bad-docx-"));
  const path = join(dir, "bad-case.docx");
  await writeFile(path, "not a zip package");
  const packet = await buildLegalSourcePacket({
    runId: "run_1",
    sources: [makeGenericSource({ id: "src_1", name: "bad-case.docx", path, fileType: "docx" })],
    inspections: [
      makeInspection({
        sourceId: "src_1",
        name: "bad-case.docx",
        path,
        fileType: "docx",
        parser: "office-package-metadata-v1",
        status: "metadata_only"
      })
    ]
  });

  assert.equal(packet.sources[0]?.extractionStatus, "failed");
  assert.equal(packet.passages[0]?.extractionStatus, "failed");

  const findings = buildLegalTrustFindings({
    legalSources: packet.sources,
    passages: packet.passages,
    propositions: []
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Legal source text extraction failed." &&
        finding.severity === "must_fix" &&
        finding.category === "missing_pinpoint"
    )
  );
});

test("legal source packet extracts text-based pdf passages with page anchors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-pdf-"));
  const path = join(dir, "case-opinion.pdf");
  await writeFile(path, makePdfBuffer("The court held that a promise may create a warranty."));
  const packet = await buildLegalSourcePacket({
    runId: "run_1",
    sources: [makeGenericSource({ id: "src_1", name: "case-opinion.pdf", path, fileType: "pdf" })],
    inspections: [
      makeInspection({
        sourceId: "src_1",
        name: "case-opinion.pdf",
        path,
        fileType: "pdf",
        parser: "pdf-metadata-v1",
        status: "metadata_only",
        structuredSummary: { pdfSignature: true },
        warnings: ["Deep PDF text and table inspection is not implemented yet."]
      })
    ]
  });

  assert.equal(packet.sources[0]?.extractionStatus, "extracted");
  assert.equal(packet.passages.length, 1);
  assert.equal(packet.passages[0]?.passageId, "passage_case-opinion_pg0001_p0001");
  assert.equal(packet.passages[0]?.locationKind, "page");
  assert.equal(packet.passages[0]?.pageNumber, 1);
  assert.equal(packet.passages[0]?.pinpoint, "p. 1, para. 1");
  assert.ok(packet.passages[0]?.quoteHash);
});

test("legal trust flags failed pdf extraction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-map-legal-bad-pdf-"));
  const path = join(dir, "bad-opinion.pdf");
  await writeFile(path, "%PDF-1.4\nnot a parseable pdf\n%%EOF\n");
  const packet = await buildLegalSourcePacket({
    runId: "run_1",
    sources: [makeGenericSource({ id: "src_1", name: "bad-opinion.pdf", path, fileType: "pdf" })],
    inspections: [
      makeInspection({
        sourceId: "src_1",
        name: "bad-opinion.pdf",
        path,
        fileType: "pdf",
        parser: "pdf-metadata-v1",
        status: "metadata_only",
        structuredSummary: { pdfSignature: true },
        warnings: ["Deep PDF text and table inspection is not implemented yet."]
      })
    ]
  });

  assert.equal(packet.sources[0]?.extractionStatus, "failed");
  assert.equal(packet.passages[0]?.extractionStatus, "failed");

  const findings = buildLegalTrustFindings({
    legalSources: packet.sources,
    passages: packet.passages,
    propositions: []
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.issue === "Legal source text extraction failed." &&
        finding.severity === "must_fix" &&
        finding.category === "missing_pinpoint"
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

async function makeReuseFixture(overrides: {
  runId: string;
  courseOrMatter: string;
  treatmentStatus?: LegalSourceRecord["treatmentStatus"];
  sourceStatus?: LegalSourceRecord["sourceStatus"];
}) {
  const dir = await mkdtemp(join(tmpdir(), `evidence-map-${overrides.runId}-`));
  const runId = overrides.runId;
  const path = join(dir, "hawkins-case.md");
  await writeFile(path, "# Hawkins v. McGee\n\nA promise may create a warranty.\n");

  const run: EvidenceMapRun = {
    id: runId,
    slug: `${runId}-slug`,
    name: overrides.courseOrMatter.toLowerCase().replace(/\s+/g, "-"),
    artifactKind: "document",
    profile: "legal",
    status: "export_ready",
    inputPaths: [path],
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z"
  };
  const source = makeGenericSource({
    id: "src_hawkins",
    runId,
    name: "hawkins-case.md",
    path,
    status: "current",
    sourceDate: "2026-07-05"
  });
  const legalSource = makeSource({
    id: "legal_src_hawkins",
    runId,
    sourceId: source.id,
    title: source.name,
    citationText: "Hawkins v. McGee, 84 N.H. 114",
    authorityLevel: "binding",
    sourceStatus: overrides.sourceStatus ?? "current",
    treatmentStatus: overrides.treatmentStatus ?? "checked_current",
    reviewStatus: "verified"
  });
  const passage: LegalPassageRecord = {
    id: "legal_passage_hawkins_p0002",
    runId,
    sourceId: source.id,
    passageId: "passage_hawkins-case_p0002",
    locationKind: "paragraph",
    paragraphNumber: 2,
    pinpoint: "para. 2",
    quote: "A promise may create a warranty.",
    quoteHash: "hawkins_quote_hash",
    extractionStatus: "extracted"
  };
  const proposition = makeProposition({
    id: `legal_prop_${runId}`,
    runId,
    propositionType: "rule",
    text: "A promise may create a warranty.",
    sourceIds: [source.id],
    passageIds: [passage.passageId],
    pinCites: [passage.pinpoint ?? "para. 2"],
    authorityLevelRequired: "binding",
    reviewStatus: "verified"
  });
  const map = buildLegalEvidenceMap({
    runId,
    artifactKind: "document",
    legalSources: [legalSource],
    passages: [passage],
    propositions: [proposition]
  });
  const spec = makeLegalSpec({ runId, courseOrMatter: overrides.courseOrMatter });
  const library = await buildLegalReuseLibrary({
    run,
    sources: [source],
    legalSourcePacket: {
      runId,
      profile: "legal",
      sources: [legalSource],
      passages: [passage]
    },
    legalOutputSpec: spec,
    legalEvidenceMap: map
  });

  return { run, source, legalSource, passage, proposition, map, spec, library };
}

function withImportedLibrary(current: Awaited<ReturnType<typeof makeReuseFixture>>["library"], prior: Awaited<ReturnType<typeof makeReuseFixture>>["library"]) {
  return {
    ...current,
    importedLibraries: [
      {
        sourcePath: "/tmp/legal-reuse-library.json",
        id: prior.id,
        runId: prior.runId,
        boundary: prior.boundary,
        sourceVersions: prior.sourceVersions,
        propositions: prior.propositions
      }
    ]
  };
}

function makeLegalSpec(overrides: Partial<LegalOutputSpec> = {}): LegalOutputSpec {
  return {
    id: "legal_output_spec_1",
    runId: "run_1",
    outputKind: "legal_memo",
    audience: "Human legal reviewer.",
    assignmentOrUseCase: "Reviewable legal work product from the supplied packet.",
    jurisdiction: "New Hampshire",
    courseOrMatter: "Contracts I",
    questionPresented: "Can a promise create a warranty?",
    requiredSections: ["Question Presented", "Rules", "Analysis"],
    citationStyle: "plain",
    allowedSourceScope: "provided_packet_only",
    reviewRules: ["Treat this as a legal reliability artifact, not legal advice."],
    ...overrides
  };
}

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

function makeDocxBuffer(paragraphs: string[]) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`).join("\n")}
  </w:body>
</w:document>`;
  return makeZipBuffer([{ name: "word/document.xml", content: Buffer.from(documentXml, "utf8") }]);
}

function makeZipBuffer(entries: Array<{ name: string; content: Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce((total, part) => total + part.length, 0);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endOfCentralDirectory]);
}

function makePdfBuffer(text: string) {
  const contentStream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(contentStream)} >>\nstream\n${contentStream}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function escapePdfText(value: string) {
  return value.replace(/[\\()]/g, "\\$&");
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&apos;"
    };
    return entities[char] ?? char;
  });
}

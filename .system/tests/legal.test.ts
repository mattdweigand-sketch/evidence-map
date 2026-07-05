import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
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

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { EvidenceMapRun, SourceRecord } from "../types.ts";
import type { LegalSourcePacket } from "./source-packet.ts";
import type {
  LegalEvidenceMap,
  LegalFindingDraft,
  LegalImportedReuseLibrary,
  LegalMatterBoundary,
  LegalOutputSpec,
  LegalPassageRecord,
  LegalPropositionRecord,
  LegalReusablePropositionRecord,
  LegalReuseLibrary,
  LegalSourceRecord,
  LegalSourceVersionRecord
} from "./types.ts";

export async function buildLegalReuseLibrary(input: {
  run: EvidenceMapRun;
  sources: SourceRecord[];
  legalSourcePacket: LegalSourcePacket;
  legalOutputSpec: LegalOutputSpec;
  legalEvidenceMap: LegalEvidenceMap;
}): Promise<LegalReuseLibrary> {
  const boundary = buildLegalMatterBoundary({
    run: input.run,
    legalOutputSpec: input.legalOutputSpec
  });
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const passagesBySourceId = groupPassagesBySourceId(input.legalSourcePacket.passages);
  const sourceVersions = await Promise.all(
    input.legalSourcePacket.sources.map((source) =>
      buildSourceVersionRecord({
        runId: input.run.id,
        legalSource: source,
        source: sourceById.get(source.sourceId),
        passages: passagesBySourceId.get(source.sourceId) ?? []
      })
    )
  );
  const sourceVersionBySourceId = new Map(sourceVersions.map((sourceVersion) => [sourceVersion.sourceId, sourceVersion]));
  const passageById = new Map(input.legalSourcePacket.passages.map((passage) => [passage.passageId, passage]));
  const importedLibraries = await loadSuppliedLegalReuseLibraries(input.sources);

  return {
    id: `legal_reuse_library_${input.run.id}`,
    runId: input.run.id,
    profile: "legal",
    boundary,
    sourceVersions,
    propositions: input.legalEvidenceMap.propositions
      .filter(isReusableProposition)
      .map((proposition) =>
        toReusablePropositionRecord({
          runId: input.run.id,
          boundaryKey: boundary.boundaryKey,
          proposition,
          sourceVersionBySourceId,
          passageById
        })
      ),
    importedLibraries,
    notes: [
      "Phase 6A reuse is artifact-backed only; no Postgres or cross-run store schema is used.",
      "Reusable propositions are exported only when their legal evidence-map record is verified.",
      "Imported reusable propositions are checked against the current matter/course boundary before final readiness."
    ]
  };
}

export function buildLegalReuseFindings(input: {
  legalReuseLibrary: LegalReuseLibrary;
  legalEvidenceMap: LegalEvidenceMap;
}): LegalFindingDraft[] {
  const findings: LegalFindingDraft[] = [];
  const currentBoundary = input.legalReuseLibrary.boundary;
  const currentPropositionsByText = new Map<string, LegalPropositionRecord[]>();
  for (const proposition of input.legalEvidenceMap.propositions) {
    const key = normalizeText(proposition.text);
    currentPropositionsByText.set(key, [...(currentPropositionsByText.get(key) ?? []), proposition]);
  }

  for (const library of input.legalReuseLibrary.importedLibraries) {
    const sourceVersionByKey = new Map(library.sourceVersions.map((sourceVersion) => [sourceVersion.sourceVersionKey, sourceVersion]));
    for (const importedProposition of library.propositions) {
      const matchingCurrentPropositions = currentPropositionsByText.get(normalizeText(importedProposition.text)) ?? [];
      for (const currentProposition of matchingCurrentPropositions) {
        if (library.boundary.boundaryKey !== currentBoundary.boundaryKey) {
          findings.push(
            mustFix(
              `legal-reuse:${currentProposition.id}`,
              "Reused legal proposition crosses matter/course boundary without approval.",
              "assignment_scope_violation",
              `${currentProposition.text} came from boundary ${library.boundary.boundaryKey}; current boundary is ${currentBoundary.boundaryKey}.`,
              "Add an accepted legal risk decision for this reuse or replace the proposition with support from the current matter/course packet."
            )
          );
          continue;
        }

        const staleSources = importedProposition.sourceVersionKeys
          .map((sourceVersionKey) => sourceVersionByKey.get(sourceVersionKey))
          .filter((sourceVersion): sourceVersion is LegalSourceVersionRecord => Boolean(sourceVersion))
          .filter((sourceVersion) => sourceNeedsReuseReview(sourceVersion));
        if (staleSources.length > 0) {
          findings.push(
            shouldFix(
              `legal-reuse:${currentProposition.id}`,
              "Reused legal authority requires current treatment review.",
              "negative_treatment_not_checked",
              `${currentProposition.text} reuses ${staleSources
                .map((source) => `${source.title} (${source.treatmentStatus}/${source.sourceStatus})`)
                .join(", ")}.`,
              "Confirm currentness/treatment for the reused authority or carry the risk through an audited legal review decision."
            )
          );
        }
      }
    }
  }

  return findings;
}

export function renderLegalBoundary(boundary: LegalMatterBoundary) {
  return `# Legal Boundary

This artifact defines the local matter/course boundary for reusable legal propositions. It is a reliability artifact, not legal advice.

Boundary key: ${boundary.boundaryKey}

Course or matter: ${boundary.courseOrMatter ?? ""}

Jurisdiction: ${boundary.jurisdiction ?? ""}

Assignment or use case: ${boundary.assignmentOrUseCase}

Allowed source scope: ${boundary.allowedSourceScope}

Reuse policy: ${boundary.reusePolicy}

## Notes

${boundary.notes.map((note) => `- ${note}`).join("\n")}
`;
}

export function renderLegalSourceHistory(library: LegalReuseLibrary) {
  const rows = library.sourceVersions.length
    ? library.sourceVersions
        .map(
          (source) =>
            `| ${escapeCell(source.sourceId)} | ${escapeCell(source.title)} | ${source.sourceVersionKey} | ${source.sourceHash ?? ""} | ${source.sourceKind} | ${source.authorityLevel} | ${source.treatmentStatus} | ${source.reviewStatus} | ${source.passageQuoteHashes.length} |`
        )
        .join("\n")
    : "| none |  |  |  |  |  |  |  |  |";

  return `# Legal Source History

This artifact records local source/version fingerprints for legal reuse review. It is artifact-backed only.

| Source ID | Title | Version key | Source hash | Kind | Authority | Treatment | Review | Passage hashes |
|---|---|---|---|---|---|---|---|---|
${rows}
`;
}

export function renderLegalReuseLibrary(library: LegalReuseLibrary) {
  const propositionRows = library.propositions.length
    ? library.propositions
        .map(
          (proposition) =>
            `| ${escapeCell(proposition.propositionId)} | ${proposition.propositionType} | ${escapeCell(proposition.text)} | ${escapeCell(proposition.sourceVersionKeys.join(", "))} | ${escapeCell(proposition.pinCites.join(", "))} | ${proposition.reviewStatus} |`
        )
        .join("\n")
    : "| none |  |  |  |  |  |";
  const importedRows = library.importedLibraries.length
    ? library.importedLibraries
        .map(
          (item) =>
            `| ${escapeCell(item.sourcePath)} | ${item.boundary.boundaryKey} | ${escapeCell(item.boundary.courseOrMatter ?? "")} | ${item.propositions.length} | ${item.sourceVersions.length} |`
        )
        .join("\n")
    : "| none |  |  |  |  |";

  return `# Legal Reuse Library

This artifact exports reviewed legal propositions for local reuse review. It is a reliability artifact, not legal advice.

Boundary key: ${library.boundary.boundaryKey}

Reusable propositions: ${library.propositions.length}

Imported libraries: ${library.importedLibraries.length}

## Reusable Propositions

| Proposition ID | Type | Text | Source versions | Pin cites | Review |
|---|---|---|---|---|---|
${propositionRows}

## Imported Libraries

| Source path | Boundary key | Course or matter | Propositions | Source versions |
|---|---|---|---|---|
${importedRows}

## Notes

${library.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function buildLegalMatterBoundary(input: {
  run: EvidenceMapRun;
  legalOutputSpec: LegalOutputSpec;
}): LegalMatterBoundary {
  const courseOrMatter = input.legalOutputSpec.courseOrMatter;
  const jurisdiction = input.legalOutputSpec.jurisdiction;
  const boundaryBasis = [courseOrMatter ?? input.run.name, jurisdiction ?? "", input.legalOutputSpec.allowedSourceScope].join("|");

  return {
    id: `legal_boundary_${input.run.id}`,
    runId: input.run.id,
    profile: "legal",
    boundaryKey: `legal_boundary_${hashKey(normalizeText(boundaryBasis))}`,
    courseOrMatter,
    jurisdiction,
    assignmentOrUseCase: input.legalOutputSpec.assignmentOrUseCase,
    allowedSourceScope: input.legalOutputSpec.allowedSourceScope,
    reusePolicy: "same_boundary_only",
    notes: [
      "Legal reuse must stay inside this boundary unless an explicit legal review decision accepts the risk.",
      "The boundary key is derived from course/matter, jurisdiction, and allowed source scope."
    ]
  };
}

async function buildSourceVersionRecord(input: {
  runId: string;
  legalSource: LegalSourceRecord;
  source?: SourceRecord;
  passages: LegalPassageRecord[];
}): Promise<LegalSourceVersionRecord> {
  const sourceHash = input.source ? await fileHash(input.source.path) : undefined;
  const passageQuoteHashes = input.passages.map((passage) => passage.quoteHash).filter((quoteHash): quoteHash is string => Boolean(quoteHash));
  const sourceVersionKey = `legal_source_version_${hashKey(
    normalizeText([input.legalSource.title, input.legalSource.citationText ?? "", sourceHash ?? "", passageQuoteHashes.join(",")].join("|"))
  )}`;

  return {
    id: `legal_source_version_record_${hashKey(`${input.runId}|${input.legalSource.sourceId}|${sourceVersionKey}`)}`,
    runId: input.runId,
    sourceId: input.legalSource.sourceId,
    sourceVersionKey,
    title: input.legalSource.title,
    citationText: input.legalSource.citationText,
    jurisdiction: input.legalSource.jurisdiction,
    sourceKind: input.legalSource.sourceKind,
    authorityLevel: input.legalSource.authorityLevel,
    sourceStatus: input.legalSource.sourceStatus,
    treatmentStatus: input.legalSource.treatmentStatus,
    extractionStatus: input.legalSource.extractionStatus,
    reviewStatus: input.legalSource.reviewStatus,
    sourceHash,
    passageQuoteHashes
  };
}

function toReusablePropositionRecord(input: {
  runId: string;
  boundaryKey: string;
  proposition: LegalPropositionRecord;
  sourceVersionBySourceId: Map<string, LegalSourceVersionRecord>;
  passageById: Map<string, LegalPassageRecord>;
}): LegalReusablePropositionRecord {
  const sourceVersionKeys = input.proposition.sourceIds
    .map((sourceId) => input.sourceVersionBySourceId.get(sourceId)?.sourceVersionKey)
    .filter((sourceVersionKey): sourceVersionKey is string => Boolean(sourceVersionKey));
  const quoteHashes = input.proposition.passageIds
    .map((passageId) => input.passageById.get(passageId)?.quoteHash)
    .filter((quoteHash): quoteHash is string => Boolean(quoteHash));

  return {
    id: `legal_reusable_prop_${hashKey(`${input.boundaryKey}|${input.proposition.id}`)}`,
    runId: input.runId,
    propositionId: input.proposition.id,
    boundaryKey: input.boundaryKey,
    propositionType: input.proposition.propositionType,
    text: input.proposition.text,
    sourceIds: input.proposition.sourceIds,
    sourceVersionKeys,
    passageIds: input.proposition.passageIds,
    pinCites: input.proposition.pinCites,
    quoteHashes,
    authorityLevelRequired: input.proposition.authorityLevelRequired,
    reviewStatus: input.proposition.reviewStatus,
    notes: input.proposition.notes
  };
}

async function loadSuppliedLegalReuseLibraries(sources: SourceRecord[]): Promise<LegalImportedReuseLibrary[]> {
  const libraries: LegalImportedReuseLibrary[] = [];
  for (const source of sources) {
    if (!source.name.toLowerCase().endsWith("legal-reuse-library.json")) continue;
    try {
      const parsed = JSON.parse(await readFile(source.path, "utf8"));
      const library = normalizeImportedLibrary(source.path, parsed);
      if (library) libraries.push(library);
    } catch {
      // Invalid imported libraries remain ordinary source material and cannot silently affect reuse.
    }
  }
  return libraries;
}

function normalizeImportedLibrary(sourcePath: string, value: unknown): LegalImportedReuseLibrary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<LegalReuseLibrary>;
  if (candidate.profile !== "legal" || !candidate.boundary || !Array.isArray(candidate.sourceVersions) || !Array.isArray(candidate.propositions)) {
    return undefined;
  }
  return {
    sourcePath,
    id: typeof candidate.id === "string" ? candidate.id : "imported_legal_reuse_library",
    runId: typeof candidate.runId === "string" ? candidate.runId : "unknown",
    boundary: candidate.boundary,
    sourceVersions: candidate.sourceVersions,
    propositions: candidate.propositions
  };
}

function isReusableProposition(proposition: LegalPropositionRecord) {
  return (
    proposition.reviewStatus === "verified" &&
    proposition.sourceIds.length > 0 &&
    (proposition.passageIds.length > 0 || proposition.pinCites.length > 0)
  );
}

function groupPassagesBySourceId(passages: LegalPassageRecord[]) {
  const output = new Map<string, LegalPassageRecord[]>();
  for (const passage of passages) {
    output.set(passage.sourceId, [...(output.get(passage.sourceId) ?? []), passage]);
  }
  return output;
}

function sourceNeedsReuseReview(sourceVersion: LegalSourceVersionRecord) {
  return (
    sourceVersion.treatmentStatus === "not_checked" ||
    sourceVersion.sourceStatus === "superseded" ||
    sourceVersion.sourceStatus === "background" ||
    sourceVersion.sourceStatus === "draft"
  );
}

function mustFix(
  location: string,
  issue: string,
  category: LegalFindingDraft["category"],
  evidence: string,
  recommendedRepair: string
): LegalFindingDraft {
  return {
    location,
    issue,
    category,
    severity: "must_fix",
    evidence,
    recommendedRepair,
    humanReviewRequired: true
  };
}

function shouldFix(
  location: string,
  issue: string,
  category: LegalFindingDraft["category"],
  evidence: string,
  recommendedRepair: string
): LegalFindingDraft {
  return {
    location,
    issue,
    category,
    severity: "should_fix",
    evidence,
    recommendedRepair,
    humanReviewRequired: true
  };
}

async function fileHash(path: string) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return undefined;
  }
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

import type { EvidenceMapStore } from "../db/store.ts";
import { buildGeneratedClaims, buildEvidenceMapRecord } from "../evidence/map.ts";
import { selectSourceEvidence, type EvidenceSelectionResult } from "../evidence/select.ts";
import { buildSourceEvidenceRecords } from "../evidence/snippets.ts";
import type {
  ArtifactKind,
  EvidenceMapRecord,
  EvidenceMapRun,
  FileInspectionRecord,
  GeneratedClaimRecord,
  GeneratedOutputRecord,
  SourceEvidenceRecord,
  SourceRecord,
  TrustReport
} from "../types.ts";

export interface PreparedGeneratedOutput {
  sourceEvidence: SourceEvidenceRecord[];
  selection: EvidenceSelectionResult;
  generatedClaims: GeneratedClaimRecord[];
  evidenceMap: EvidenceMapRecord;
}

export async function prepareGeneratedOutput(input: {
  store: EvidenceMapStore;
  run: EvidenceMapRun;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
  artifactKind: ArtifactKind;
}): Promise<PreparedGeneratedOutput> {
  const initialEvidence = await input.store.replaceSourceEvidence(
    input.run.id,
    buildSourceEvidenceRecords({
      runId: input.run.id,
      sources: input.sources,
      inspections: input.inspections
    })
  );
  const selection = selectSourceEvidence({
    sources: input.sources,
    inspections: input.inspections,
    evidence: initialEvidence
  });
  const sourceEvidence = await input.store.replaceSourceEvidence(
    input.run.id,
    selection.evidence.map(({ runId: _runId, ...item }) => item)
  );
  const refreshedSelection = {
    ...selection,
    evidence: sourceEvidence,
    selectedEvidence: sourceEvidence.filter((item) => item.useStatus === "selected"),
    excludedEvidence: sourceEvidence.filter((item) => item.useStatus === "excluded")
  };
  const generatedClaims = await input.store.replaceGeneratedClaims(
    input.run.id,
    buildGeneratedClaims({
      runId: input.run.id,
      selectedEvidence: refreshedSelection.selectedEvidence
    })
  );
  const evidenceMap = await input.store.createEvidenceMap(
    buildEvidenceMapRecord({
      runId: input.run.id,
      artifactKind: input.artifactKind,
      generatedClaims,
      selectedEvidence: refreshedSelection.selectedEvidence,
      excludedEvidence: refreshedSelection.excludedEvidence
    })
  );

  return {
    sourceEvidence,
    selection: refreshedSelection,
    generatedClaims,
    evidenceMap
  };
}

export async function finalizeGeneratedOutput(input: {
  store: EvidenceMapStore;
  run: EvidenceMapRun;
  artifactKind: ArtifactKind;
  trustReport: TrustReport;
  evidenceMap: EvidenceMapRecord;
  generatedClaims: GeneratedClaimRecord[];
  notes: string[];
}): Promise<GeneratedOutputRecord> {
  const ready = input.trustReport.readiness === "ready";
  return input.store.createGeneratedOutput({
    runId: input.run.id,
    profile: "general",
    artifactKind: input.artifactKind,
    format: "markdown",
    status: ready ? "export_ready" : "refused",
    pathRelativeToRun: ready ? "04_export/final-output.md" : undefined,
    claimIds: ready ? input.generatedClaims.filter((claim) => claim.reviewStatus === "verified").map((claim) => claim.id) : [],
    evidenceMapId: input.evidenceMap.id,
    generatedAt: new Date().toISOString(),
    notes: input.notes
  });
}

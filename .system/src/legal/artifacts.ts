import type { EvidenceMapStore } from "../db/store.ts";
import type { EvidenceMapRun } from "../types.ts";
import { extractLegalPropositionIntake } from "./draft.ts";
import { buildLegalEvidenceMap } from "./evidence-map.ts";
import { applyLegalReviewDecisions, applyLegalSourceReviewDecisions } from "./review-decisions.ts";
import { buildLegalReuseLibrary } from "./reuse-library.ts";
import { buildLegalSourcePacket, type LegalSourcePacket } from "./source-packet.ts";
import { buildLegalOutputSpec } from "./spec.ts";
import type { LegalEvidenceMap, LegalOutputSpec, LegalPropositionRecord, LegalReuseLibrary, LegalReviewDecisionRecord } from "./types.ts";
import {
  applySourcePrepDecisionsToInspections,
  applySourcePrepDecisionsToSources,
  type SourcePrepReviewDecisionRecord
} from "../review/source-prep-decisions.ts";

export interface LegalRunArtifacts {
  legalSourcePacket: LegalSourcePacket;
  legalOutputSpec: LegalOutputSpec;
  legalEvidenceMap: LegalEvidenceMap;
  legalDraftPropositions: LegalPropositionRecord[];
  legalReuseLibrary: LegalReuseLibrary;
}

export async function buildLegalRunArtifacts(input: {
  store: EvidenceMapStore;
  run: EvidenceMapRun;
  reviewDecisions?: LegalReviewDecisionRecord[];
  sourcePrepReviewDecisions?: SourcePrepReviewDecisionRecord[];
}): Promise<LegalRunArtifacts> {
  const [storedSources, storedInspections] = await Promise.all([
    input.store.listSources(input.run.id),
    input.store.listFileInspections(input.run.id)
  ]);
  const sourcePrepReviewDecisions = input.sourcePrepReviewDecisions ?? [];
  const sources = applySourcePrepDecisionsToSources({
    sources: storedSources,
    decisions: sourcePrepReviewDecisions
  });
  const inspections = applySourcePrepDecisionsToInspections({
    inspections: storedInspections,
    decisions: sourcePrepReviewDecisions
  });
  const legalSourcePacket = applyLegalSourceReviewDecisions({
    legalSourcePacket: await buildLegalSourcePacket({ runId: input.run.id, sources, inspections }),
    decisions: input.reviewDecisions ?? []
  });
  const legalOutputSpec = buildLegalOutputSpec({
    runId: input.run.id,
    name: input.run.name,
    artifactKind: input.run.artifactKind,
    sources,
    inspections
  });
  const legalPropositionIntake = await extractLegalPropositionIntake({ runId: input.run.id, sources, inspections });
  const legalEvidenceMap = applyLegalReviewDecisions({
    legalEvidenceMap: buildLegalEvidenceMap({
      runId: input.run.id,
      artifactKind: input.run.artifactKind,
      legalSources: legalSourcePacket.sources,
      passages: legalSourcePacket.passages,
      propositions: legalPropositionIntake.evidenceMapPropositions.length > 0 ? legalPropositionIntake.evidenceMapPropositions : undefined
    }),
    decisions: input.reviewDecisions ?? []
  });
  const legalReuseLibrary = await buildLegalReuseLibrary({
    run: input.run,
    sources,
    legalSourcePacket,
    legalOutputSpec,
    legalEvidenceMap
  });

  return {
    legalSourcePacket,
    legalOutputSpec,
    legalEvidenceMap,
    legalDraftPropositions: legalPropositionIntake.draftPropositions,
    legalReuseLibrary
  };
}

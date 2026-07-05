import type { EvidenceMapStore } from "../db/store.ts";
import type { EvidenceMapRun } from "../types.ts";
import { extractLegalPropositionIntake } from "./draft.ts";
import { buildLegalEvidenceMap } from "./evidence-map.ts";
import { applyLegalReviewDecisions, applyLegalSourceReviewDecisions } from "./review-decisions.ts";
import { buildLegalSourcePacket, type LegalSourcePacket } from "./source-packet.ts";
import { buildLegalOutputSpec } from "./spec.ts";
import type { LegalEvidenceMap, LegalOutputSpec, LegalPropositionRecord, LegalReviewDecisionRecord } from "./types.ts";

export interface LegalRunArtifacts {
  legalSourcePacket: LegalSourcePacket;
  legalOutputSpec: LegalOutputSpec;
  legalEvidenceMap: LegalEvidenceMap;
  legalDraftPropositions: LegalPropositionRecord[];
}

export async function buildLegalRunArtifacts(input: {
  store: EvidenceMapStore;
  run: EvidenceMapRun;
  reviewDecisions?: LegalReviewDecisionRecord[];
}): Promise<LegalRunArtifacts> {
  const [sources, inspections] = await Promise.all([
    input.store.listSources(input.run.id),
    input.store.listFileInspections(input.run.id)
  ]);
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

  return {
    legalSourcePacket,
    legalOutputSpec,
    legalEvidenceMap,
    legalDraftPropositions: legalPropositionIntake.draftPropositions
  };
}

import type { SourceExclusion } from "../evidence/select.ts";
import type { EvidenceMapRun, GeneratedClaimRecord, SourceEvidenceRecord } from "../types.ts";

export interface VerifiedOutputEvidenceRef {
  id: string;
  sourceId: string;
  sourceName: string;
  anchor: string;
  sourceDate?: string;
}

export interface VerifiedOutputClaim {
  generatedClaimId: string;
  text: string;
  sourceIds: string[];
  evidenceIds: string[];
  sourceDates: string[];
  evidenceRefs: VerifiedOutputEvidenceRef[];
}

export interface VerifiedOutputDocument {
  runId: string;
  runName: string;
  verifiedClaims: VerifiedOutputClaim[];
  excludedSources: SourceExclusion[];
  verificationBoundary: {
    canonicalOutput: "04_export/final-output.md";
    sourcePacket: "01_source-packet/source-inventory.json";
    sourceEvidence: "01_source-packet/source-evidence.json";
    evidenceMap: "03_verification/evidence-map.json";
    generatedClaims: "03_verification/generated-claims.json";
    trustReport: "03_verification/trust-report.json";
  };
}

export function buildVerifiedOutputDocument(input: {
  run: EvidenceMapRun;
  generatedClaims: GeneratedClaimRecord[];
  sourceEvidence: SourceEvidenceRecord[];
  sourceExclusions: SourceExclusion[];
}): VerifiedOutputDocument {
  const evidenceById = new Map(input.sourceEvidence.map((item) => [item.id, item]));
  const verifiedClaims = input.generatedClaims
    .filter((claim) => claim.reviewStatus === "verified")
    .map((claim) => {
      const evidenceRefs = claim.evidenceIds.map((id) => evidenceById.get(id)).filter((item): item is SourceEvidenceRecord => Boolean(item));
      return {
        generatedClaimId: claim.id,
        text: claim.claim,
        sourceIds: [...claim.sourceIds],
        evidenceIds: [...claim.evidenceIds],
        sourceDates: [...claim.sourceDates],
        evidenceRefs: evidenceRefs.map((item) => ({
          id: item.id,
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          anchor: item.anchor,
          sourceDate: item.sourceDate
        }))
      };
    });

  return {
    runId: input.run.id,
    runName: input.run.name,
    verifiedClaims,
    excludedSources: input.sourceExclusions,
    verificationBoundary: {
      canonicalOutput: "04_export/final-output.md",
      sourcePacket: "01_source-packet/source-inventory.json",
      sourceEvidence: "01_source-packet/source-evidence.json",
      evidenceMap: "03_verification/evidence-map.json",
      generatedClaims: "03_verification/generated-claims.json",
      trustReport: "03_verification/trust-report.json"
    }
  };
}

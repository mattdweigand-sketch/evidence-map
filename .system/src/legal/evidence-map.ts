import type { ArtifactKind } from "../types.ts";
import type { LegalEvidenceMap, LegalPassageRecord, LegalPropositionRecord, LegalSourceRecord } from "./types.ts";

export function buildLegalEvidenceMap(input: {
  runId: string;
  artifactKind: ArtifactKind;
  legalSources: LegalSourceRecord[];
  passages: LegalPassageRecord[];
  propositions?: LegalPropositionRecord[];
}): LegalEvidenceMap {
  const propositions =
    input.propositions ??
    seedLegalPropositions({
      runId: input.runId,
      artifactKind: input.artifactKind
    });

  return {
    id: `legal_evidence_map_${input.runId}`,
    runId: input.runId,
    profile: "legal",
    artifactKind: input.artifactKind,
    propositions,
    summary: {
      propositionCount: propositions.length,
      mappedPropositionCount: propositions.filter((proposition) => proposition.sourceIds.length > 0).length,
      unsupportedPropositionCount: propositions.filter((proposition) => proposition.reviewStatus === "unsupported").length,
      passageSupportedPropositionCount: propositions.filter((proposition) => proposition.passageIds.length > 0 || proposition.pinCites.length > 0).length
    },
    notes: [
      "Phase 3 legal evidence map is artifact-backed, not store-backed.",
      "Phase 3B draft discipline checks compare explicitly marked draft propositions against this map."
    ]
  };
}

export function seedLegalPropositions(input: {
  runId: string;
  artifactKind: ArtifactKind;
}): LegalPropositionRecord[] {
  return [
    {
      id: `legal_prop_seed_${input.runId}`,
      runId: input.runId,
      artifactLocation: input.artifactKind === "deck" ? "legal-slide-map" : "legal-section-map",
      propositionType: "rule",
      text: "Legal propositions must be supplied by the operator and mapped to legal authorities before final-ready legal work.",
      sourceIds: [],
      passageIds: [],
      pinCites: [],
      assumptions: [],
      authorityLevelRequired: "binding",
      reviewStatus: "unsupported"
    }
  ];
}

export function renderLegalEvidenceMap(map: LegalEvidenceMap) {
  const rows = map.propositions.length
    ? map.propositions
        .map(
          (proposition) =>
            `| ${escapeCell(proposition.id)} | ${proposition.propositionType} | ${escapeCell(proposition.artifactLocation)} | ${escapeCell(proposition.text)} | ${escapeCell(proposition.sourceIds.join(", "))} | ${escapeCell(proposition.passageIds.join(", "))} | ${escapeCell(proposition.pinCites.join(", "))} | ${proposition.authorityLevelRequired} | ${proposition.reviewStatus} |`
        )
        .join("\n")
    : "| none |  |  |  |  |  |  |  |  |";

  return `# Legal Evidence Map

This artifact maps legal propositions to source and passage support. It is a reliability artifact, not legal advice.

Propositions: ${map.summary.propositionCount}

Mapped propositions: ${map.summary.mappedPropositionCount}

Passage-supported propositions: ${map.summary.passageSupportedPropositionCount}

Unsupported propositions: ${map.summary.unsupportedPropositionCount}

## Propositions

| ID | Type | Location | Text | Source IDs | Passage IDs | Pin cites | Authority required | Review |
|---|---|---|---|---|---|---|---|---|
${rows}

## Notes

${map.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

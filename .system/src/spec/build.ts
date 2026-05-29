import type { ArtifactKind, ArtifactSpec, CalculationRecord, ClaimRecord } from "../types.ts";

export function buildArtifactSpec(input: {
  runId: string;
  artifactKind: ArtifactKind;
  name: string;
}): Omit<ArtifactSpec, "id"> {
  return {
    runId: input.runId,
    artifactKind: input.artifactKind,
    audience: "Named human reviewer or decision maker.",
    decisionContext: "Artifact will be shared beyond the immediate working context.",
    narrativeSpine: `Create a defensible ${input.artifactKind} for ${input.name} from an approved source packet.`,
    structure: structureFor(input.artifactKind),
    requiredChecks: [
      "Every material claim has a source ID.",
      "Every number has a source date or is labeled as an assumption.",
      "Every chart maps to source data.",
      "Every calculation identifies inputs and expected behavior.",
      "Every unresolved conflict is visible before export."
    ],
    creationRules: [
      "Do not create the final artifact until the source packet and specification are reviewed.",
      "Preserve source IDs in notes, evidence maps, or check tabs.",
      "Label assumptions as assumptions.",
      "Do not hardcode calculated outputs where formulas are expected.",
      "Run hostile verification before final export."
    ]
  };
}

export function seedClaims(input: { runId: string; artifactKind: ArtifactKind }): Omit<ClaimRecord, "id" | "runId">[] {
  if (input.artifactKind === "workbook") return [];
  return [
    {
      artifactLocation: input.artifactKind === "deck" ? "slide-map" : "section-map",
      claim: "Primary artifact claim must be supplied by the human owner or source packet.",
      sourceIds: [],
      assumptions: [],
      reviewStatus: "unsupported"
    }
  ];
}

export function seedCalculations(input: { artifactKind: ArtifactKind }): Omit<CalculationRecord, "id" | "runId">[] {
  if (input.artifactKind !== "workbook" && input.artifactKind !== "mixed") return [];
  return [
    {
      artifactLocation: "workbook/checks",
      inputs: [],
      logic: "Calculation flow must be mapped from raw data to assumptions to outputs.",
      expectedBehavior: "Outputs change when linked assumptions change.",
      riskFlags: ["formula_map_missing", "checks_tab_required"],
      reviewStatus: "needs_review"
    }
  ];
}

function structureFor(kind: ArtifactKind) {
  if (kind === "deck") {
    return [
      "Audience and decision context.",
      "One-sentence narrative spine.",
      "Slide map with claim headlines.",
      "Evidence map for every slide claim.",
      "Speaker notes with source IDs, calculations, assumptions, and review status."
    ];
  }

  if (kind === "workbook") {
    return [
      "Raw data tab.",
      "Assumptions tab.",
      "Calculation tabs.",
      "Output views.",
      "Checks tab.",
      "Documentation tab."
    ];
  }

  return [
    "Audience and decision context.",
    "Section map.",
    "Claim and evidence map.",
    "Assumptions and open questions.",
    "Verification checklist."
  ];
}

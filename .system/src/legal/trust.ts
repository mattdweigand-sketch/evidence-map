import { quoteHash } from "./passages.ts";
import type { LegalEvidenceMap, LegalFindingCategory, LegalFindingDraft, LegalPassageRecord, LegalPropositionRecord, LegalSourceRecord } from "./types.ts";

const pinpointRequiredTypes = new Set<LegalPropositionRecord["propositionType"]>(["rule", "holding", "quote", "record_fact", "citation"]);
const recordSourceKinds = new Set<LegalSourceRecord["sourceKind"]>(["case", "brief", "motion", "order", "contract", "exhibit", "transcript"]);

export function buildLegalTrustFindings(input: {
  legalSources: LegalSourceRecord[];
  passages: LegalPassageRecord[];
  propositions: LegalPropositionRecord[];
}): LegalFindingDraft[] {
  const findings: LegalFindingDraft[] = [];
  const sourceById = new Map(input.legalSources.map((source) => [source.sourceId, source]));
  const passageById = new Map(input.passages.map((passage) => [passage.passageId, passage]));
  const passageIds = new Set(passageById.keys());

  for (const source of input.legalSources) {
    if (source.extractionStatus === "failed") {
      findings.push(
        mustFix(
          `legal-source:${source.title}`,
          "Legal source text extraction failed.",
          "missing_pinpoint",
          `${source.title} has extractionStatus failed.`,
          "Repair the source file, replace it, or add manual passage support before final reliance."
        )
      );
    }
    if (source.extractionStatus === "metadata_only") {
      findings.push(
        shouldFix(
          `legal-source:${source.title}`,
          "Legal source has no extracted legal text.",
          "missing_pinpoint",
          `${source.title} is metadata-only and has no citeable passage anchors.`,
          "Run a supported text extractor or add manual passage support before final reliance."
        )
      );
    }
    if (source.authorityLevel === "unknown") {
      findings.push(
        shouldFix(
          `legal-source:${source.title}`,
          "Legal source authority level requires review.",
          "authority_level_mismatch",
          `${source.title} is classified with unknown authority level.`,
          "Confirm whether the source is binding, persuasive, secondary, record, or assignment material before final reliance."
        )
      );
    }
    if (source.treatmentStatus === "not_checked") {
      findings.push(
        shouldFix(
          `legal-source:${source.title}`,
          "Legal source treatment has not been checked.",
          "negative_treatment_not_checked",
          `${source.title} has treatmentStatus not_checked.`,
          "Check currentness/treatment or carry this as an unresolved legal-review item."
        )
      );
    }
  }

  for (const proposition of input.propositions) {
    const supportingSources = proposition.sourceIds.map((sourceId) => sourceById.get(sourceId)).filter((source): source is LegalSourceRecord => Boolean(source));

    if (proposition.sourceIds.length === 0) {
      findings.push(
        mustFix(
          proposition.artifactLocation,
          "Legal proposition has no source support.",
          "missing_authority",
          proposition.text,
          "Attach supplied legal source IDs or mark/remove the proposition before legal review."
        )
      );
    }

    const missingSourceIds = proposition.sourceIds.filter((sourceId) => !sourceById.has(sourceId));
    for (const sourceId of missingSourceIds) {
      findings.push(
        mustFix(
          proposition.artifactLocation,
          "Legal proposition references a missing source.",
          "missing_authority",
          `${proposition.text} references ${sourceId}, which is not in the legal source packet.`,
          "Attach an existing source ID or add the source to the packet."
        )
      );
    }

    if (pinpointRequiredTypes.has(proposition.propositionType) && proposition.passageIds.length === 0 && proposition.pinCites.length === 0) {
      findings.push(
        mustFix(
          proposition.artifactLocation,
          "Legal proposition lacks passage or pinpoint support.",
          "missing_pinpoint",
          `${proposition.propositionType}: ${proposition.text}`,
          "Attach a passage ID or pinpoint citation before treating the proposition as final-ready."
        )
      );
    }

    for (const passageId of proposition.passageIds) {
      if (!passageIds.has(passageId)) {
        findings.push(
          mustFix(
            proposition.artifactLocation,
            "Legal proposition references a missing passage.",
            "missing_pinpoint",
            `${proposition.text} references ${passageId}, which is not in extracted/manual legal passages.`,
            "Attach an existing passage ID or remove the passage reference."
          )
        );
      }
    }

    if (proposition.propositionType === "quote" && proposition.passageIds.length > 0) {
      const passages = proposition.passageIds.map((passageId) => passageById.get(passageId)).filter((passage): passage is LegalPassageRecord => Boolean(passage));
      if (passages.length > 0 && !passages.some((passage) => passage.quoteHash === quoteHash(proposition.text))) {
        findings.push(
          mustFix(
            proposition.artifactLocation,
            "Quoted legal proposition does not match referenced passage text.",
            "quote_drift",
            proposition.text,
            "Replace the quote with the extracted passage text or attach the correct passage support."
          )
        );
      }
    }

    for (const source of supportingSources) {
      if (source.extractionStatus === "metadata_only" || source.extractionStatus === "failed") {
        findings.push(
          mustFix(
            proposition.artifactLocation,
            "Metadata-only legal source cannot support final-ready legal work.",
            "missing_pinpoint",
            `${proposition.text} relies on ${source.title}, which has extractionStatus ${source.extractionStatus}.`,
            "Extract legal text or replace this support with citeable passage evidence."
          )
        );
      }
      if (source.authorityLevel === "unknown") {
        findings.push(
          shouldFix(
            proposition.artifactLocation,
            "Legal proposition uses a source with unknown authority level.",
            "authority_level_mismatch",
            `${proposition.text} relies on ${source.title}.`,
            "Confirm the authority level before final reliance."
          )
        );
      }
    }

    if (proposition.propositionType === "record_fact" && supportingSources.length > 0 && !supportingSources.some((source) => recordSourceKinds.has(source.sourceKind))) {
      findings.push(
        mustFix(
          proposition.artifactLocation,
          "Record fact lacks record, case, exhibit, or transcript support.",
          "unsupported_record_fact",
          proposition.text,
          "Support record facts with supplied record evidence, a case source, an exhibit, or a transcript."
        )
      );
    }

    if (proposition.authorityLevelRequired === "binding" && supportingSources.length > 0 && !supportingSources.some((source) => source.authorityLevel === "binding")) {
      const allSecondary = supportingSources.every((source) => source.authorityLevel === "secondary");
      findings.push(
        mustFix(
          proposition.artifactLocation,
          allSecondary ? "Binding-law proposition relies only on secondary authority." : "Binding-law proposition lacks binding authority support.",
          allSecondary ? "secondary_only_rule" : "authority_level_mismatch",
          proposition.text,
          "Attach binding authority or rewrite the proposition so it does not claim binding law."
        )
      );
    }
  }

  return findings;
}

export function buildLegalDraftDisciplineFindings(input: {
  legalEvidenceMap: LegalEvidenceMap;
  draftPropositions: LegalPropositionRecord[];
}): LegalFindingDraft[] {
  const mappedTexts = new Set(input.legalEvidenceMap.propositions.map((proposition) => normalizePropositionText(proposition.text)));
  const findings: LegalFindingDraft[] = [];

  for (const proposition of input.draftPropositions) {
    if (mappedTexts.has(normalizePropositionText(proposition.text))) continue;
    findings.push(
      mustFix(
        proposition.artifactLocation,
        "Draft legal proposition is not represented in the legal evidence map.",
        draftDisciplineCategory(proposition),
        `${proposition.propositionType}: ${proposition.text}`,
        "Add this proposition to the legal evidence map with source and passage support, or remove it from the draft."
      )
    );
  }

  return findings;
}

function mustFix(
  location: string,
  issue: string,
  category: LegalFindingCategory,
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
  category: LegalFindingCategory,
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

function normalizePropositionText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function draftDisciplineCategory(proposition: LegalPropositionRecord): LegalFindingCategory {
  if (proposition.propositionType === "conclusion" || proposition.propositionType === "application" || proposition.propositionType === "counterargument") {
    return "conclusion_outpaces_support";
  }
  if (proposition.propositionType === "record_fact" || proposition.propositionType === "procedural_fact" || proposition.propositionType === "quote") {
    return "missing_pinpoint";
  }
  if (proposition.propositionType === "citation" || proposition.propositionType === "rule" || proposition.propositionType === "holding") {
    return "model_knowledge_leak";
  }
  return "missing_authority";
}

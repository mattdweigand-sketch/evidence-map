import type { EvidenceMapStore } from "../db/store.ts";
import { buildLegalRunArtifacts } from "../legal/artifacts.ts";
import { applyLegalConflictReviewDecisions, applyLegalRiskAcceptanceDecisions } from "../legal/review-decisions.ts";
import { buildLegalReuseFindings } from "../legal/reuse-library.ts";
import { buildLegalDraftDisciplineFindings, buildLegalTrustFindings } from "../legal/trust.ts";
import type { LegalReviewDecisionRecord } from "../legal/types.ts";
import {
  applyGeneralCalculationReviewDecisions,
  applyGeneralClaimReviewDecisions,
  applyGeneralConflictReviewDecisions,
  applyGeneralRiskAcceptanceDecisions,
  type GeneralReviewDecisionRecord
} from "../review/general-decisions.ts";
import {
  applySourcePrepDecisionsToInspections,
  applySourcePrepDecisionsToSources,
  type SourcePrepReviewDecisionRecord
} from "../review/source-prep-decisions.ts";
import type { GeneratedClaimRecord, OutputMode, SourceEvidenceRecord, VerificationFinding } from "../types.ts";
import { workbookInspectionFindings } from "./workbook-findings.ts";

type FindingDraft = Omit<VerificationFinding, "id" | "runId">;

export async function runHostileReview(
  store: EvidenceMapStore,
  runId: string,
  options: {
    outputMode?: OutputMode;
    generationBlockers?: string[];
    generationWarnings?: string[];
  } = {}
): Promise<VerificationFinding[]> {
  return store.createVerificationFindings(runId, await buildHostileReviewFindings(store, runId, options));
}

export async function buildHostileReviewFindings(
  store: EvidenceMapStore,
  runId: string,
  options: {
    outputMode?: OutputMode;
    generationBlockers?: string[];
    generationWarnings?: string[];
    legalReviewDecisions?: LegalReviewDecisionRecord[];
    generalReviewDecisions?: GeneralReviewDecisionRecord[];
    sourcePrepReviewDecisions?: SourcePrepReviewDecisionRecord[];
  } = {}
): Promise<FindingDraft[]> {
  const run = await store.getRun(runId);
  const storedSources = await store.listSources(runId);
  const storedInspections = await store.listFileInspections(runId);
  const storedConflicts = await store.listSourceConflicts(runId);
  const storedClaims = await store.listClaims(runId);
  const storedCalculations = await store.listCalculations(runId);
  const assumptions = await store.listAssumptions(runId);
  const sourcePrepReviewDecisions = options.sourcePrepReviewDecisions ?? [];
  const legalReviewDecisions = run?.profile === "legal" ? options.legalReviewDecisions ?? [] : [];
  const generalReviewDecisions = run?.profile === "general" ? options.generalReviewDecisions ?? [] : [];
  const sources = applySourcePrepDecisionsToSources({
    sources: storedSources,
    decisions: sourcePrepReviewDecisions
  });
  const inspections = applySourcePrepDecisionsToInspections({
    inspections: storedInspections,
    decisions: sourcePrepReviewDecisions
  });
  const conflicts =
    run?.profile === "legal"
      ? applyLegalConflictReviewDecisions({ conflicts: storedConflicts, decisions: legalReviewDecisions })
      : run?.profile === "general"
        ? applyGeneralConflictReviewDecisions({ conflicts: storedConflicts, decisions: generalReviewDecisions })
      : storedConflicts;
  const claims =
    run?.profile === "general"
      ? applyGeneralClaimReviewDecisions({ claims: storedClaims, decisions: generalReviewDecisions })
      : storedClaims;
  const calculations =
    run?.profile === "general"
      ? applyGeneralCalculationReviewDecisions({ calculations: storedCalculations, decisions: generalReviewDecisions })
      : storedCalculations;

  if (run?.profile === "general" && options.outputMode === "generate") {
    return buildGenerationModeFindings({
      store,
      runId,
      sources,
      inspections,
      conflicts,
      generationBlockers: options.generationBlockers ?? [],
      generationWarnings: options.generationWarnings ?? []
    });
  }

  let findings: FindingDraft[] = [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const inspectionBySourceId = new Map(inspections.filter((inspection) => inspection.sourceId).map((inspection) => [inspection.sourceId, inspection]));

  if (sources.length === 0) {
    findings.push(mustFix("source-packet", "No source inventory exists.", "The workflow has no source records.", "Create a source packet before artifact work."));
  }

  for (const source of sources) {
    if (source.status === "unclear") {
      findings.push({
        location: `source:${source.name}`,
        issue: "Source status is unclear.",
        severity: "should_fix",
        evidence: "The source is not labeled current, superseded, raw data, estimate, transcript, or background.",
        recommendedRepair: "Assign a source status and intended use before relying on it.",
        humanReviewRequired: true
      });
    }
  }

  for (const inspection of inspections) {
    if (inspection.status === "failed") {
      findings.push(mustFix(`source:${inspection.name}`, "Source inspection failed.", inspection.warnings.join(" "), "Repair or replace the file before relying on it."));
    }
    if (inspection.status === "metadata_only" || inspection.status === "unsupported") {
      findings.push({
        location: `source:${inspection.name}`,
        issue: "Source has not been deeply inspected.",
        severity: "should_fix",
        evidence: inspection.warnings.join(" ") || "Only metadata is available for this source.",
        recommendedRepair: "Run a format-specific parser or route source interpretation to human review.",
        humanReviewRequired: true
      });
    }
    const source = inspection.sourceId ? sourceById.get(inspection.sourceId) : undefined;
    if (getNumberCandidateCount(inspection) > 0 && inspection.sourceDateCandidates.length === 0 && !source?.sourceDate) {
      findings.push(mustFix(`source:${inspection.name}`, "Number-bearing source has no source date.", `${getNumberCandidateCount(inspection)} number-like values were found without a valid source date candidate.`, "Add a source date to the filename, source metadata, or review packet before using these numbers."));
    }
    findings.push(...workbookInspectionFindings(inspection));
  }

  for (const conflict of conflicts.filter((item) => item.status === "open")) {
    findings.push(mustFix("source-conflict", conflict.description, "Open conflicts can silently blend stale and current material.", "Resolve or explicitly carry the conflict into the artifact."));
  }

  for (const claim of claims) {
    if (claim.sourceIds.length === 0) {
      findings.push(mustFix(claim.artifactLocation, "Claim has no source attribution.", claim.claim, "Attach source IDs or mark the claim as unsupported."));
    }
    if (claim.reviewStatus === "unsupported") {
      findings.push(mustFix(claim.artifactLocation, "Claim is marked unsupported.", claim.claim, "Remove, source, or route the claim to review."));
    }
    for (const sourceId of claim.sourceIds) {
      const source = sourceById.get(sourceId);
      if (!source) continue;
      const inspection = inspectionBySourceId.get(sourceId);
      if ((source.status === "superseded" || source.status === "background") && claim.reviewStatus !== "verified") {
        findings.push({
          location: claim.artifactLocation,
          issue: "Claim relies on a stale or background-only source.",
          severity: "should_fix",
          evidence: `${source.name} is labeled ${source.status}.`,
          recommendedRepair: "Confirm the source is appropriate or replace it with a current decision source.",
          humanReviewRequired: true
        });
      }
      if (getNumberCandidateCount(inspection) > 0 && !source.sourceDate && inspection?.sourceDateCandidates.length === 0) {
        findings.push(mustFix(claim.artifactLocation, "Claim uses numbers without a source date.", claim.claim, "Attach a source date or mark the number as an assumption."));
      }
    }
  }

  for (const calculation of calculations) {
    if (calculation.inputs.length === 0) {
      findings.push(mustFix(calculation.artifactLocation, "Calculation has no mapped inputs.", calculation.logic, "Map raw data, assumptions, and source IDs before use."));
    }
    for (const flag of calculation.riskFlags) {
      findings.push({
        location: calculation.artifactLocation,
        issue: `Calculation risk: ${flag}.`,
        severity: "must_fix",
        evidence: calculation.expectedBehavior,
        recommendedRepair: "Add a formula map, checks tab, or verification memo.",
        humanReviewRequired: true
      });
    }
  }

  for (const assumption of assumptions) {
    if (assumption.status === "unsupported" || assumption.status === "placeholder") {
      findings.push(mustFix(`assumption:${assumption.name}`, "Assumption is not decision-ready.", assumption.value, "Source, replace, or explicitly route this assumption to review."));
    }
    if (assumption.status === "estimate") {
      findings.push({
        location: `assumption:${assumption.name}`,
        issue: "Assumption is an estimate.",
        severity: "should_fix",
        evidence: assumption.value,
        recommendedRepair: "Confirm owner, date, unit, and acceptable use before relying on this estimate.",
        humanReviewRequired: true
      });
    }
    if (!assumption.owner && (assumption.status === "estimate" || assumption.status === "unsupported" || assumption.status === "placeholder")) {
      findings.push({
        location: `assumption:${assumption.name}`,
        issue: "High-risk assumption lacks an owner.",
        severity: "must_fix",
        evidence: assumption.value,
        recommendedRepair: "Assign an owner or remove the assumption from decision-ready output.",
        humanReviewRequired: true
      });
    }
  }

  if (run?.profile === "legal") {
    const legalArtifacts = await buildLegalRunArtifacts({
      store,
      run,
      reviewDecisions: legalReviewDecisions,
      sourcePrepReviewDecisions
    });
    findings.push(
      ...buildLegalTrustFindings({
        legalSources: legalArtifacts.legalSourcePacket.sources,
        passages: legalArtifacts.legalSourcePacket.passages,
        propositions: legalArtifacts.legalEvidenceMap.propositions
      }),
      ...buildLegalDraftDisciplineFindings({
        legalEvidenceMap: legalArtifacts.legalEvidenceMap,
        draftPropositions: legalArtifacts.legalDraftPropositions
      }),
      ...buildLegalReuseFindings({
        legalReuseLibrary: legalArtifacts.legalReuseLibrary,
        legalEvidenceMap: legalArtifacts.legalEvidenceMap
      })
    );
  }

  if (run?.profile === "legal") {
    findings = applyLegalRiskAcceptanceDecisions({ findings, decisions: legalReviewDecisions });
  }
  if (run?.profile === "general") {
    findings = applyGeneralRiskAcceptanceDecisions({ findings, decisions: generalReviewDecisions });
  }

  return findings;
}

async function buildGenerationModeFindings(input: {
  store: EvidenceMapStore;
  runId: string;
  sources: Awaited<ReturnType<EvidenceMapStore["listSources"]>>;
  inspections: Awaited<ReturnType<EvidenceMapStore["listFileInspections"]>>;
  conflicts: Awaited<ReturnType<EvidenceMapStore["listSourceConflicts"]>>;
  generationBlockers: string[];
  generationWarnings: string[];
}): Promise<FindingDraft[]> {
  const sourceEvidence = await input.store.listSourceEvidence(input.runId);
  const generatedClaims = await input.store.listGeneratedClaims(input.runId);
  const selectedEvidence = sourceEvidence.filter((item) => item.useStatus === "selected");
  const excludedEvidence = sourceEvidence.filter((item) => item.useStatus === "excluded");
  const selectedSourceIds = new Set(selectedEvidence.map((item) => item.sourceId));
  const excludedSourceIds = new Set(excludedEvidence.map((item) => item.sourceId));
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const inspectionBySourceId = new Map(input.inspections.filter((inspection) => inspection.sourceId).map((inspection) => [inspection.sourceId, inspection]));
  const findings: FindingDraft[] = [];

  if (input.sources.length === 0) {
    findings.push(mustFix("source-packet", "No source inventory exists.", "The workflow has no source records.", "Create a source packet before artifact work."));
  }

  for (const blocker of input.generationBlockers) {
    findings.push(mustFix("generated-output", `Generated output selection blocker: ${blocker}`, blocker, "Repair the source packet or exclude the conflicting evidence before final output."));
  }

  for (const warning of input.generationWarnings) {
    findings.push(polish("generated-output", "Generated output warning.", warning, "Review excluded evidence if the output scope changes."));
  }

  for (const item of excludedEvidence) {
    findings.push(
      polish(
        `source:${item.sourceName}`,
        "Source evidence excluded from generated output.",
        item.exclusionReason ?? `${item.kind} ${item.anchor} was not selected for final output.`,
        "No action is required unless this source must support the generated output."
      )
    );
  }

  for (const source of input.sources) {
    const inspection = inspectionBySourceId.get(source.id);
    const isSelected = selectedSourceIds.has(source.id);
    const isExcluded = excludedSourceIds.has(source.id);
    const effectiveStatus = effectiveGenerationSourceStatus(source.name, source.status);
    if (effectiveStatus === "unclear" && isSelected) {
      findings.push({
        location: `source:${source.name}`,
        issue: "Selected source status is unclear.",
        severity: "should_fix",
        evidence: "Generation selected this source because no stronger current/raw/transcript alternative was available.",
        recommendedRepair: "Assign a source status before relying on it for final generated output.",
        humanReviewRequired: true
      });
    } else if (effectiveStatus === "unclear" && isExcluded) {
      findings.push(polish(`source:${source.name}`, "Excluded source status is unclear.", "The source was excluded from final generated support.", "Classify it if it becomes relevant."));
    }

    if (!inspection) continue;
    if (isSelected && inspection.status === "failed") {
      findings.push(mustFix(`source:${source.name}`, "Selected source inspection failed.", inspection.warnings.join(" "), "Repair or replace the file before relying on it."));
    } else if (!isSelected && inspection.status === "failed") {
      findings.push(polish(`source:${source.name}`, "Excluded source inspection failed.", inspection.warnings.join(" "), "Repair only if this source must support the output."));
    }
    if (isSelected && (inspection.status === "metadata_only" || inspection.status === "unsupported")) {
      findings.push(mustFix(`source:${source.name}`, "Selected source was not deeply inspected.", inspection.warnings.join(" ") || "Only metadata is available for this source.", "Use an inspectable source before final generated output."));
    }
    if (isSelected) {
      findings.push(...workbookInspectionFindings(inspection));
    }
  }

  for (const item of selectedEvidence) {
    if (item.numberCandidates.length > 0 && !item.sourceDate) {
      findings.push(mustFix(`evidence:${item.sourceName}:${item.anchor}`, "Selected numeric evidence has no source date.", item.text, "Add a source date or exclude this evidence from generated numeric claims."));
    }
  }

  for (const conflict of input.conflicts.filter((item) => item.status === "open")) {
    const selectedConflictSourceIds = conflict.sourceIds.filter((sourceId) => selectedSourceIds.has(sourceId));
    if (selectedConflictSourceIds.length > 1) {
      findings.push(mustFix("source-conflict", conflict.description, "Open conflict includes multiple selected generated-output sources.", "Resolve the conflict before final output."));
    } else if (selectedConflictSourceIds.length === 1) {
      const selectedSource = sourceById.get(selectedConflictSourceIds[0]);
      findings.push(
        polish(
          "source-conflict",
          "Open conflict resolved by generated-output source selection.",
          `${conflict.description} Selected source: ${selectedSource?.name ?? selectedConflictSourceIds[0]}.`,
          "No action is required unless an excluded source should support the output."
        )
      );
    }
  }

  addGeneratedClaimFindings(findings, generatedClaims, sourceEvidence);
  return findings;
}

function effectiveGenerationSourceStatus(name: string, status: string) {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hasToken = (...values: string[]) => values.some((value) => tokens.includes(value));
  if (hasToken("old", "archive", "archived", "superseded")) return "superseded";
  if (hasToken("interview", "notes", "transcript", "call")) return "transcript";
  if (hasToken("final", "current", "approved", "latest")) return "current";
  return status;
}

function addGeneratedClaimFindings(
  findings: FindingDraft[],
  generatedClaims: GeneratedClaimRecord[],
  sourceEvidence: SourceEvidenceRecord[]
) {
  const verifiedClaims = generatedClaims.filter((claim) => claim.reviewStatus === "verified");
  if (verifiedClaims.length === 0) {
    findings.push(mustFix("generated-output", "No verified generated claims are available.", "The generator did not produce any claim that passed deterministic support checks.", "Select dated source evidence or repair source conflicts before final output."));
  }

  const evidenceById = new Map(sourceEvidence.map((item) => [item.id, item]));
  for (const claim of generatedClaims) {
    if (claim.sourceIds.length === 0 || claim.evidenceIds.length === 0) {
      findings.push(mustFix(claim.artifactLocation, "Generated claim has no source or evidence attribution.", claim.claim, "Attach source IDs and evidence IDs before final output."));
    }
    if (claim.reviewStatus === "unsupported") {
      findings.push(mustFix(claim.artifactLocation, "Generated claim is unsupported.", claim.claim, "Remove, source, or repair the claim before final output."));
    } else if (claim.reviewStatus === "needs_review") {
      findings.push(polish(claim.artifactLocation, "Generated claim was dropped because it needs review.", claim.claim, "Review it manually before using it in final output."));
    }
    const claimEvidence = claim.evidenceIds.map((id) => evidenceById.get(id)).filter((item): item is SourceEvidenceRecord => Boolean(item));
    if (claimEvidence.some((item) => item.useStatus === "excluded")) {
      findings.push(mustFix(claim.artifactLocation, "Generated claim cites excluded evidence.", claim.claim, "Regenerate the evidence map without excluded evidence."));
    }
    const hasNumber = /\b-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b|\b-?\d+(?:\.\d+)?%?\b/.test(claim.claim);
    if (hasNumber && claim.sourceDates.length === 0) {
      findings.push(mustFix(claim.artifactLocation, "Generated numeric claim has no source date.", claim.claim, "Attach a source date before final output."));
    }
  }
}

function mustFix(location: string, issue: string, evidence: string, recommendedRepair: string): FindingDraft {
  return {
    location,
    issue,
    severity: "must_fix",
    evidence,
    recommendedRepair,
    humanReviewRequired: true
  };
}

function polish(location: string, issue: string, evidence: string, recommendedRepair: string): FindingDraft {
  return {
    location,
    issue,
    severity: "polish",
    evidence,
    recommendedRepair,
    humanReviewRequired: false
  };
}

function getNumberCandidateCount(inspection: { structuredSummary: Record<string, unknown> } | undefined) {
  if (!inspection) return 0;
  const summary = inspection.structuredSummary as {
    numberCandidateCount?: number;
    workbook?: { numericCellCount?: number; hardcodedNumberCellCount?: number };
  };
  return summary.numberCandidateCount ?? summary.workbook?.numericCellCount ?? summary.workbook?.hardcodedNumberCellCount ?? 0;
}

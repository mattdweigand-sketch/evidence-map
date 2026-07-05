import type { EvidenceMapStore } from "../db/store.ts";
import { buildLegalRunArtifacts } from "../legal/artifacts.ts";
import { applyLegalConflictReviewDecisions, applyLegalRiskAcceptanceDecisions } from "../legal/review-decisions.ts";
import { buildLegalReuseFindings } from "../legal/reuse-library.ts";
import { buildLegalDraftDisciplineFindings, buildLegalTrustFindings } from "../legal/trust.ts";
import type { LegalReviewDecisionRecord } from "../legal/types.ts";
import {
  applyGeneralClaimReviewDecisions,
  applyGeneralConflictReviewDecisions,
  applyGeneralRiskAcceptanceDecisions,
  type GeneralReviewDecisionRecord
} from "../review/general-decisions.ts";
import type { VerificationFinding } from "../types.ts";
import { workbookInspectionFindings } from "./workbook-findings.ts";

export async function runHostileReview(
  store: EvidenceMapStore,
  runId: string
): Promise<VerificationFinding[]> {
  return store.createVerificationFindings(runId, await buildHostileReviewFindings(store, runId));
}

export async function buildHostileReviewFindings(
  store: EvidenceMapStore,
  runId: string,
  options: {
    legalReviewDecisions?: LegalReviewDecisionRecord[];
    generalReviewDecisions?: GeneralReviewDecisionRecord[];
  } = {}
): Promise<Omit<VerificationFinding, "id" | "runId">[]> {
  const run = await store.getRun(runId);
  const sources = await store.listSources(runId);
  const inspections = await store.listFileInspections(runId);
  const storedConflicts = await store.listSourceConflicts(runId);
  const storedClaims = await store.listClaims(runId);
  const calculations = await store.listCalculations(runId);
  const assumptions = await store.listAssumptions(runId);
  const legalReviewDecisions = run?.profile === "legal" ? options.legalReviewDecisions ?? [] : [];
  const generalReviewDecisions = run?.profile === "general" ? options.generalReviewDecisions ?? [] : [];
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

  let findings: Omit<VerificationFinding, "id" | "runId">[] = [];
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
      reviewDecisions: legalReviewDecisions
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

function mustFix(location: string, issue: string, evidence: string, recommendedRepair: string): Omit<VerificationFinding, "id" | "runId"> {
  return {
    location,
    issue,
    severity: "must_fix",
    evidence,
    recommendedRepair,
    humanReviewRequired: true
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

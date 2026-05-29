import type { TruthLayerStore } from "../db/store.ts";
import type { VerificationFinding } from "../types.ts";
import { workbookInspectionFindings } from "./workbook-findings.ts";

export async function runHostileReview(
  store: TruthLayerStore,
  runId: string
): Promise<VerificationFinding[]> {
  const sources = await store.listSources(runId);
  const inspections = await store.listFileInspections(runId);
  const conflicts = await store.listSourceConflicts(runId);
  const claims = await store.listClaims(runId);
  const calculations = await store.listCalculations(runId);
  const assumptions = await store.listAssumptions(runId);

  const findings: Omit<VerificationFinding, "id" | "runId">[] = [];

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
  }

  return store.createVerificationFindings(runId, findings);
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

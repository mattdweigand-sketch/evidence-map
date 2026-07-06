import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CalculationRecord, ClaimRecord, EvidenceMapRun, ReviewStatus, SourceConflict, VerificationFinding } from "../types.ts";

export const GENERAL_REVIEW_APPROVAL_TOKEN = "APPROVE_GENERAL_REVIEW_DECISION";

export type GeneralReviewDecisionAction =
  | "create_claim"
  | "edit_claim"
  | "attach_claim_source"
  | "delete_claim"
  | "merge_claims"
  | "resolve_calculation_risk"
  | "accept_general_risk"
  | "resolve_source_conflict";

interface GeneralReviewDecisionBase {
  id: string;
  runId: string;
  action: GeneralReviewDecisionAction;
  reviewer?: string;
  createdAt: string;
  approvalTokenAccepted: true;
  notes?: string;
}

export interface GeneralAttachClaimSourceDecision extends GeneralReviewDecisionBase {
  action: "attach_claim_source";
  claimId: string;
  sourceId: string;
  reviewStatus: "needs_review" | "verified";
  evidenceAnchor?: string;
  evidenceQuote?: string;
  rationale?: string;
}

export interface GeneralCreateClaimDecision extends GeneralReviewDecisionBase {
  action: "create_claim";
  claimId: string;
  artifactLocation: string;
  claim: string;
  sourceIds: string[];
  assumptions: string[];
  transformation?: string;
  reviewStatus: ReviewStatus;
}

export interface GeneralEditClaimDecision extends GeneralReviewDecisionBase {
  action: "edit_claim";
  claimId: string;
  artifactLocation?: string;
  claim?: string;
  sourceIds?: string[];
  assumptions?: string[];
  transformation?: string;
  reviewStatus?: ReviewStatus;
}

export interface GeneralDeleteClaimDecision extends GeneralReviewDecisionBase {
  action: "delete_claim";
  claimId: string;
  reason: string;
}

export interface GeneralMergeClaimsDecision extends GeneralReviewDecisionBase {
  action: "merge_claims";
  targetClaimId: string;
  mergedClaimIds: string[];
  claim?: string;
  sourceIds?: string[];
  assumptions?: string[];
  transformation?: string;
  reviewStatus?: ReviewStatus;
  reason: string;
}

export interface GeneralResolveCalculationRiskDecision extends GeneralReviewDecisionBase {
  action: "resolve_calculation_risk";
  calculationId: string;
  riskFlags: string[];
  inputs: string[];
  resolution: string;
  reviewStatus: "needs_review" | "verified";
}

export interface GeneralAcceptRiskDecision extends GeneralReviewDecisionBase {
  action: "accept_general_risk";
  location: string;
  issue: string;
  reason: string;
}

export interface GeneralResolveSourceConflictDecision extends GeneralReviewDecisionBase {
  action: "resolve_source_conflict";
  conflictId: string;
  resolution: string;
}

export type GeneralReviewDecisionRecord =
  | GeneralCreateClaimDecision
  | GeneralEditClaimDecision
  | GeneralAttachClaimSourceDecision
  | GeneralDeleteClaimDecision
  | GeneralMergeClaimsDecision
  | GeneralResolveCalculationRiskDecision
  | GeneralAcceptRiskDecision
  | GeneralResolveSourceConflictDecision;

export interface GeneralReviewAuditEvent {
  id: string;
  runId: string;
  decisionId: string;
  action: GeneralReviewDecisionAction;
  actor?: string;
  createdAt: string;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface GeneralReviewDecisionSet {
  runId: string;
  profile: "general";
  decisions: GeneralReviewDecisionRecord[];
  auditEvents: GeneralReviewAuditEvent[];
}

export async function readGeneralReviewDecisionSet(input: {
  baseDir: string;
  run: Pick<EvidenceMapRun, "id" | "slug">;
}): Promise<GeneralReviewDecisionSet> {
  try {
    const raw = await readFile(generalReviewDecisionSetPath(input.baseDir, input.run.slug), "utf8");
    return normalizeDecisionSet(input.run.id, JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyGeneralReviewDecisionSet(input.run.id);
    }
    throw error;
  }
}

export function generalReviewDecisionSetPath(baseDir: string, runSlug: string) {
  return join(baseDir, "deliverables", runSlug, "03_verification", "general-review-decisions.json");
}

export function applyGeneralClaimReviewDecisions(input: {
  claims: ClaimRecord[];
  decisions: GeneralReviewDecisionRecord[];
}): ClaimRecord[] {
  if (input.decisions.length === 0) return input.claims;
  return input.decisions.reduce((claims, decision) => applyDecisionToClaims(claims, decision), input.claims);
}

export function applyGeneralCalculationReviewDecisions(input: {
  calculations: CalculationRecord[];
  decisions: GeneralReviewDecisionRecord[];
}): CalculationRecord[] {
  if (input.decisions.length === 0) return input.calculations;
  return input.calculations.map((calculation) =>
    input.decisions.reduce((current, decision) => applyDecisionToCalculation(current, decision), calculation)
  );
}

export function applyGeneralConflictReviewDecisions(input: {
  conflicts: SourceConflict[];
  decisions: GeneralReviewDecisionRecord[];
}): SourceConflict[] {
  if (input.decisions.length === 0) return input.conflicts;
  return input.conflicts.map((conflict) =>
    input.decisions.reduce((current, decision) => applyDecisionToConflict(current, decision), conflict)
  );
}

export function applyGeneralRiskAcceptanceDecisions<T extends Omit<VerificationFinding, "id" | "runId">>(input: {
  findings: T[];
  decisions: GeneralReviewDecisionRecord[];
}): T[] {
  const acceptances = input.decisions.filter((decision): decision is GeneralAcceptRiskDecision => decision.action === "accept_general_risk");
  if (acceptances.length === 0) return input.findings;

  return input.findings.map((finding) => {
    const decision = acceptances.find((item) => riskDecisionMatchesFinding(item, finding));
    if (!decision) return finding;
    return {
      ...finding,
      severity: "polish" as const,
      evidence: appendNote(finding.evidence, `Accepted general review risk by ${decision.id}. Reason: ${decision.reason}`),
      recommendedRepair: `Accepted or carried by general review decision ${decision.id}.`,
      humanReviewRequired: false
    };
  });
}

export function appendCreateClaimDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  claims: ClaimRecord[];
  sources: Array<{ id: string }>;
  artifactLocation: string;
  claim: string;
  sourceIds?: string[];
  assumptions?: string[];
  transformation?: string;
  reviewStatus?: ReviewStatus;
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  assertKnownSources(input.sources, input.sourceIds ?? []);

  const sourceIds = uniqueSorted(input.sourceIds ?? []);
  const assumptions = input.assumptions ?? [];
  const reviewStatus = input.reviewStatus ?? "needs_review";
  const claimId = stableRecordId("general_claim", [
    input.decisionSet.runId,
    input.artifactLocation,
    input.claim,
    ...sourceIds,
    ...assumptions,
    input.transformation ?? "",
    reviewStatus
  ]);
  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "create_claim",
    parts: [claimId]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const existingClaim = input.claims.find((claim) => claim.id === claimId);
  if (existingDecision || existingClaim) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: GeneralCreateClaimDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "create_claim",
    claimId,
    artifactLocation: input.artifactLocation,
    claim: input.claim,
    sourceIds,
    assumptions,
    transformation: input.transformation,
    reviewStatus,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const createdClaim = claimFromCreateDecision(input.decisionSet.runId, decision);
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Created general claim ${claimId}.`,
    before: {},
    after: claimAuditState(createdClaim)
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function appendEditClaimDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  claims: ClaimRecord[];
  sources: Array<{ id: string }>;
  claimId: string;
  artifactLocation?: string;
  claim?: string;
  sourceIds?: string[];
  assumptions?: string[];
  transformation?: string;
  reviewStatus?: ReviewStatus;
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const claim = input.claims.find((item) => item.id === input.claimId);
  if (!claim) throw new Error(`Unknown claim: ${input.claimId}`);
  if (
    input.artifactLocation === undefined &&
    input.claim === undefined &&
    input.sourceIds === undefined &&
    input.assumptions === undefined &&
    input.transformation === undefined &&
    input.reviewStatus === undefined
  ) {
    throw new Error("At least one claim field must be supplied for editing.");
  }
  if (input.sourceIds) assertKnownSources(input.sources, input.sourceIds);

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "edit_claim",
    parts: [
      input.claimId,
      input.artifactLocation ?? "",
      input.claim ?? "",
      ...(input.sourceIds ? uniqueSorted(input.sourceIds) : []),
      ...(input.assumptions ?? []),
      input.transformation ?? "",
      input.reviewStatus ?? ""
    ]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const draftDecision: GeneralEditClaimDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "edit_claim",
    claimId: input.claimId,
    artifactLocation: input.artifactLocation,
    claim: input.claim,
    sourceIds: input.sourceIds ? uniqueSorted(input.sourceIds) : undefined,
    assumptions: input.assumptions,
    transformation: input.transformation,
    reviewStatus: input.reviewStatus,
    reviewer: input.reviewer,
    createdAt: input.now ?? new Date().toISOString(),
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const updatedClaim = applyDecisionToClaim(claim, draftDecision);
  if (existingDecision || claimsEqual(claim, updatedClaim)) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = draftDecision.createdAt;
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision: draftDecision,
    reviewer: input.reviewer,
    now,
    summary: `Edited general claim ${input.claimId}.`,
    before: claimAuditState(claim),
    after: claimAuditState(updatedClaim)
  });

  return {
    decisionSet: appendDecision(input.decisionSet, draftDecision, auditEvent),
    decision: draftDecision,
    auditEvent,
    changed: true
  };
}

export function appendDeleteClaimDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  claims: ClaimRecord[];
  claimId: string;
  reason: string;
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const reason = input.reason.trim();
  if (!reason) throw new Error("A deletion reason is required.");

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "delete_claim",
    parts: [input.claimId, reason]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  if (existingDecision) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const claim = input.claims.find((item) => item.id === input.claimId);
  if (!claim) throw new Error(`Unknown claim: ${input.claimId}`);

  const now = input.now ?? new Date().toISOString();
  const decision: GeneralDeleteClaimDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "delete_claim",
    claimId: input.claimId,
    reason,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Deleted general claim ${input.claimId}.`,
    before: claimAuditState(claim),
    after: {
      id: input.claimId,
      deleted: true,
      reason
    }
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function appendMergeClaimsDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  claims: ClaimRecord[];
  sources: Array<{ id: string }>;
  targetClaimId: string;
  mergedClaimIds: string[];
  claim?: string;
  sourceIds?: string[];
  assumptions?: string[];
  transformation?: string;
  reviewStatus?: ReviewStatus;
  reason: string;
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const reason = input.reason.trim();
  if (!reason) throw new Error("A merge reason is required.");
  const mergedClaimIds = uniqueSorted(input.mergedClaimIds);
  if (mergedClaimIds.length === 0) throw new Error("At least one merged claim is required.");
  if (mergedClaimIds.includes(input.targetClaimId)) throw new Error("A claim cannot be merged into itself.");
  const sourceIds = input.sourceIds ? uniqueSorted(input.sourceIds) : undefined;
  const assumptions = input.assumptions ? uniqueSorted(input.assumptions) : undefined;

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "merge_claims",
    parts: [
      input.targetClaimId,
      ...mergedClaimIds,
      input.claim ?? "",
      ...(sourceIds ?? []),
      ...(assumptions ?? []),
      input.transformation ?? "",
      input.reviewStatus ?? "",
      reason
    ]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  if (existingDecision) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }
  if (sourceIds) assertKnownSources(input.sources, sourceIds);

  const targetClaim = input.claims.find((item) => item.id === input.targetClaimId);
  if (!targetClaim) throw new Error(`Unknown target claim: ${input.targetClaimId}`);
  const mergedClaims = mergedClaimIds.map((claimId) => input.claims.find((item) => item.id === claimId));
  const missingClaimIds = mergedClaimIds.filter((_, index) => !mergedClaims[index]);
  if (missingClaimIds.length > 0) throw new Error(`Unknown merged claim: ${missingClaimIds.join(", ")}`);

  const now = input.now ?? new Date().toISOString();
  const decision: GeneralMergeClaimsDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "merge_claims",
    targetClaimId: input.targetClaimId,
    mergedClaimIds,
    claim: input.claim,
    sourceIds,
    assumptions,
    transformation: input.transformation,
    reviewStatus: input.reviewStatus,
    reason,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const concreteMergedClaims = mergedClaims.filter((claim): claim is ClaimRecord => Boolean(claim));
  const updatedClaim = applyMergeDecisionToClaim(targetClaim, concreteMergedClaims, decision);
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Merged general claims ${mergedClaimIds.join(", ")} into ${input.targetClaimId}.`,
    before: {
      target: claimAuditState(targetClaim),
      mergedClaims: concreteMergedClaims.map(claimAuditState)
    },
    after: {
      target: claimAuditState(updatedClaim),
      removedClaimIds: mergedClaimIds,
      reason
    }
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function appendAttachClaimSourceDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  claims: ClaimRecord[];
  sources: Array<{ id: string }>;
  claimId: string;
  sourceId: string;
  reviewStatus?: GeneralAttachClaimSourceDecision["reviewStatus"];
  evidenceAnchor?: string;
  evidenceQuote?: string;
  rationale?: string;
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const claim = input.claims.find((item) => item.id === input.claimId);
  if (!claim) throw new Error(`Unknown claim: ${input.claimId}`);
  const source = input.sources.find((item) => item.id === input.sourceId);
  if (!source) throw new Error(`Unknown source: ${input.sourceId}`);

  const reviewStatus = input.reviewStatus ?? "needs_review";
  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "attach_claim_source",
    parts: [input.claimId, input.sourceId, reviewStatus, input.evidenceAnchor ?? "", input.evidenceQuote ?? "", input.rationale ?? ""]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  if (existingDecision) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: GeneralAttachClaimSourceDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "attach_claim_source",
    claimId: input.claimId,
    sourceId: input.sourceId,
    reviewStatus,
    evidenceAnchor: input.evidenceAnchor,
    evidenceQuote: input.evidenceQuote,
    rationale: input.rationale,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const updatedClaim = applyDecisionToClaim(claim, decision);
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Attached ${input.sourceId} as support for claim ${input.claimId}${input.evidenceAnchor ? ` at ${input.evidenceAnchor}` : ""}.`,
    before: claimAuditState(claim),
    after: claimAuditState(updatedClaim)
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function appendResolveCalculationRiskDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  calculations: CalculationRecord[];
  calculationId: string;
  riskFlags: string[];
  inputs?: string[];
  resolution: string;
  reviewStatus?: GeneralResolveCalculationRiskDecision["reviewStatus"];
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const calculation = input.calculations.find((item) => item.id === input.calculationId);
  if (!calculation) throw new Error(`Unknown calculation: ${input.calculationId}`);
  const riskFlags = uniqueSorted(input.riskFlags);
  if (riskFlags.length === 0) throw new Error("At least one calculation risk flag is required.");

  const reviewStatus = input.reviewStatus ?? "verified";
  const inputs = uniqueSorted(input.inputs ?? []);
  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "resolve_calculation_risk",
    parts: [input.calculationId, ...riskFlags, ...inputs, input.resolution, reviewStatus]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const alreadyApplied = riskFlags.every((flag) => !calculation.riskFlags.includes(flag)) && inputs.every((item) => calculation.inputs.includes(item));
  if (existingDecision || alreadyApplied) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }
  const unknownFlags = riskFlags.filter((flag) => !calculation.riskFlags.includes(flag));
  if (unknownFlags.length > 0) {
    throw new Error(`Calculation risk is not active: ${unknownFlags.join(", ")}`);
  }

  const now = input.now ?? new Date().toISOString();
  const decision: GeneralResolveCalculationRiskDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "resolve_calculation_risk",
    calculationId: input.calculationId,
    riskFlags,
    inputs,
    resolution: input.resolution,
    reviewStatus,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const updatedCalculation = applyDecisionToCalculation(calculation, decision);
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Resolved calculation risk for ${input.calculationId}: ${riskFlags.join(", ")}.`,
    before: calculationAuditState(calculation),
    after: calculationAuditState(updatedCalculation)
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function appendGeneralRiskAcceptanceDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  findings: Array<Omit<VerificationFinding, "id" | "runId">>;
  location: string;
  issue: string;
  reason: string;
  reviewer?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const matchedFinding = input.findings.find((finding) =>
    riskDecisionMatchesFinding({ location: input.location, issue: input.issue } as GeneralAcceptRiskDecision, finding)
  );
  if (!matchedFinding) throw new Error("No current general finding matches the requested risk acceptance.");

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "accept_general_risk",
    parts: [input.location, input.issue]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  if (existingDecision) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: GeneralAcceptRiskDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "accept_general_risk",
    location: input.location,
    issue: input.issue,
    reason: input.reason,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true
  };
  const acceptedFinding = applyGeneralRiskAcceptanceDecisions({ findings: [matchedFinding], decisions: [decision] })[0] ?? matchedFinding;
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Accepted general review risk at ${input.location}: ${input.issue}.`,
    before: findingAuditState(matchedFinding),
    after: findingAuditState(acceptedFinding)
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function appendGeneralSourceConflictDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  conflicts: SourceConflict[];
  conflictId: string;
  resolution: string;
  reviewer?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const conflict = input.conflicts.find((item) => item.id === input.conflictId);
  if (!conflict) throw new Error(`Unknown source conflict: ${input.conflictId}`);

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "resolve_source_conflict",
    parts: [input.conflictId, input.resolution]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const resolved = conflict.status === "resolved" && conflict.resolution === input.resolution;
  if (existingDecision || resolved) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: GeneralResolveSourceConflictDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "resolve_source_conflict",
    conflictId: input.conflictId,
    resolution: input.resolution,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true
  };
  const updatedConflict = applyDecisionToConflict(conflict, decision);
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Resolved source conflict ${conflict.id}.`,
    before: conflictAuditState(conflict),
    after: conflictAuditState(updatedConflict)
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function renderGeneralReviewDecisionSet(decisionSet: GeneralReviewDecisionSet) {
  const rows = decisionSet.auditEvents.length
    ? decisionSet.auditEvents
        .map(
          (event) =>
            `| ${escapeCell(event.id)} | ${escapeCell(event.createdAt)} | ${event.action} | ${escapeCell(event.actor ?? "")} | ${escapeCell(event.summary)} |`
        )
        .join("\n")
    : "| none |  |  |  | No general review decisions. |";

  return `# General Review Decisions

This artifact records explicit general-profile review-state changes.

Decisions: ${decisionSet.decisions.length}

Audit events: ${decisionSet.auditEvents.length}

| Event ID | Created | Action | Actor | Summary |
|---|---|---|---|---|
${rows}
`;
}

function applyDecisionToClaims(claims: ClaimRecord[], decision: GeneralReviewDecisionRecord): ClaimRecord[] {
  if (decision.action === "create_claim") {
    if (claims.some((claim) => claim.id === decision.claimId)) return claims;
    return [...claims, claimFromCreateDecision(decision.runId, decision)];
  }

  if (decision.action === "delete_claim") {
    return claims.filter((claim) => claim.id !== decision.claimId);
  }

  if (decision.action === "merge_claims") {
    return applyMergeDecisionToClaims(claims, decision);
  }

  if (decision.action === "edit_claim" || decision.action === "attach_claim_source") {
    return claims.map((claim) => applyDecisionToClaim(claim, decision));
  }

  return claims;
}

function applyDecisionToClaim(claim: ClaimRecord, decision: GeneralReviewDecisionRecord): ClaimRecord {
  if (decision.action === "attach_claim_source" && decision.claimId === claim.id) {
    return {
      ...claim,
      sourceIds: appendUnique(claim.sourceIds, decision.sourceId),
      reviewStatus: decision.reviewStatus
    };
  }

  if (decision.action === "edit_claim" && decision.claimId === claim.id) {
    return {
      ...claim,
      artifactLocation: decision.artifactLocation ?? claim.artifactLocation,
      claim: decision.claim ?? claim.claim,
      sourceIds: decision.sourceIds ?? claim.sourceIds,
      assumptions: decision.assumptions ?? claim.assumptions,
      transformation: decision.transformation ?? claim.transformation,
      reviewStatus: decision.reviewStatus ?? claim.reviewStatus
    };
  }

  return claim;
}

function applyMergeDecisionToClaims(claims: ClaimRecord[], decision: GeneralMergeClaimsDecision): ClaimRecord[] {
  const mergedClaimIds = new Set(decision.mergedClaimIds);
  const targetClaim = claims.find((claim) => claim.id === decision.targetClaimId);
  const mergedClaims = claims.filter((claim) => mergedClaimIds.has(claim.id));
  if (!targetClaim) return claims.filter((claim) => !mergedClaimIds.has(claim.id));
  const updatedTarget = applyMergeDecisionToClaim(targetClaim, mergedClaims, decision);
  return claims.flatMap((claim) => {
    if (claim.id === decision.targetClaimId) return [updatedTarget];
    if (mergedClaimIds.has(claim.id)) return [];
    return [claim];
  });
}

function applyMergeDecisionToClaim(
  targetClaim: ClaimRecord,
  mergedClaims: ClaimRecord[],
  decision: GeneralMergeClaimsDecision
): ClaimRecord {
  const allClaims = [targetClaim, ...mergedClaims];
  return {
    ...targetClaim,
    claim: decision.claim ?? targetClaim.claim,
    sourceIds: decision.sourceIds ?? uniqueSorted(allClaims.flatMap((claim) => claim.sourceIds)),
    assumptions: decision.assumptions ?? uniqueSorted(allClaims.flatMap((claim) => claim.assumptions)),
    transformation: decision.transformation ?? deriveMergedTransformation(targetClaim, mergedClaims),
    reviewStatus: decision.reviewStatus ?? deriveMergedReviewStatus(allClaims)
  };
}

function applyDecisionToCalculation(calculation: CalculationRecord, decision: GeneralReviewDecisionRecord): CalculationRecord {
  if (decision.action !== "resolve_calculation_risk" || decision.calculationId !== calculation.id) return calculation;
  const remainingRiskFlags = calculation.riskFlags.filter((flag) => !decision.riskFlags.includes(flag));
  return {
    ...calculation,
    inputs: appendUniqueMany(calculation.inputs, decision.inputs),
    riskFlags: remainingRiskFlags,
    reviewStatus: remainingRiskFlags.length === 0 ? decision.reviewStatus : calculation.reviewStatus
  };
}

function claimFromCreateDecision(runId: string, decision: GeneralCreateClaimDecision): ClaimRecord {
  return {
    id: decision.claimId,
    runId,
    artifactLocation: decision.artifactLocation,
    claim: decision.claim,
    sourceIds: decision.sourceIds,
    assumptions: decision.assumptions,
    transformation: decision.transformation,
    reviewStatus: decision.reviewStatus
  };
}

function applyDecisionToConflict(conflict: SourceConflict, decision: GeneralReviewDecisionRecord): SourceConflict {
  if (decision.action !== "resolve_source_conflict" || decision.conflictId !== conflict.id) return conflict;
  return {
    ...conflict,
    status: "resolved",
    resolution: decision.resolution
  };
}

function buildAuditEvent(input: {
  runId: string;
  decision: GeneralReviewDecisionRecord;
  reviewer?: string;
  now: string;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): GeneralReviewAuditEvent {
  return {
    id: `general_review_audit_${hashKey(`${input.decision.id}|${input.now}`)}`,
    runId: input.runId,
    decisionId: input.decision.id,
    action: input.decision.action,
    actor: input.reviewer,
    createdAt: input.now,
    summary: input.summary,
    before: input.before,
    after: input.after
  };
}

function appendDecision(
  decisionSet: GeneralReviewDecisionSet,
  decision: GeneralReviewDecisionRecord,
  auditEvent: GeneralReviewAuditEvent
): GeneralReviewDecisionSet {
  return {
    ...decisionSet,
    decisions: [...decisionSet.decisions, decision],
    auditEvents: [...decisionSet.auditEvents, auditEvent]
  };
}

function normalizeDecisionSet(runId: string, value: unknown): GeneralReviewDecisionSet {
  if (!value || typeof value !== "object") return emptyGeneralReviewDecisionSet(runId);
  const candidate = value as Partial<GeneralReviewDecisionSet>;
  return {
    runId,
    profile: "general",
    decisions: Array.isArray(candidate.decisions)
      ? candidate.decisions.filter(isReviewDecision).map((decision) => ({ ...decision, runId }))
      : [],
    auditEvents: Array.isArray(candidate.auditEvents)
      ? candidate.auditEvents.filter(isAuditEvent).map((event) => ({ ...event, runId }))
      : []
  };
}

export function emptyGeneralReviewDecisionSet(runId: string): GeneralReviewDecisionSet {
  return {
    runId,
    profile: "general",
    decisions: [],
    auditEvents: []
  };
}

function isReviewDecision(value: unknown): value is GeneralReviewDecisionRecord {
  const decision = value as Partial<GeneralReviewDecisionRecord>;
  if (!hasDecisionBase(decision)) return false;
  if (decision.action === "attach_claim_source") {
    return typeof decision.claimId === "string" && typeof decision.sourceId === "string" && typeof decision.reviewStatus === "string";
  }
  if (decision.action === "create_claim") {
    return (
      typeof decision.claimId === "string" &&
      typeof decision.artifactLocation === "string" &&
      typeof decision.claim === "string" &&
      Array.isArray(decision.sourceIds) &&
      Array.isArray(decision.assumptions) &&
      typeof decision.reviewStatus === "string"
    );
  }
  if (decision.action === "edit_claim") {
    return typeof decision.claimId === "string";
  }
  if (decision.action === "delete_claim") {
    return typeof decision.claimId === "string" && typeof decision.reason === "string";
  }
  if (decision.action === "merge_claims") {
    return (
      typeof decision.targetClaimId === "string" &&
      Array.isArray(decision.mergedClaimIds) &&
      typeof decision.reason === "string"
    );
  }
  if (decision.action === "resolve_calculation_risk") {
    return (
      typeof decision.calculationId === "string" &&
      Array.isArray(decision.riskFlags) &&
      Array.isArray(decision.inputs) &&
      typeof decision.resolution === "string" &&
      typeof decision.reviewStatus === "string"
    );
  }
  if (decision.action === "accept_general_risk") {
    return typeof decision.location === "string" && typeof decision.issue === "string" && typeof decision.reason === "string";
  }
  if (decision.action === "resolve_source_conflict") {
    return typeof decision.conflictId === "string" && typeof decision.resolution === "string";
  }
  return false;
}

function isAuditEvent(value: unknown): value is GeneralReviewAuditEvent {
  const event = value as Partial<GeneralReviewAuditEvent>;
  return (
    Boolean(event) &&
    typeof event.action === "string" &&
    typeof event.id === "string" &&
    typeof event.decisionId === "string" &&
    typeof event.createdAt === "string" &&
    typeof event.summary === "string"
  );
}

function hasDecisionBase(value: Partial<GeneralReviewDecisionRecord>) {
  return Boolean(value) && typeof value.id === "string" && typeof value.runId === "string" && typeof value.createdAt === "string";
}

function requireApproval(approvalToken: string) {
  if (approvalToken !== GENERAL_REVIEW_APPROVAL_TOKEN) {
    throw new Error(`General review changes require approvalToken ${GENERAL_REVIEW_APPROVAL_TOKEN}.`);
  }
}

function stableDecisionId(input: { runId: string; action: GeneralReviewDecisionAction; parts: string[] }) {
  return `general_review_decision_${hashKey([input.runId, input.action, ...input.parts].join("|"))}`;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function riskDecisionMatchesFinding(
  decision: Pick<GeneralAcceptRiskDecision, "location" | "issue">,
  finding: Pick<VerificationFinding, "location" | "issue">
) {
  return decision.location === finding.location && decision.issue === finding.issue;
}

function appendUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value];
}

function appendUniqueMany(values: string[], additions: string[]) {
  return additions.reduce((current, value) => appendUnique(current, value), values);
}

function appendNote(existing: string | undefined, note: string) {
  return existing ? `${existing} ${note}` : note;
}

function deriveMergedTransformation(targetClaim: ClaimRecord, mergedClaims: ClaimRecord[]) {
  const transformations = uniqueSorted(
    [targetClaim.transformation, ...mergedClaims.map((claim) => claim.transformation)].filter(isNonEmptyString)
  );
  if (transformations.length > 0) return transformations.join(" | ");
  if (mergedClaims.length > 0) return `Merged from ${uniqueSorted(mergedClaims.map((claim) => claim.id)).join(", ")}.`;
  return targetClaim.transformation;
}

function deriveMergedReviewStatus(claims: ClaimRecord[]): ReviewStatus {
  const conservativeOrder: ReviewStatus[] = ["unsupported", "conflicting", "needs_review", "unreviewed", "verified"];
  return conservativeOrder.find((status) => claims.some((claim) => claim.reviewStatus === status)) ?? "needs_review";
}

function claimAuditState(claim: ClaimRecord) {
  return {
    id: claim.id,
    artifactLocation: claim.artifactLocation,
    claim: claim.claim,
    sourceIds: claim.sourceIds,
    assumptions: claim.assumptions,
    transformation: claim.transformation,
    reviewStatus: claim.reviewStatus
  };
}

function calculationAuditState(calculation: CalculationRecord) {
  return {
    id: calculation.id,
    artifactLocation: calculation.artifactLocation,
    inputs: calculation.inputs,
    riskFlags: calculation.riskFlags,
    reviewStatus: calculation.reviewStatus
  };
}

function findingAuditState(finding: Omit<VerificationFinding, "id" | "runId">) {
  return {
    location: finding.location,
    issue: finding.issue,
    severity: finding.severity,
    humanReviewRequired: finding.humanReviewRequired
  };
}

function conflictAuditState(conflict: SourceConflict) {
  return {
    id: conflict.id,
    status: conflict.status,
    severity: conflict.severity,
    resolution: conflict.resolution
  };
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function assertKnownSources(sources: Array<{ id: string }>, sourceIds: string[]) {
  const knownSourceIds = new Set(sources.map((source) => source.id));
  const unknownSourceIds = sourceIds.filter((sourceId) => !knownSourceIds.has(sourceId));
  if (unknownSourceIds.length > 0) throw new Error(`Unknown source: ${unknownSourceIds.join(", ")}`);
}

function stableRecordId(prefix: string, parts: string[]) {
  return `${prefix}_${hashKey(parts.join("|"))}`;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value);
}

function claimsEqual(left: ClaimRecord, right: ClaimRecord) {
  return JSON.stringify(claimAuditState(left)) === JSON.stringify(claimAuditState(right));
}

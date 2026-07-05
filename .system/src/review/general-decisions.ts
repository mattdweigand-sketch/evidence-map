import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClaimRecord, EvidenceMapRun, SourceConflict, VerificationFinding } from "../types.ts";

export const GENERAL_REVIEW_APPROVAL_TOKEN = "APPROVE_GENERAL_REVIEW_DECISION";

export type GeneralReviewDecisionAction = "attach_claim_source" | "accept_general_risk" | "resolve_source_conflict";

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
  | GeneralAttachClaimSourceDecision
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
  return input.claims.map((claim) => input.decisions.reduce((current, decision) => applyDecisionToClaim(current, decision), claim));
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

export function appendAttachClaimSourceDecision(input: {
  decisionSet: GeneralReviewDecisionSet;
  claims: ClaimRecord[];
  sources: Array<{ id: string }>;
  claimId: string;
  sourceId: string;
  reviewStatus?: GeneralAttachClaimSourceDecision["reviewStatus"];
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
    parts: [input.claimId, input.sourceId, reviewStatus]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const alreadyApplied = claim.sourceIds.includes(input.sourceId) && claim.reviewStatus === reviewStatus;
  if (existingDecision || alreadyApplied) {
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
    summary: `Attached ${input.sourceId} as support for claim ${input.claimId}.`,
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

function applyDecisionToClaim(claim: ClaimRecord, decision: GeneralReviewDecisionRecord): ClaimRecord {
  if (decision.action !== "attach_claim_source" || decision.claimId !== claim.id) return claim;
  return {
    ...claim,
    sourceIds: appendUnique(claim.sourceIds, decision.sourceId),
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

function appendNote(existing: string | undefined, note: string) {
  return existing ? `${existing} ${note}` : note;
}

function claimAuditState(claim: ClaimRecord) {
  return {
    id: claim.id,
    artifactLocation: claim.artifactLocation,
    sourceIds: claim.sourceIds,
    reviewStatus: claim.reviewStatus
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

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceMapRun, SourceConflict, VerificationFinding } from "../types.ts";
import type { LegalSourcePacket } from "./source-packet.ts";
import type {
  LegalAcceptRiskDecision,
  LegalAttachPassageSupportDecision,
  LegalEvidenceMap,
  LegalPassageRecord,
  LegalPropositionRecord,
  LegalReviewAuditEvent,
  LegalReviewDecisionRecord,
  LegalReviewDecisionSet,
  LegalSourceRecord,
  LegalUpdateSourceAuthorityDecision,
  LegalUpdateSourceTreatmentDecision,
  LegalResolveSourceConflictDecision
} from "./types.ts";

export const LEGAL_REVIEW_APPROVAL_TOKEN = "APPROVE_LEGAL_REVIEW_DECISION";

export async function readLegalReviewDecisionSet(input: {
  baseDir: string;
  run: Pick<EvidenceMapRun, "id" | "slug">;
}): Promise<LegalReviewDecisionSet> {
  try {
    const raw = await readFile(legalReviewDecisionSetPath(input.baseDir, input.run.slug), "utf8");
    return normalizeDecisionSet(input.run.id, JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyDecisionSet(input.run.id);
    }
    throw error;
  }
}

export function legalReviewDecisionSetPath(baseDir: string, runSlug: string) {
  return join(baseDir, "deliverables", runSlug, "03_verification", "legal-review-decisions.json");
}

export function applyLegalReviewDecisions(input: {
  legalEvidenceMap: LegalEvidenceMap;
  decisions: LegalReviewDecisionRecord[];
}): LegalEvidenceMap {
  if (input.decisions.length === 0) return input.legalEvidenceMap;
  const propositions = input.legalEvidenceMap.propositions.map((proposition) =>
    input.decisions.reduce((current, decision) => applyDecisionToProposition(current, decision), proposition)
  );
  return {
    ...input.legalEvidenceMap,
    propositions,
    summary: summarizePropositions(propositions),
    notes: [
      ...input.legalEvidenceMap.notes,
      `Phase 4 legal review decisions applied: ${input.decisions.length}.`
    ]
  };
}

export function applyLegalSourceReviewDecisions(input: {
  legalSourcePacket: LegalSourcePacket;
  decisions: LegalReviewDecisionRecord[];
}): LegalSourcePacket {
  if (input.decisions.length === 0) return input.legalSourcePacket;
  return {
    ...input.legalSourcePacket,
    sources: input.legalSourcePacket.sources.map((source) =>
      input.decisions.reduce((current, decision) => applyDecisionToSource(current, decision), source)
    )
  };
}

export function applyLegalConflictReviewDecisions(input: {
  conflicts: SourceConflict[];
  decisions: LegalReviewDecisionRecord[];
}): SourceConflict[] {
  if (input.decisions.length === 0) return input.conflicts;
  return input.conflicts.map((conflict) =>
    input.decisions.reduce((current, decision) => applyDecisionToConflict(current, decision), conflict)
  );
}

export function applyLegalRiskAcceptanceDecisions<T extends Omit<VerificationFinding, "id" | "runId">>(input: {
  findings: T[];
  decisions: LegalReviewDecisionRecord[];
}): T[] {
  const acceptances = input.decisions.filter((decision): decision is LegalAcceptRiskDecision => decision.action === "accept_legal_risk");
  if (acceptances.length === 0) return input.findings;

  return input.findings.map((finding) => {
    const decision = acceptances.find((item) => riskDecisionMatchesFinding(item, finding));
    if (!decision) return finding;
    return {
      ...finding,
      severity: "polish" as const,
      evidence: appendNote(finding.evidence, `Accepted legal risk by ${decision.id}. Reason: ${decision.reason}`),
      recommendedRepair: `Accepted or carried by legal review decision ${decision.id}.`,
      humanReviewRequired: false
    };
  });
}

export function appendAttachPassageSupportDecision(input: {
  decisionSet: LegalReviewDecisionSet;
  legalEvidenceMap: LegalEvidenceMap;
  passages: LegalPassageRecord[];
  propositionId: string;
  passageId: string;
  reviewer?: string;
  pinCite?: string;
  approvalToken: string;
  now?: string;
}): {
  decisionSet: LegalReviewDecisionSet;
  decision?: LegalReviewDecisionRecord;
  auditEvent?: LegalReviewAuditEvent;
  changed: boolean;
  legalEvidenceMap: LegalEvidenceMap;
} {
  if (input.approvalToken !== LEGAL_REVIEW_APPROVAL_TOKEN) {
    throw new Error(`Legal review changes require approvalToken ${LEGAL_REVIEW_APPROVAL_TOKEN}.`);
  }

  const proposition = input.legalEvidenceMap.propositions.find((item) => item.id === input.propositionId);
  if (!proposition) throw new Error(`Unknown legal proposition: ${input.propositionId}`);
  const passage = input.passages.find((item) => item.passageId === input.passageId);
  if (!passage) throw new Error(`Unknown legal passage: ${input.passageId}`);
  if (passage.extractionStatus !== "extracted" && passage.extractionStatus !== "manual") {
    throw new Error(`Legal passage is not citeable support: ${input.passageId}`);
  }

  const pinCite = input.pinCite ?? passage.pinpoint;
  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    propositionId: proposition.id,
    sourceId: passage.sourceId,
    passageId: passage.passageId,
    pinCite
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const alreadyAttached =
    proposition.sourceIds.includes(passage.sourceId) &&
    proposition.passageIds.includes(passage.passageId) &&
    (!pinCite || proposition.pinCites.includes(pinCite));

  if (existingDecision || alreadyAttached) {
    return {
      decisionSet: input.decisionSet,
      changed: false,
      legalEvidenceMap: applyLegalReviewDecisions({
        legalEvidenceMap: input.legalEvidenceMap,
        decisions: input.decisionSet.decisions
      })
    };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: LegalAttachPassageSupportDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "attach_passage_support",
    propositionId: proposition.id,
    sourceId: passage.sourceId,
    passageId: passage.passageId,
    pinCite,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true
  };
  const updatedProposition = applyDecisionToProposition(proposition, decision);
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Attached ${passage.passageId} as support for ${proposition.id}.`,
    before: propositionAuditState(proposition),
    after: propositionAuditState(updatedProposition)
  });
  const decisionSet = appendDecision(input.decisionSet, decision, auditEvent);

  return {
    decisionSet,
    decision,
    auditEvent,
    changed: true,
    legalEvidenceMap: applyLegalReviewDecisions({
      legalEvidenceMap: input.legalEvidenceMap,
      decisions: decisionSet.decisions
    })
  };
}

export function appendSourceAuthorityDecision(input: {
  decisionSet: LegalReviewDecisionSet;
  legalSourcePacket: LegalSourcePacket;
  sourceId: string;
  authorityLevel: LegalUpdateSourceAuthorityDecision["authorityLevel"];
  sourceKind?: LegalUpdateSourceAuthorityDecision["sourceKind"];
  reviewStatus?: LegalUpdateSourceAuthorityDecision["reviewStatus"];
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const source = input.legalSourcePacket.sources.find((item) => item.sourceId === input.sourceId);
  if (!source) throw new Error(`Unknown legal source: ${input.sourceId}`);

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "update_source_authority",
    parts: [input.sourceId, input.authorityLevel, input.sourceKind ?? "", input.reviewStatus ?? ""]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const alreadyApplied =
    source.authorityLevel === input.authorityLevel &&
    (!input.sourceKind || source.sourceKind === input.sourceKind) &&
    (!input.reviewStatus || source.reviewStatus === input.reviewStatus);
  if (existingDecision || alreadyApplied) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: LegalUpdateSourceAuthorityDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "update_source_authority",
    sourceId: input.sourceId,
    authorityLevel: input.authorityLevel,
    sourceKind: input.sourceKind,
    reviewStatus: input.reviewStatus ?? "verified",
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const updatedSource = applyDecisionToSource(source, decision);
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Updated authority classification for ${source.sourceId}.`,
    before: sourceAuditState(source),
    after: sourceAuditState(updatedSource)
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function appendSourceTreatmentDecision(input: {
  decisionSet: LegalReviewDecisionSet;
  legalSourcePacket: LegalSourcePacket;
  sourceId: string;
  treatmentStatus: LegalUpdateSourceTreatmentDecision["treatmentStatus"];
  sourceStatus?: LegalUpdateSourceTreatmentDecision["sourceStatus"];
  reviewStatus?: LegalUpdateSourceTreatmentDecision["reviewStatus"];
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const source = input.legalSourcePacket.sources.find((item) => item.sourceId === input.sourceId);
  if (!source) throw new Error(`Unknown legal source: ${input.sourceId}`);

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "update_source_treatment",
    parts: [input.sourceId, input.treatmentStatus, input.sourceStatus ?? "", input.reviewStatus ?? ""]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const alreadyApplied =
    source.treatmentStatus === input.treatmentStatus &&
    (!input.sourceStatus || source.sourceStatus === input.sourceStatus) &&
    (!input.reviewStatus || source.reviewStatus === input.reviewStatus);
  if (existingDecision || alreadyApplied) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: LegalUpdateSourceTreatmentDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "update_source_treatment",
    sourceId: input.sourceId,
    treatmentStatus: input.treatmentStatus,
    sourceStatus: input.sourceStatus,
    reviewStatus: input.reviewStatus ?? "verified",
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const updatedSource = applyDecisionToSource(source, decision);
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Updated treatment status for ${source.sourceId}.`,
    before: sourceAuditState(source),
    after: sourceAuditState(updatedSource)
  });

  return {
    decisionSet: appendDecision(input.decisionSet, decision, auditEvent),
    decision,
    auditEvent,
    changed: true
  };
}

export function appendLegalRiskAcceptanceDecision(input: {
  decisionSet: LegalReviewDecisionSet;
  findings: Array<Omit<VerificationFinding, "id" | "runId">>;
  location: string;
  issue: string;
  category?: LegalAcceptRiskDecision["category"];
  reason: string;
  reviewer?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const matchedFinding = input.findings.find((finding) =>
    riskDecisionMatchesFinding({ location: input.location, issue: input.issue, category: input.category } as LegalAcceptRiskDecision, finding)
  );
  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "accept_legal_risk",
    parts: [input.location, input.issue, input.category ?? ""]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  if (existingDecision) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }
  if (!matchedFinding) throw new Error("No current legal finding matches the requested risk acceptance.");

  const now = input.now ?? new Date().toISOString();
  const decision: LegalAcceptRiskDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "accept_legal_risk",
    location: input.location,
    issue: input.issue,
    category: input.category,
    reason: input.reason,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true
  };
  const acceptedFinding = applyLegalRiskAcceptanceDecisions({ findings: [matchedFinding], decisions: [decision] })[0] ?? matchedFinding;
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Accepted legal risk at ${input.location}: ${input.issue}.`,
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

export function appendSourceConflictDecision(input: {
  decisionSet: LegalReviewDecisionSet;
  conflicts: SourceConflict[];
  conflictId: string;
  resolution: string;
  carryAsRisk?: boolean;
  reviewer?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const conflict = input.conflicts.find((item) => item.id === input.conflictId);
  if (!conflict) throw new Error(`Unknown source conflict: ${input.conflictId}`);

  const carryAsRisk = input.carryAsRisk ?? false;
  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "resolve_source_conflict",
    parts: [input.conflictId, input.resolution, String(carryAsRisk)]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  const resolved = conflict.status === "resolved" && conflict.resolution === conflictResolutionText(input.resolution, carryAsRisk);
  if (existingDecision || resolved) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: LegalResolveSourceConflictDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "resolve_source_conflict",
    conflictId: input.conflictId,
    resolution: input.resolution,
    carryAsRisk,
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

export function renderLegalReviewDecisionSet(decisionSet: LegalReviewDecisionSet) {
  const rows = decisionSet.auditEvents.length
    ? decisionSet.auditEvents
        .map(
          (event) =>
            `| ${escapeCell(event.id)} | ${escapeCell(event.createdAt)} | ${event.action} | ${escapeCell(event.actor ?? "")} | ${escapeCell(event.summary)} |`
        )
        .join("\n")
    : "| none |  |  |  | No legal review decisions. |";

  return `# Legal Review Decisions

This artifact records explicit legal review-state changes. It is an audit trail, not legal advice.

Decisions: ${decisionSet.decisions.length}

Audit events: ${decisionSet.auditEvents.length}

| Event ID | Created | Action | Actor | Summary |
|---|---|---|---|---|
${rows}
`;
}

function applyDecisionToProposition(
  proposition: LegalPropositionRecord,
  decision: LegalReviewDecisionRecord
): LegalPropositionRecord {
  if (decision.action !== "attach_passage_support" || decision.propositionId !== proposition.id) return proposition;
  return {
    ...proposition,
    sourceIds: appendUnique(proposition.sourceIds, decision.sourceId),
    passageIds: appendUnique(proposition.passageIds, decision.passageId),
    pinCites: decision.pinCite ? appendUnique(proposition.pinCites, decision.pinCite) : proposition.pinCites,
    reviewStatus: proposition.reviewStatus === "unsupported" ? "needs_review" : proposition.reviewStatus,
    notes: appendNote(proposition.notes, `Review decision ${decision.id} attached passage support.`)
  };
}

function applyDecisionToSource(source: LegalSourceRecord, decision: LegalReviewDecisionRecord): LegalSourceRecord {
  if (decision.action === "update_source_authority" && decision.sourceId === source.sourceId) {
    return {
      ...source,
      authorityLevel: decision.authorityLevel,
      sourceKind: decision.sourceKind ?? source.sourceKind,
      reviewStatus: decision.reviewStatus ?? source.reviewStatus,
      notes: appendNote(source.notes, `Review decision ${decision.id} updated authority classification.`)
    };
  }
  if (decision.action === "update_source_treatment" && decision.sourceId === source.sourceId) {
    return {
      ...source,
      treatmentStatus: decision.treatmentStatus,
      sourceStatus: decision.sourceStatus ?? source.sourceStatus,
      reviewStatus: decision.reviewStatus ?? source.reviewStatus,
      notes: appendNote(source.notes, `Review decision ${decision.id} updated treatment status.`)
    };
  }
  return source;
}

function applyDecisionToConflict(conflict: SourceConflict, decision: LegalReviewDecisionRecord): SourceConflict {
  if (decision.action !== "resolve_source_conflict" || decision.conflictId !== conflict.id) return conflict;
  return {
    ...conflict,
    status: "resolved",
    resolution: conflictResolutionText(decision.resolution, decision.carryAsRisk)
  };
}

function buildAuditEvent(input: {
  runId: string;
  decision: LegalReviewDecisionRecord;
  reviewer?: string;
  now: string;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): LegalReviewAuditEvent {
  return {
    id: `legal_review_audit_${hashKey(`${input.decision.id}|${input.now}`)}`,
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
  decisionSet: LegalReviewDecisionSet,
  decision: LegalReviewDecisionRecord,
  auditEvent: LegalReviewAuditEvent
): LegalReviewDecisionSet {
  return {
    ...decisionSet,
    decisions: [...decisionSet.decisions, decision],
    auditEvents: [...decisionSet.auditEvents, auditEvent]
  };
}

function summarizePropositions(propositions: LegalPropositionRecord[]) {
  return {
    propositionCount: propositions.length,
    mappedPropositionCount: propositions.filter((proposition) => proposition.sourceIds.length > 0).length,
    unsupportedPropositionCount: propositions.filter((proposition) => proposition.reviewStatus === "unsupported").length,
    passageSupportedPropositionCount: propositions.filter((proposition) => proposition.passageIds.length > 0 || proposition.pinCites.length > 0).length
  };
}

function normalizeDecisionSet(runId: string, value: unknown): LegalReviewDecisionSet {
  if (!value || typeof value !== "object") return emptyDecisionSet(runId);
  const candidate = value as Partial<LegalReviewDecisionSet>;
  return {
    runId,
    profile: "legal",
    decisions: Array.isArray(candidate.decisions)
      ? candidate.decisions.filter(isReviewDecision).map((decision) => ({ ...decision, runId }))
      : [],
    auditEvents: Array.isArray(candidate.auditEvents)
      ? candidate.auditEvents.filter(isAuditEvent).map((event) => ({ ...event, runId }))
      : []
  };
}

function emptyDecisionSet(runId: string): LegalReviewDecisionSet {
  return {
    runId,
    profile: "legal",
    decisions: [],
    auditEvents: []
  };
}

function isReviewDecision(value: unknown): value is LegalReviewDecisionRecord {
  const decision = value as Partial<LegalReviewDecisionRecord>;
  if (!hasDecisionBase(decision)) return false;
  if (decision.action === "attach_passage_support") {
    return typeof decision.propositionId === "string" && typeof decision.sourceId === "string" && typeof decision.passageId === "string";
  }
  if (decision.action === "update_source_authority") {
    return typeof decision.sourceId === "string" && typeof decision.authorityLevel === "string";
  }
  if (decision.action === "update_source_treatment") {
    return typeof decision.sourceId === "string" && typeof decision.treatmentStatus === "string";
  }
  if (decision.action === "accept_legal_risk") {
    return typeof decision.location === "string" && typeof decision.issue === "string" && typeof decision.reason === "string";
  }
  if (decision.action === "resolve_source_conflict") {
    return typeof decision.conflictId === "string" && typeof decision.resolution === "string" && typeof decision.carryAsRisk === "boolean";
  }
  return false;
}

function isAuditEvent(value: unknown): value is LegalReviewAuditEvent {
  const event = value as Partial<LegalReviewAuditEvent>;
  return (
    Boolean(event) &&
    typeof event.action === "string" &&
    typeof event.id === "string" &&
    typeof event.decisionId === "string" &&
    typeof event.createdAt === "string" &&
    typeof event.summary === "string"
  );
}

function stableDecisionId(input: {
  runId: string;
  action?: string;
  propositionId?: string;
  sourceId?: string;
  passageId?: string;
  pinCite?: string;
  parts?: string[];
}) {
  const parts = input.parts ?? [input.propositionId ?? "", input.sourceId ?? "", input.passageId ?? "", input.pinCite ?? ""];
  return `legal_review_decision_${hashKey([input.runId, input.action ?? "attach_passage_support", ...parts].join("|"))}`;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function appendUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value];
}

function appendNote(current: string | undefined, note: string) {
  if (!current) return note;
  return current.includes(note) ? current : `${current} ${note}`;
}

function requireApproval(approvalToken: string) {
  if (approvalToken !== LEGAL_REVIEW_APPROVAL_TOKEN) {
    throw new Error(`Legal review changes require approvalToken ${LEGAL_REVIEW_APPROVAL_TOKEN}.`);
  }
}

function propositionAuditState(proposition: LegalPropositionRecord) {
  return {
    sourceIds: proposition.sourceIds,
    passageIds: proposition.passageIds,
    pinCites: proposition.pinCites,
    reviewStatus: proposition.reviewStatus
  };
}

function sourceAuditState(source: LegalSourceRecord) {
  return {
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    authorityLevel: source.authorityLevel,
    treatmentStatus: source.treatmentStatus,
    sourceStatus: source.sourceStatus,
    reviewStatus: source.reviewStatus
  };
}

function findingAuditState(finding: Omit<VerificationFinding, "id" | "runId">) {
  return {
    location: finding.location,
    issue: finding.issue,
    category: finding.category,
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

function riskDecisionMatchesFinding(
  decision: Pick<LegalAcceptRiskDecision, "location" | "issue" | "category">,
  finding: Omit<VerificationFinding, "id" | "runId">
) {
  return finding.location === decision.location && finding.issue === decision.issue && (!decision.category || finding.category === decision.category);
}

function conflictResolutionText(resolution: string, carryAsRisk: boolean) {
  return carryAsRisk ? `Carried as accepted legal risk: ${resolution}` : resolution;
}

function hasDecisionBase(value: Partial<LegalReviewDecisionRecord>) {
  return (
    Boolean(value) &&
    typeof value.id === "string" &&
    typeof value.action === "string" &&
    typeof value.createdAt === "string" &&
    value.approvalTokenAccepted === true
  );
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

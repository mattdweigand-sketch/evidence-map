import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceMapRun } from "../types.ts";
import type {
  LegalEvidenceMap,
  LegalPassageRecord,
  LegalPropositionRecord,
  LegalReviewAuditEvent,
  LegalReviewDecisionRecord,
  LegalReviewDecisionSet
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
      `Phase 4A legal review decisions applied: ${input.decisions.length}.`
    ]
  };
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
  const decision: LegalReviewDecisionRecord = {
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
  const auditEvent: LegalReviewAuditEvent = {
    id: `legal_review_audit_${hashKey(`${decision.id}|${now}`)}`,
    runId: input.decisionSet.runId,
    decisionId: decision.id,
    action: decision.action,
    actor: input.reviewer,
    createdAt: now,
    summary: `Attached ${passage.passageId} as support for ${proposition.id}.`,
    before: propositionAuditState(proposition),
    after: propositionAuditState(updatedProposition)
  };
  const decisionSet = {
    ...input.decisionSet,
    decisions: [...input.decisionSet.decisions, decision],
    auditEvents: [...input.decisionSet.auditEvents, auditEvent]
  };

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
      ? candidate.decisions.filter(isAttachPassageSupportDecision).map((decision) => ({ ...decision, runId }))
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

function isAttachPassageSupportDecision(value: unknown): value is LegalReviewDecisionRecord {
  const decision = value as Partial<LegalReviewDecisionRecord>;
  return (
    Boolean(decision) &&
    decision.action === "attach_passage_support" &&
    typeof decision.id === "string" &&
    typeof decision.propositionId === "string" &&
    typeof decision.sourceId === "string" &&
    typeof decision.passageId === "string" &&
    typeof decision.createdAt === "string" &&
    decision.approvalTokenAccepted === true
  );
}

function isAuditEvent(value: unknown): value is LegalReviewAuditEvent {
  const event = value as Partial<LegalReviewAuditEvent>;
  return (
    Boolean(event) &&
    event.action === "attach_passage_support" &&
    typeof event.id === "string" &&
    typeof event.decisionId === "string" &&
    typeof event.createdAt === "string" &&
    typeof event.summary === "string"
  );
}

function stableDecisionId(input: {
  runId: string;
  propositionId: string;
  sourceId: string;
  passageId: string;
  pinCite?: string;
}) {
  return `legal_review_decision_${hashKey(`${input.runId}|${input.propositionId}|${input.sourceId}|${input.passageId}|${input.pinCite ?? ""}`)}`;
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

function propositionAuditState(proposition: LegalPropositionRecord) {
  return {
    sourceIds: proposition.sourceIds,
    passageIds: proposition.passageIds,
    pinCites: proposition.pinCites,
    reviewStatus: proposition.reviewStatus
  };
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

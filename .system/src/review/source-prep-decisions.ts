import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceMapRun, FileInspectionRecord, SourceRecord } from "../types.ts";

export const SOURCE_PREP_APPROVAL_TOKEN = "APPROVE_SOURCE_PREP_DECISION";

export type SourcePrepReviewDecisionAction = "set_source_date" | "mark_ocr_required";
export type SourcePrepOcrReviewPath = "ocr_required" | "replacement_required" | "manual_review_required";

interface SourcePrepReviewDecisionBase {
  id: string;
  runId: string;
  action: SourcePrepReviewDecisionAction;
  reviewer?: string;
  createdAt: string;
  approvalTokenAccepted: true;
  notes?: string;
}

export interface SourcePrepSetSourceDateDecision extends SourcePrepReviewDecisionBase {
  action: "set_source_date";
  sourceId: string;
  sourceDate: string;
  reason: string;
}

export interface SourcePrepMarkOcrRequiredDecision extends SourcePrepReviewDecisionBase {
  action: "mark_ocr_required";
  sourceId: string;
  reviewPath: SourcePrepOcrReviewPath;
  reason: string;
}

export type SourcePrepReviewDecisionRecord = SourcePrepSetSourceDateDecision | SourcePrepMarkOcrRequiredDecision;

export interface SourcePrepReviewAuditEvent {
  id: string;
  runId: string;
  decisionId: string;
  action: SourcePrepReviewDecisionAction;
  actor?: string;
  createdAt: string;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface SourcePrepReviewDecisionSet {
  runId: string;
  profile: "source_prep";
  decisions: SourcePrepReviewDecisionRecord[];
  auditEvents: SourcePrepReviewAuditEvent[];
}

export async function readSourcePrepReviewDecisionSet(input: {
  baseDir: string;
  run: Pick<EvidenceMapRun, "id" | "slug">;
}): Promise<SourcePrepReviewDecisionSet> {
  try {
    const raw = await readFile(sourcePrepReviewDecisionSetPath(input.baseDir, input.run.slug), "utf8");
    return normalizeDecisionSet(input.run.id, JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptySourcePrepReviewDecisionSet(input.run.id);
    }
    throw error;
  }
}

export function sourcePrepReviewDecisionSetPath(baseDir: string, runSlug: string) {
  return join(baseDir, "deliverables", runSlug, "03_verification", "source-prep-decisions.json");
}

export function emptySourcePrepReviewDecisionSet(runId: string): SourcePrepReviewDecisionSet {
  return {
    runId,
    profile: "source_prep",
    decisions: [],
    auditEvents: []
  };
}

export function applySourcePrepDecisionsToSources(input: {
  sources: SourceRecord[];
  decisions: SourcePrepReviewDecisionRecord[];
}): SourceRecord[] {
  if (input.decisions.length === 0) return input.sources;
  return input.sources.map((source) =>
    input.decisions.reduce((current, decision) => applyDecisionToSource(current, decision), source)
  );
}

export function applySourcePrepDecisionsToInspections(input: {
  inspections: FileInspectionRecord[];
  decisions: SourcePrepReviewDecisionRecord[];
}): FileInspectionRecord[] {
  const ocrDecisions = input.decisions.filter(
    (decision): decision is SourcePrepMarkOcrRequiredDecision => decision.action === "mark_ocr_required"
  );
  if (ocrDecisions.length === 0) return input.inspections;
  const decisionsBySourceId = new Map<string, SourcePrepMarkOcrRequiredDecision[]>();
  for (const decision of ocrDecisions) {
    decisionsBySourceId.set(decision.sourceId, [...(decisionsBySourceId.get(decision.sourceId) ?? []), decision]);
  }

  return input.inspections.map((inspection) => {
    if (!inspection.sourceId) return inspection;
    const decisions = decisionsBySourceId.get(inspection.sourceId);
    if (!decisions?.length) return inspection;
    const decisionNotes = decisions.map(
      (decision) =>
        `Source prep decision ${decision.id} recorded ${humanOcrReviewPath(decision.reviewPath)}. Reason: ${decision.reason}`
    );
    return {
      ...inspection,
      warnings: appendUniqueMany(inspection.warnings, decisionNotes)
    };
  });
}

export function appendSetSourceDateDecision(input: {
  decisionSet: SourcePrepReviewDecisionSet;
  sources: SourceRecord[];
  sourceId: string;
  sourceDate: string;
  reason: string;
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  assertIsoDate(input.sourceDate);
  const source = input.sources.find((item) => item.id === input.sourceId);
  if (!source) throw new Error(`Unknown source: ${input.sourceId}`);
  const reason = input.reason.trim();
  if (!reason) throw new Error("A source-date reason is required.");

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "set_source_date",
    parts: [input.sourceId, input.sourceDate, reason]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  if (existingDecision || source.sourceDate === input.sourceDate) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: SourcePrepSetSourceDateDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "set_source_date",
    sourceId: input.sourceId,
    sourceDate: input.sourceDate,
    reason,
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
    summary: `Set source date for ${source.id} to ${input.sourceDate}.`,
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

export function appendMarkOcrRequiredDecision(input: {
  decisionSet: SourcePrepReviewDecisionSet;
  sources: SourceRecord[];
  inspections: FileInspectionRecord[];
  sourceId: string;
  reviewPath?: SourcePrepOcrReviewPath;
  reason: string;
  reviewer?: string;
  notes?: string;
  approvalToken: string;
  now?: string;
}) {
  requireApproval(input.approvalToken);
  const source = input.sources.find((item) => item.id === input.sourceId);
  if (!source) throw new Error(`Unknown source: ${input.sourceId}`);
  if (source.fileType !== "pdf") throw new Error(`OCR review decisions require a PDF source: ${input.sourceId}`);
  const inspection = input.inspections.find((item) => item.sourceId === input.sourceId);
  if (!inspection) throw new Error(`No inspection found for source: ${input.sourceId}`);
  if (!isOcrRequiredInspection(inspection)) {
    throw new Error(`Source is not an OCR-required PDF candidate: ${input.sourceId}`);
  }
  const reason = input.reason.trim();
  if (!reason) throw new Error("An OCR decision reason is required.");
  const reviewPath = input.reviewPath ?? "ocr_required";

  const decisionId = stableDecisionId({
    runId: input.decisionSet.runId,
    action: "mark_ocr_required",
    parts: [input.sourceId, reviewPath, reason]
  });
  const existingDecision = input.decisionSet.decisions.find((decision) => decision.id === decisionId);
  if (existingDecision) {
    return { decisionSet: input.decisionSet, changed: false, decision: undefined, auditEvent: undefined };
  }

  const now = input.now ?? new Date().toISOString();
  const decision: SourcePrepMarkOcrRequiredDecision = {
    id: decisionId,
    runId: input.decisionSet.runId,
    action: "mark_ocr_required",
    sourceId: input.sourceId,
    reviewPath,
    reason,
    reviewer: input.reviewer,
    createdAt: now,
    approvalTokenAccepted: true,
    notes: input.notes
  };
  const updatedInspection = applySourcePrepDecisionsToInspections({ inspections: [inspection], decisions: [decision] })[0] ?? inspection;
  const auditEvent = buildAuditEvent({
    runId: input.decisionSet.runId,
    decision,
    reviewer: input.reviewer,
    now,
    summary: `Recorded ${humanOcrReviewPath(reviewPath)} for ${source.id}.`,
    before: inspectionAuditState(inspection),
    after: {
      ...inspectionAuditState(updatedInspection),
      reviewPath,
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

export function summarizeSourcePrepDecisionSet(decisionSet: SourcePrepReviewDecisionSet) {
  const sourceDateDecisions = decisionSet.decisions.filter(
    (decision): decision is SourcePrepSetSourceDateDecision => decision.action === "set_source_date"
  );
  const ocrDecisions = decisionSet.decisions.filter(
    (decision): decision is SourcePrepMarkOcrRequiredDecision => decision.action === "mark_ocr_required"
  );
  return {
    decisionCount: decisionSet.decisions.length,
    auditEventCount: decisionSet.auditEvents.length,
    sourceDateDecisionCount: sourceDateDecisions.length,
    ocrDecisionCount: ocrDecisions.length,
    sourceDateDecisionSourceIds: uniqueSorted(sourceDateDecisions.map((decision) => decision.sourceId)),
    ocrDecisionSourceIds: uniqueSorted(ocrDecisions.map((decision) => decision.sourceId))
  };
}

export function renderSourcePrepReviewDecisionSet(decisionSet: SourcePrepReviewDecisionSet) {
  const rows = decisionSet.auditEvents.length
    ? decisionSet.auditEvents
        .map(
          (event) =>
            `| ${escapeCell(event.id)} | ${escapeCell(event.createdAt)} | ${event.action} | ${escapeCell(event.actor ?? "")} | ${escapeCell(event.summary)} |`
        )
        .join("\n")
    : "| none |  |  |  | No source-prep review decisions. |";

  return `# Source Prep Decisions

This artifact records explicit source-prep review changes. It is an audit trail; source files are not mutated.

Decisions: ${decisionSet.decisions.length}

Audit events: ${decisionSet.auditEvents.length}

| Event ID | Created | Action | Actor | Summary |
|---|---|---|---|---|
${rows}
`;
}

export function isOcrRequiredInspection(inspection: FileInspectionRecord) {
  return (
    inspection.fileType === "pdf" &&
    inspection.parser === "pdf-text-v1" &&
    inspection.status === "metadata_only" &&
    inspection.warnings.some((warning) => /did not return extractable text/i.test(warning))
  );
}

function applyDecisionToSource(source: SourceRecord, decision: SourcePrepReviewDecisionRecord): SourceRecord {
  if (decision.action !== "set_source_date" || decision.sourceId !== source.id) return source;
  return {
    ...source,
    sourceDate: decision.sourceDate,
    notes: appendNote(source.notes, `Source prep decision ${decision.id} set source date. Reason: ${decision.reason}`)
  };
}

function buildAuditEvent(input: {
  runId: string;
  decision: SourcePrepReviewDecisionRecord;
  reviewer?: string;
  now: string;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): SourcePrepReviewAuditEvent {
  return {
    id: `source_prep_audit_${hashKey(`${input.decision.id}|${input.now}`)}`,
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
  decisionSet: SourcePrepReviewDecisionSet,
  decision: SourcePrepReviewDecisionRecord,
  auditEvent: SourcePrepReviewAuditEvent
): SourcePrepReviewDecisionSet {
  return {
    ...decisionSet,
    decisions: [...decisionSet.decisions, decision],
    auditEvents: [...decisionSet.auditEvents, auditEvent]
  };
}

function normalizeDecisionSet(runId: string, value: unknown): SourcePrepReviewDecisionSet {
  if (!value || typeof value !== "object") return emptySourcePrepReviewDecisionSet(runId);
  const candidate = value as Partial<SourcePrepReviewDecisionSet>;
  return {
    runId,
    profile: "source_prep",
    decisions: Array.isArray(candidate.decisions)
      ? candidate.decisions.filter(isReviewDecision).map((decision) => ({ ...decision, runId }))
      : [],
    auditEvents: Array.isArray(candidate.auditEvents)
      ? candidate.auditEvents.filter(isAuditEvent).map((event) => ({ ...event, runId }))
      : []
  };
}

function isReviewDecision(value: unknown): value is SourcePrepReviewDecisionRecord {
  const decision = value as Partial<SourcePrepReviewDecisionRecord>;
  if (!hasDecisionBase(decision)) return false;
  if (decision.action === "set_source_date") {
    return typeof decision.sourceId === "string" && isIsoDate(decision.sourceDate) && typeof decision.reason === "string";
  }
  if (decision.action === "mark_ocr_required") {
    return (
      typeof decision.sourceId === "string" &&
      isOcrReviewPath(decision.reviewPath) &&
      typeof decision.reason === "string"
    );
  }
  return false;
}

function isAuditEvent(value: unknown): value is SourcePrepReviewAuditEvent {
  const event = value as Partial<SourcePrepReviewAuditEvent>;
  return (
    Boolean(event) &&
    typeof event.action === "string" &&
    typeof event.id === "string" &&
    typeof event.decisionId === "string" &&
    typeof event.createdAt === "string" &&
    typeof event.summary === "string"
  );
}

function hasDecisionBase(value: Partial<SourcePrepReviewDecisionRecord>) {
  return (
    Boolean(value) &&
    typeof value.id === "string" &&
    typeof value.action === "string" &&
    typeof value.createdAt === "string" &&
    value.approvalTokenAccepted === true
  );
}

function requireApproval(approvalToken: string) {
  if (approvalToken !== SOURCE_PREP_APPROVAL_TOKEN) {
    throw new Error(`Source-prep review changes require approvalToken ${SOURCE_PREP_APPROVAL_TOKEN}.`);
  }
}

function stableDecisionId(input: { runId: string; action: SourcePrepReviewDecisionAction; parts: string[] }) {
  return `source_prep_decision_${hashKey([input.runId, input.action, ...input.parts].join("|"))}`;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sourceAuditState(source: SourceRecord) {
  return {
    id: source.id,
    name: source.name,
    fileType: source.fileType,
    status: source.status,
    sourceDate: source.sourceDate
  };
}

function inspectionAuditState(inspection: FileInspectionRecord) {
  return {
    id: inspection.id,
    sourceId: inspection.sourceId,
    name: inspection.name,
    fileType: inspection.fileType,
    parser: inspection.parser,
    status: inspection.status,
    warnings: inspection.warnings
  };
}

function assertIsoDate(value: string) {
  if (!isIsoDate(value)) throw new Error("sourceDate must use YYYY-MM-DD format.");
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isOcrReviewPath(value: unknown): value is SourcePrepOcrReviewPath {
  return value === "ocr_required" || value === "replacement_required" || value === "manual_review_required";
}

function humanOcrReviewPath(value: SourcePrepOcrReviewPath) {
  if (value === "replacement_required") return "replacement PDF required";
  if (value === "manual_review_required") return "manual OCR review required";
  return "OCR required";
}

function appendNote(current: string | undefined, note: string) {
  if (!current) return note;
  return current.includes(note) ? current : `${current} ${note}`;
}

function appendUniqueMany(values: string[], additions: string[]) {
  return additions.reduce((current, value) => (current.includes(value) ? current : [...current, value]), values);
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

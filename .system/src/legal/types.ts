import type { ArtifactKind, ReviewStatus, VerificationFinding } from "../types.ts";

export const legalSourceKinds = [
  "case",
  "statute",
  "regulation",
  "rule",
  "constitution",
  "brief",
  "motion",
  "order",
  "contract",
  "exhibit",
  "transcript",
  "assignment",
  "secondary",
  "unknown"
] as const;
export type LegalSourceKind = (typeof legalSourceKinds)[number];

export const legalAuthorityLevels = ["binding", "persuasive", "secondary", "record", "assignment", "unknown"] as const;
export type LegalAuthorityLevel = (typeof legalAuthorityLevels)[number];

export type LegalSourceStatus = "current" | "superseded" | "background" | "draft" | "unknown";
export type LegalTreatmentStatus = "not_checked" | "checked_current" | "questioned" | "negative" | "superseded";
export type LegalExtractionStatus = "extracted" | "metadata_only" | "failed" | "manual";

export interface LegalSourceRecord {
  id: string;
  runId: string;
  sourceId: string;
  sourceKind: LegalSourceKind;
  title: string;
  citationText?: string;
  normalizedCitation?: string;
  jurisdiction?: string;
  courtOrAuthority?: string;
  decisionDate?: string;
  effectiveDate?: string;
  authorityLevel: LegalAuthorityLevel;
  sourceStatus: LegalSourceStatus;
  treatmentStatus: LegalTreatmentStatus;
  extractionStatus: LegalExtractionStatus;
  proceduralPosture?: string;
  parties?: string[];
  notes?: string;
  reviewStatus: ReviewStatus;
}

export interface LegalPassageRecord {
  id: string;
  runId: string;
  sourceId: string;
  passageId: string;
  locationKind: "page" | "paragraph" | "section" | "line" | "cell" | "unknown";
  pageNumber?: number;
  paragraphNumber?: number;
  sectionLabel?: string;
  lineRange?: string;
  pinpoint?: string;
  quote?: string;
  quoteHash?: string;
  textBefore?: string;
  textAfter?: string;
  extractionStatus: LegalExtractionStatus;
  notes?: string;
}

export const legalPropositionTypes = [
  "rule",
  "holding",
  "reasoning",
  "standard_of_review",
  "procedural_fact",
  "record_fact",
  "application",
  "counterargument",
  "conclusion",
  "quote",
  "citation"
] as const;
export type LegalPropositionType = (typeof legalPropositionTypes)[number];

export interface LegalPropositionRecord {
  id: string;
  runId: string;
  artifactLocation: string;
  propositionType: LegalPropositionType;
  text: string;
  sourceIds: string[];
  passageIds: string[];
  pinCites: string[];
  assumptions: string[];
  jurisdiction?: string;
  authorityLevelRequired: "binding" | "persuasive_ok" | "secondary_ok" | "record";
  reviewStatus: ReviewStatus;
  notes?: string;
}

export const legalOutputKinds = [
  "case_brief",
  "legal_memo",
  "rule_synthesis",
  "issue_outline",
  "argument_outline",
  "citation_table",
  "case_comparison",
  "other"
] as const;
export type LegalOutputKind = (typeof legalOutputKinds)[number];

export interface LegalOutputSpec {
  id: string;
  runId: string;
  outputKind: LegalOutputKind;
  audience: string;
  assignmentOrUseCase: string;
  jurisdiction?: string;
  courseOrMatter?: string;
  questionPresented?: string;
  requiredSections: string[];
  citationStyle: "bluebook" | "alwd" | "professor_specific" | "plain" | "unknown";
  allowedSourceScope: "provided_packet_only" | "provided_plus_user_approved_research";
  reviewOwner?: string;
  reviewRules: string[];
}

export interface LegalEvidenceMap {
  id: string;
  runId: string;
  profile: "legal";
  artifactKind: ArtifactKind;
  propositions: LegalPropositionRecord[];
  summary: {
    propositionCount: number;
    mappedPropositionCount: number;
    unsupportedPropositionCount: number;
    passageSupportedPropositionCount: number;
  };
  notes: string[];
}

export const legalFindingCategories = [
  "missing_authority",
  "missing_pinpoint",
  "quote_drift",
  "unsupported_record_fact",
  "jurisdiction_mismatch",
  "authority_level_mismatch",
  "secondary_only_rule",
  "unresolved_conflict",
  "negative_treatment_not_checked",
  "case_posture_unclear",
  "assignment_scope_violation",
  "model_knowledge_leak",
  "citation_format_issue",
  "conclusion_outpaces_support"
] as const;
export type LegalFindingCategory = (typeof legalFindingCategories)[number];

export type LegalFindingDraft = Omit<VerificationFinding, "id" | "runId"> & {
  category: LegalFindingCategory;
};

export const legalReviewDecisionActions = [
  "attach_passage_support",
  "update_source_authority",
  "update_source_treatment",
  "accept_legal_risk",
  "resolve_source_conflict"
] as const;
export type LegalReviewDecisionAction = (typeof legalReviewDecisionActions)[number];

interface LegalReviewDecisionBase {
  id: string;
  runId: string;
  action: LegalReviewDecisionAction;
  reviewer?: string;
  createdAt: string;
  approvalTokenAccepted: true;
  notes?: string;
}

export interface LegalAttachPassageSupportDecision extends LegalReviewDecisionBase {
  action: "attach_passage_support";
  propositionId: string;
  sourceId: string;
  passageId: string;
  pinCite?: string;
}

export interface LegalUpdateSourceAuthorityDecision extends LegalReviewDecisionBase {
  action: "update_source_authority";
  sourceId: string;
  authorityLevel: LegalAuthorityLevel;
  sourceKind?: LegalSourceKind;
  reviewStatus?: ReviewStatus;
}

export interface LegalUpdateSourceTreatmentDecision extends LegalReviewDecisionBase {
  action: "update_source_treatment";
  sourceId: string;
  treatmentStatus: LegalTreatmentStatus;
  sourceStatus?: LegalSourceStatus;
  reviewStatus?: ReviewStatus;
}

export interface LegalAcceptRiskDecision extends LegalReviewDecisionBase {
  action: "accept_legal_risk";
  location: string;
  issue: string;
  category?: LegalFindingCategory;
  reason: string;
}

export interface LegalResolveSourceConflictDecision extends LegalReviewDecisionBase {
  action: "resolve_source_conflict";
  conflictId: string;
  resolution: string;
  carryAsRisk: boolean;
}

export type LegalReviewDecisionRecord =
  | LegalAttachPassageSupportDecision
  | LegalUpdateSourceAuthorityDecision
  | LegalUpdateSourceTreatmentDecision
  | LegalAcceptRiskDecision
  | LegalResolveSourceConflictDecision;

export interface LegalReviewAuditEvent {
  id: string;
  runId: string;
  decisionId: string;
  action: LegalReviewDecisionAction;
  actor?: string;
  createdAt: string;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface LegalReviewDecisionSet {
  runId: string;
  profile: "legal";
  decisions: LegalReviewDecisionRecord[];
  auditEvents: LegalReviewAuditEvent[];
}

export interface LegalMatterBoundary {
  id: string;
  runId: string;
  profile: "legal";
  boundaryKey: string;
  courseOrMatter?: string;
  jurisdiction?: string;
  assignmentOrUseCase: string;
  allowedSourceScope: LegalOutputSpec["allowedSourceScope"];
  reusePolicy: "same_boundary_only";
  notes: string[];
}

export interface LegalSourceVersionRecord {
  id: string;
  runId: string;
  sourceId: string;
  sourceVersionKey: string;
  title: string;
  citationText?: string;
  jurisdiction?: string;
  sourceKind: LegalSourceKind;
  authorityLevel: LegalAuthorityLevel;
  sourceStatus: LegalSourceStatus;
  treatmentStatus: LegalTreatmentStatus;
  extractionStatus: LegalExtractionStatus;
  reviewStatus: ReviewStatus;
  sourceHash?: string;
  passageQuoteHashes: string[];
}

export interface LegalReusablePropositionRecord {
  id: string;
  runId: string;
  propositionId: string;
  boundaryKey: string;
  propositionType: LegalPropositionType;
  text: string;
  sourceIds: string[];
  sourceVersionKeys: string[];
  passageIds: string[];
  pinCites: string[];
  quoteHashes: string[];
  authorityLevelRequired: LegalPropositionRecord["authorityLevelRequired"];
  reviewStatus: ReviewStatus;
  notes?: string;
}

export interface LegalImportedReuseLibrary {
  sourcePath: string;
  id: string;
  runId: string;
  boundary: LegalMatterBoundary;
  sourceVersions: LegalSourceVersionRecord[];
  propositions: LegalReusablePropositionRecord[];
}

export interface LegalReuseLibrary {
  id: string;
  runId: string;
  profile: "legal";
  boundary: LegalMatterBoundary;
  sourceVersions: LegalSourceVersionRecord[];
  propositions: LegalReusablePropositionRecord[];
  importedLibraries: LegalImportedReuseLibrary[];
  notes: string[];
}

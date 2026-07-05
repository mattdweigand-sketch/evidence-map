import type { ReviewStatus, VerificationFinding } from "../types.ts";

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

export type LegalPropositionType =
  | "rule"
  | "holding"
  | "reasoning"
  | "standard_of_review"
  | "procedural_fact"
  | "record_fact"
  | "application"
  | "counterargument"
  | "conclusion"
  | "quote"
  | "citation";

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

export interface LegalOutputSpec {
  id: string;
  runId: string;
  outputKind:
    | "case_brief"
    | "legal_memo"
    | "rule_synthesis"
    | "issue_outline"
    | "argument_outline"
    | "citation_table"
    | "case_comparison"
    | "other";
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

export type LegalFindingCategory =
  | "missing_authority"
  | "missing_pinpoint"
  | "quote_drift"
  | "unsupported_record_fact"
  | "jurisdiction_mismatch"
  | "authority_level_mismatch"
  | "secondary_only_rule"
  | "unresolved_conflict"
  | "negative_treatment_not_checked"
  | "case_posture_unclear"
  | "assignment_scope_violation"
  | "model_knowledge_leak"
  | "citation_format_issue"
  | "conclusion_outpaces_support";

export type LegalFindingDraft = Omit<VerificationFinding, "id" | "runId"> & {
  category: LegalFindingCategory;
};

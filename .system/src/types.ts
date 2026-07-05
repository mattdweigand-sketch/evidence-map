export const artifactKinds = ["deck", "workbook", "document", "report", "mixed"] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

export const workflowProfiles = ["general", "legal"] as const;
export type WorkflowProfile = (typeof workflowProfiles)[number];

export type RunStatus = "running" | "waiting_for_review" | "blocked" | "export_ready" | "failed";

export type SourceStatus =
  | "current"
  | "superseded"
  | "background"
  | "estimate"
  | "transcript"
  | "raw_data"
  | "unclear";

export type ReviewStatus = "unreviewed" | "needs_review" | "verified" | "unsupported" | "conflicting";

export type FindingSeverity = "must_fix" | "should_fix" | "polish";

export type Readiness = "ready" | "needs_review" | "blocked";
export type InspectionStatus = "inspected" | "metadata_only" | "unsupported" | "failed";

export interface EvidenceMapRun {
  id: string;
  slug: string;
  name: string;
  artifactKind: ArtifactKind;
  profile: WorkflowProfile;
  status: RunStatus;
  inputPaths: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SourceRecord {
  id: string;
  runId: string;
  name: string;
  path: string;
  fileType: string;
  status: SourceStatus;
  sourceDate?: string;
  owner?: string;
  intendedUse: string;
  notes?: string;
}

export interface SourceConflict {
  id: string;
  runId: string;
  sourceIds: string[];
  description: string;
  severity: "warning" | "blocking";
  status: "open" | "resolved";
  resolution?: string;
}

export interface FileInspectionRecord {
  id: string;
  runId: string;
  sourceId?: string;
  name: string;
  path: string;
  fileType: string;
  parser: string;
  status: InspectionStatus;
  sizeBytes: number;
  modifiedAt?: string;
  sourceDateCandidates: string[];
  ownerCandidates: string[];
  structuredSummary: Record<string, unknown>;
  textPreview?: string;
  warnings: string[];
}

export interface AssumptionRecord {
  id: string;
  runId: string;
  name: string;
  value: string;
  unit?: string;
  sourceIds: string[];
  owner?: string;
  status: "sourced" | "estimate" | "placeholder" | "unsupported";
  lastUpdated?: string;
  notes?: string;
}

export interface ClaimRecord {
  id: string;
  runId: string;
  artifactLocation: string;
  claim: string;
  sourceIds: string[];
  assumptions: string[];
  transformation?: string;
  reviewStatus: ReviewStatus;
}

export interface CalculationRecord {
  id: string;
  runId: string;
  artifactLocation: string;
  inputs: string[];
  logic: string;
  expectedBehavior: string;
  riskFlags: string[];
  reviewStatus: ReviewStatus;
}

export interface ArtifactSpec {
  id: string;
  runId: string;
  artifactKind: ArtifactKind;
  audience: string;
  decisionContext: string;
  narrativeSpine: string;
  structure: string[];
  requiredChecks: string[];
  reviewRules: string[];
}

export interface VerificationFinding {
  id: string;
  runId: string;
  location: string;
  issue: string;
  category?: string;
  severity: FindingSeverity;
  evidence: string;
  recommendedRepair: string;
  humanReviewRequired: boolean;
}

export interface TrustReport {
  id: string;
  runId: string;
  readiness: Readiness;
  summary: {
    sourceCount: number;
    claimCount: number;
    calculationCount: number;
    assumptionCount: number;
    findingCount: number;
    blockingCount: number;
    needsReviewCount: number;
  };
  blockingIssues: string[];
  warnings: string[];
}

export interface StartRunInput {
  name: string;
  artifactKind: ArtifactKind;
  profile?: WorkflowProfile;
  inputPaths: string[];
}

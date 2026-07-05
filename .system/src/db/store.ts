import type {
  ArtifactSpec,
  AssumptionRecord,
  CalculationRecord,
  ClaimRecord,
  FileInspectionRecord,
  SourceConflict,
  SourceRecord,
  StartRunInput,
  EvidenceMapRun,
  TrustReport,
  VerificationFinding
} from "../types.ts";

export interface EvidenceMapStore {
  createRun(input: StartRunInput): Promise<EvidenceMapRun>;
  getRun(id: string): Promise<EvidenceMapRun | undefined>;
  updateRunStatus(runId: string, status: EvidenceMapRun["status"]): Promise<EvidenceMapRun>;

  createSources(runId: string, sources: Omit<SourceRecord, "id" | "runId">[]): Promise<SourceRecord[]>;
  listSources(runId: string): Promise<SourceRecord[]>;

  createSourceConflicts(runId: string, conflicts: Omit<SourceConflict, "id" | "runId">[]): Promise<SourceConflict[]>;
  listSourceConflicts(runId: string): Promise<SourceConflict[]>;

  createFileInspections(runId: string, inspections: Omit<FileInspectionRecord, "id" | "runId">[]): Promise<FileInspectionRecord[]>;
  listFileInspections(runId: string): Promise<FileInspectionRecord[]>;

  createAssumptions(runId: string, assumptions: Omit<AssumptionRecord, "id" | "runId">[]): Promise<AssumptionRecord[]>;
  listAssumptions(runId: string): Promise<AssumptionRecord[]>;

  createClaims(runId: string, claims: Omit<ClaimRecord, "id" | "runId">[]): Promise<ClaimRecord[]>;
  listClaims(runId: string): Promise<ClaimRecord[]>;

  createCalculations(runId: string, calculations: Omit<CalculationRecord, "id" | "runId">[]): Promise<CalculationRecord[]>;
  listCalculations(runId: string): Promise<CalculationRecord[]>;

  createArtifactSpec(spec: Omit<ArtifactSpec, "id">): Promise<ArtifactSpec>;
  getArtifactSpec(runId: string): Promise<ArtifactSpec | undefined>;

  createVerificationFindings(
    runId: string,
    findings: Omit<VerificationFinding, "id" | "runId">[]
  ): Promise<VerificationFinding[]>;
  replaceVerificationFindings(
    runId: string,
    findings: Omit<VerificationFinding, "id" | "runId">[]
  ): Promise<VerificationFinding[]>;
  listVerificationFindings(runId: string): Promise<VerificationFinding[]>;

  createTrustReport(report: Omit<TrustReport, "id">): Promise<TrustReport>;
  getLatestTrustReport(runId: string): Promise<TrustReport | undefined>;
}

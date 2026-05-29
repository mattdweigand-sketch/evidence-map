import type {
  ArtifactSpec,
  AssumptionRecord,
  CalculationRecord,
  ClaimRecord,
  FileInspectionRecord,
  SourceConflict,
  SourceRecord,
  StartRunInput,
  TruthLayerRun,
  TrustReport,
  VerificationFinding
} from "../types.ts";
import type { TruthLayerStore } from "./store.ts";

export class MemoryTruthLayerStore implements TruthLayerStore {
  private runs = new Map<string, TruthLayerRun>();
  private sources = new Map<string, SourceRecord[]>();
  private conflicts = new Map<string, SourceConflict[]>();
  private inspections = new Map<string, FileInspectionRecord[]>();
  private assumptions = new Map<string, AssumptionRecord[]>();
  private claims = new Map<string, ClaimRecord[]>();
  private calculations = new Map<string, CalculationRecord[]>();
  private specs = new Map<string, ArtifactSpec>();
  private findings = new Map<string, VerificationFinding[]>();
  private reports = new Map<string, TrustReport[]>();

  async createRun(input: StartRunInput): Promise<TruthLayerRun> {
    const now = new Date().toISOString();
    const run: TruthLayerRun = {
      id: createId("run"),
      slug: slugify(input.name),
      name: input.name,
      artifactKind: input.artifactKind,
      status: "running",
      inputPaths: input.inputPaths,
      createdAt: now,
      updatedAt: now
    };
    this.runs.set(run.id, run);
    return run;
  }

  async getRun(id: string) {
    return this.runs.get(id);
  }

  async updateRunStatus(runId: string, status: TruthLayerRun["status"]) {
    const run = this.requireRun(runId);
    const updated = { ...run, status, updatedAt: new Date().toISOString() };
    this.runs.set(runId, updated);
    return updated;
  }

  async createSources(runId: string, sources: Omit<SourceRecord, "id" | "runId">[]) {
    return this.append(this.sources, runId, sources.map((source) => ({ ...source, id: createId("src"), runId })));
  }

  async listSources(runId: string) {
    return this.sources.get(runId) ?? [];
  }

  async createSourceConflicts(runId: string, conflicts: Omit<SourceConflict, "id" | "runId">[]) {
    return this.append(this.conflicts, runId, conflicts.map((conflict) => ({ ...conflict, id: createId("conflict"), runId })));
  }

  async listSourceConflicts(runId: string) {
    return this.conflicts.get(runId) ?? [];
  }

  async createFileInspections(runId: string, inspections: Omit<FileInspectionRecord, "id" | "runId">[]) {
    return this.append(this.inspections, runId, inspections.map((inspection) => ({ ...inspection, id: createId("inspect"), runId })));
  }

  async listFileInspections(runId: string) {
    return this.inspections.get(runId) ?? [];
  }

  async createAssumptions(runId: string, assumptions: Omit<AssumptionRecord, "id" | "runId">[]) {
    return this.append(this.assumptions, runId, assumptions.map((assumption) => ({ ...assumption, id: createId("asm"), runId })));
  }

  async listAssumptions(runId: string) {
    return this.assumptions.get(runId) ?? [];
  }

  async createClaims(runId: string, claims: Omit<ClaimRecord, "id" | "runId">[]) {
    return this.append(this.claims, runId, claims.map((claim) => ({ ...claim, id: createId("claim"), runId })));
  }

  async listClaims(runId: string) {
    return this.claims.get(runId) ?? [];
  }

  async createCalculations(runId: string, calculations: Omit<CalculationRecord, "id" | "runId">[]) {
    return this.append(
      this.calculations,
      runId,
      calculations.map((calculation) => ({ ...calculation, id: createId("calc"), runId }))
    );
  }

  async listCalculations(runId: string) {
    return this.calculations.get(runId) ?? [];
  }

  async createArtifactSpec(spec: Omit<ArtifactSpec, "id">) {
    const created = { ...spec, id: createId("spec") };
    this.specs.set(spec.runId, created);
    return created;
  }

  async getArtifactSpec(runId: string) {
    return this.specs.get(runId);
  }

  async createVerificationFindings(runId: string, findings: Omit<VerificationFinding, "id" | "runId">[]) {
    return this.append(this.findings, runId, findings.map((finding) => ({ ...finding, id: createId("finding"), runId })));
  }

  async listVerificationFindings(runId: string) {
    return this.findings.get(runId) ?? [];
  }

  async createTrustReport(report: Omit<TrustReport, "id">) {
    const created = { ...report, id: createId("trust") };
    const existing = this.reports.get(report.runId) ?? [];
    this.reports.set(report.runId, [...existing, created]);
    return created;
  }

  async getLatestTrustReport(runId: string) {
    return (this.reports.get(runId) ?? []).at(-1);
  }

  private requireRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  private append<T>(map: Map<string, T[]>, runId: string, records: T[]) {
    const existing = map.get(runId) ?? [];
    map.set(runId, [...existing, ...records]);
    return records;
  }
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

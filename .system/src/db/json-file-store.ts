import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

interface StoreData {
  runs: TruthLayerRun[];
  sources: SourceRecord[];
  conflicts: SourceConflict[];
  inspections: FileInspectionRecord[];
  assumptions: AssumptionRecord[];
  claims: ClaimRecord[];
  calculations: CalculationRecord[];
  specs: ArtifactSpec[];
  findings: VerificationFinding[];
  reports: TrustReport[];
}

export class JsonFileTruthLayerStore implements TruthLayerStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async createRun(input: StartRunInput): Promise<TruthLayerRun> {
    const data = await this.load();
    const now = new Date().toISOString();
    const id = createId("run");
    const run: TruthLayerRun = {
      id,
      slug: createRunSlug(input.name, id),
      name: input.name,
      artifactKind: input.artifactKind,
      status: "running",
      inputPaths: input.inputPaths,
      createdAt: now,
      updatedAt: now
    };
    data.runs.push(run);
    await this.save(data);
    return run;
  }

  async getRun(id: string) {
    const data = await this.load();
    return data.runs.find((run) => run.id === id);
  }

  async updateRunStatus(runId: string, status: TruthLayerRun["status"]) {
    const data = await this.load();
    const run = data.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    const updated = { ...run, status, updatedAt: new Date().toISOString() };
    data.runs = data.runs.map((item) => (item.id === runId ? updated : item));
    await this.save(data);
    return updated;
  }

  async createSources(runId: string, sources: Omit<SourceRecord, "id" | "runId">[]) {
    return this.append("sources", sources.map((source) => ({ ...source, id: createId("src"), runId })));
  }

  async listSources(runId: string) {
    const data = await this.load();
    return data.sources.filter((source) => source.runId === runId);
  }

  async createSourceConflicts(runId: string, conflicts: Omit<SourceConflict, "id" | "runId">[]) {
    return this.append("conflicts", conflicts.map((conflict) => ({ ...conflict, id: createId("conflict"), runId })));
  }

  async listSourceConflicts(runId: string) {
    const data = await this.load();
    return data.conflicts.filter((conflict) => conflict.runId === runId);
  }

  async createFileInspections(runId: string, inspections: Omit<FileInspectionRecord, "id" | "runId">[]) {
    return this.append("inspections", inspections.map((inspection) => ({ ...inspection, id: createId("inspect"), runId })));
  }

  async listFileInspections(runId: string) {
    const data = await this.load();
    return data.inspections.filter((inspection) => inspection.runId === runId);
  }

  async createAssumptions(runId: string, assumptions: Omit<AssumptionRecord, "id" | "runId">[]) {
    return this.append("assumptions", assumptions.map((assumption) => ({ ...assumption, id: createId("asm"), runId })));
  }

  async listAssumptions(runId: string) {
    const data = await this.load();
    return data.assumptions.filter((assumption) => assumption.runId === runId);
  }

  async createClaims(runId: string, claims: Omit<ClaimRecord, "id" | "runId">[]) {
    return this.append("claims", claims.map((claim) => ({ ...claim, id: createId("claim"), runId })));
  }

  async listClaims(runId: string) {
    const data = await this.load();
    return data.claims.filter((claim) => claim.runId === runId);
  }

  async createCalculations(runId: string, calculations: Omit<CalculationRecord, "id" | "runId">[]) {
    return this.append("calculations", calculations.map((calculation) => ({ ...calculation, id: createId("calc"), runId })));
  }

  async listCalculations(runId: string) {
    const data = await this.load();
    return data.calculations.filter((calculation) => calculation.runId === runId);
  }

  async createArtifactSpec(spec: Omit<ArtifactSpec, "id">) {
    const created = { ...spec, id: createId("spec") };
    await this.append("specs", [created]);
    return created;
  }

  async getArtifactSpec(runId: string) {
    const data = await this.load();
    return data.specs.filter((spec) => spec.runId === runId).at(-1);
  }

  async createVerificationFindings(runId: string, findings: Omit<VerificationFinding, "id" | "runId">[]) {
    return this.append("findings", findings.map((finding) => ({ ...finding, id: createId("finding"), runId })));
  }

  async replaceVerificationFindings(runId: string, findings: Omit<VerificationFinding, "id" | "runId">[]) {
    const data = await this.load();
    const created = findings.map((finding) => ({ ...finding, id: createId("finding"), runId }));
    data.findings = [...data.findings.filter((finding) => finding.runId !== runId), ...created];
    await this.save(data);
    return created;
  }

  async listVerificationFindings(runId: string) {
    const data = await this.load();
    return data.findings.filter((finding) => finding.runId === runId);
  }

  async createTrustReport(report: Omit<TrustReport, "id">) {
    const created = { ...report, id: createId("trust") };
    await this.append("reports", [created]);
    return created;
  }

  async getLatestTrustReport(runId: string) {
    const data = await this.load();
    return data.reports.filter((report) => report.runId === runId).at(-1);
  }

  private async append<K extends keyof StoreData>(key: K, records: StoreData[K]) {
    const data = await this.load();
    data[key] = [...data[key], ...records] as StoreData[K];
    await this.save(data);
    return records;
  }

  private async load(): Promise<StoreData> {
    try {
      const raw = await readFile(this.path, "utf8");
      return { ...emptyData(), ...JSON.parse(raw) };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return emptyData();
      throw error;
    }
  }

  private async save(data: StoreData) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function emptyData(): StoreData {
  return {
    runs: [],
    sources: [],
    conflicts: [],
    inspections: [],
    assumptions: [],
    claims: [],
    calculations: [],
    specs: [],
    findings: [],
    reports: []
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createRunSlug(name: string, id: string) {
  const base = slugify(name) || "truth-layer-run";
  return `${base}-${id.replace(/^run_/, "").slice(0, 8)}`;
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { EvidenceMapRun } from "../types.ts";
import type { GeneralReadyManifest } from "./general.ts";

export const GENERAL_FINAL_ARTIFACT_RECEIPT_JSON = "general-final-artifact-receipt.json";
export const GENERAL_FINAL_ARTIFACT_RECEIPT_MD = "general-final-artifact-receipt.md";

export interface GeneralFinalArtifactRecord {
  originalPath: string;
  originalPathRelativeToBaseDir: string;
  copiedPath: string;
  copiedPathRelativeToRun: string;
  sha256: string;
  sizeBytes: number;
}

export interface GeneralFinalArtifactReceipt {
  runId: string;
  profile: "general";
  status: "preview_ready" | "applied";
  readiness: "ready";
  reviewer?: string;
  notes?: string;
  appliedAt?: string;
  approvalTokenAccepted: true;
  artifacts: {
    sourcePacket: string;
    readyManifest: string;
    verificationReport: string;
    trustReport: string;
    reviewAudit?: string;
  };
  approvedArtifacts: GeneralFinalArtifactRecord[];
  guardrails: string[];
}

export async function applyGeneralFinalArtifacts(input: {
  baseDir: string;
  run: EvidenceMapRun;
  artifactPaths: string[];
  readyManifest: GeneralReadyManifest;
  dryRun?: boolean;
  reviewer?: string;
  notes?: string;
  now?: string;
}) {
  if (input.run.profile !== "general") throw new Error("General final artifact apply requires a general-profile run.");
  if (input.readyManifest.readiness !== "ready") throw new Error("General final artifact apply requires ready trust gates.");
  if (input.artifactPaths.length === 0) throw new Error("At least one final artifact path is required.");

  const baseDir = resolve(input.baseDir);
  const runDir = join(baseDir, "deliverables", input.run.slug);
  const exportDir = join(runDir, "04_export");
  const approvedDir = join(exportDir, "approved-artifacts");
  const approvedArtifacts = await Promise.all(
    input.artifactPaths.map((artifactPath) => buildArtifactRecord({ baseDir, runDir, approvedDir, artifactPath }))
  );

  const receipt: GeneralFinalArtifactReceipt = {
    runId: input.run.id,
    profile: "general",
    status: input.dryRun ? "preview_ready" : "applied",
    readiness: "ready",
    reviewer: input.reviewer,
    notes: input.notes,
    appliedAt: input.dryRun ? undefined : input.now ?? new Date().toISOString(),
    approvalTokenAccepted: true,
    artifacts: {
      sourcePacket: input.readyManifest.artifacts.sourcePacket,
      readyManifest: "04_export/ready-manifest.json",
      verificationReport: input.readyManifest.artifacts.verificationReport,
      trustReport: input.readyManifest.artifacts.trustReport,
      reviewAudit: input.readyManifest.artifacts.reviewAudit
    },
    approvedArtifacts,
    guardrails: [
      "Only user-supplied local files were copied.",
      "No model calls, external sending, filing, submission, or publication were performed.",
      "Ready status came from the review packet/generation scope for this run, not from native artifact rendering.",
      "This receipt records local handoff only; it does not certify semantic correctness."
    ]
  };

  if (!input.dryRun) {
    await mkdir(approvedDir, { recursive: true });
    await Promise.all(approvedArtifacts.map((artifact) => copyFile(artifact.originalPath, artifact.copiedPath)));
    await writeFile(join(exportDir, GENERAL_FINAL_ARTIFACT_RECEIPT_JSON), `${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(join(exportDir, GENERAL_FINAL_ARTIFACT_RECEIPT_MD), renderGeneralFinalArtifactReceipt(receipt));
  }

  return {
    runId: input.run.id,
    profile: input.run.profile,
    status: receipt.status,
    readiness: receipt.readiness,
    dryRun: Boolean(input.dryRun),
    artifactCount: approvedArtifacts.length,
    approvedArtifacts,
    receipt,
    receiptJsonPath: input.dryRun ? undefined : join(exportDir, GENERAL_FINAL_ARTIFACT_RECEIPT_JSON),
    receiptMarkdownPath: input.dryRun ? undefined : join(exportDir, GENERAL_FINAL_ARTIFACT_RECEIPT_MD),
    exportDir
  };
}

export function renderGeneralFinalArtifactReceipt(receipt: GeneralFinalArtifactReceipt) {
  return `# General Final Artifact Receipt

Status: ${receipt.status}

Readiness: ${receipt.readiness}

Run ID: ${receipt.runId}

Applied at: ${receipt.appliedAt ?? "not applied; preview only"}

Reviewer: ${receipt.reviewer ?? "not recorded"}

Notes: ${receipt.notes ?? "none"}

Source packet: \`${receipt.artifacts.sourcePacket}\`

Ready manifest: \`${receipt.artifacts.readyManifest}\`

Verification report: \`${receipt.artifacts.verificationReport}\`

Trust report: \`${receipt.artifacts.trustReport}\`

Review audit: ${receipt.artifacts.reviewAudit ? `\`${receipt.artifacts.reviewAudit}\`` : "not present"}

## Approved Artifacts

${renderArtifactRows(receipt.approvedArtifacts)}

## Guardrails

${receipt.guardrails.map((item) => `- ${item}`).join("\n")}
`;
}

async function buildArtifactRecord(input: {
  baseDir: string;
  runDir: string;
  approvedDir: string;
  artifactPath: string;
}): Promise<GeneralFinalArtifactRecord> {
  const originalPath = resolve(input.baseDir, input.artifactPath);
  assertWithin(input.baseDir, originalPath, `Final artifact path escapes baseDir: ${input.artifactPath}`);
  const fileStat = await stat(originalPath);
  if (!fileStat.isFile()) throw new Error(`Final artifact path is not a file: ${input.artifactPath}`);

  const fileBuffer = await readFile(originalPath);
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
  const copiedName = `${safeName(originalPath)}-${sha256.slice(0, 12)}${extname(originalPath)}`;
  const copiedPath = join(input.approvedDir, copiedName);
  assertWithin(input.runDir, copiedPath, `Approved artifact destination escapes run directory: ${copiedName}`);

  return {
    originalPath,
    originalPathRelativeToBaseDir: relative(input.baseDir, originalPath),
    copiedPath,
    copiedPathRelativeToRun: relative(input.runDir, copiedPath),
    sha256,
    sizeBytes: fileStat.size
  };
}

function safeName(path: string) {
  const extension = extname(path);
  const stem = basename(path, extension).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.slice(0, 80) || "artifact";
}

function assertWithin(parent: string, child: string, message: string) {
  const relativePath = relative(resolve(parent), resolve(child));
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error(message);
}

function renderArtifactRows(artifacts: GeneralFinalArtifactRecord[]) {
  if (artifacts.length === 0) return "| none |  |  |  |";
  const rows = artifacts.map(
    (artifact) =>
      `| ${artifact.originalPathRelativeToBaseDir} | ${artifact.copiedPathRelativeToRun} | ${artifact.sha256} | ${artifact.sizeBytes} |`
  );
  return ["| Original | Copied to | SHA-256 | Bytes |", "|---|---|---|---|", ...rows].join("\n");
}

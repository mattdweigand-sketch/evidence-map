import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { EvidenceMapStore } from "../db/store.ts";
import { runEvidenceMapWorkflow } from "../chains/evidence-map/workflow.ts";
import type { ArtifactKind, EvidenceMapRun, WorkflowProfile } from "../types.ts";

export interface RefreshReceiptArtifact {
  priorRunPath: string;
  snapshotPath?: string;
}

export interface RefreshReceipt {
  priorRunId: string;
  priorRunSlug: string;
  newRunId: string;
  newRunSlug: string;
  profile: WorkflowProfile;
  artifactKind: ArtifactKind;
  refreshedAt: string;
  carriedArtifacts: RefreshReceiptArtifact[];
  notes: string[];
}

const priorReviewArtifacts = [
  "03_verification/source-prep-decisions.json",
  "03_verification/source-prep-decisions.md",
  "03_verification/general-review-decisions.json",
  "03_verification/general-review-decisions.md",
  "03_verification/legal-review-decisions.json",
  "03_verification/legal-review-decisions.md",
  "03_verification/review-queue.json",
  "03_verification/review-queue.md",
  "03_verification/trust-report.json",
  "04_export/ready-manifest.json",
  "04_export/generated-output-receipt.json",
  "04_export/formatting-receipt.json",
  "04_export/general-final-artifact-receipt.json"
];

export async function runEvidenceMapRefresh(
  store: EvidenceMapStore,
  input: {
    baseDir: string;
    priorRunId: string;
    name: string;
    artifactKind: ArtifactKind;
    profile?: WorkflowProfile;
    inputPaths: string[];
    draftFiles?: string[];
    generate?: boolean;
  }
) {
  const priorRun = await store.getRun(input.priorRunId);
  if (!priorRun) throw new Error(`Unknown prior run: ${input.priorRunId}`);

  const result = await runEvidenceMapWorkflow(store, {
    baseDir: input.baseDir,
    name: input.name,
    artifactKind: input.artifactKind,
    profile: input.profile ?? priorRun.profile,
    inputPaths: input.inputPaths,
    draftFiles: input.draftFiles ?? priorRun.draftFiles,
    generate: input.generate
  });
  const receipt = await writeRefreshReceipt({
    baseDir: input.baseDir,
    priorRun,
    newRun: result.run
  });

  return {
    ...result,
    refreshReceipt: receipt
  };
}

export async function writeRefreshReceipt(input: {
  baseDir: string;
  priorRun: Pick<EvidenceMapRun, "id" | "slug">;
  newRun: EvidenceMapRun;
}): Promise<RefreshReceipt> {
  const refreshDir = join(input.baseDir, "deliverables", input.newRun.slug, "00_refresh");
  const snapshotDir = join(refreshDir, "prior-review-artifacts");
  await mkdir(snapshotDir, { recursive: true });

  const carriedArtifacts: RefreshReceiptArtifact[] = [];
  for (const relativePath of priorReviewArtifacts) {
    const priorPath = join(input.baseDir, "deliverables", input.priorRun.slug, relativePath);
    if (!(await exists(priorPath))) continue;
    const snapshotName = `${relativePath.replace(/[\\/]+/g, "__")}`;
    const snapshotPath = join(snapshotDir, snapshotName);
    await cp(priorPath, snapshotPath, { force: true });
    carriedArtifacts.push({
      priorRunPath: join("deliverables", input.priorRun.slug, relativePath),
      snapshotPath: join("00_refresh", "prior-review-artifacts", basename(snapshotPath))
    });
  }

  const receipt: RefreshReceipt = {
    priorRunId: input.priorRun.id,
    priorRunSlug: input.priorRun.slug,
    newRunId: input.newRun.id,
    newRunSlug: input.newRun.slug,
    profile: input.newRun.profile,
    artifactKind: input.newRun.artifactKind,
    refreshedAt: new Date().toISOString(),
    carriedArtifacts,
    notes: [
      "This refresh created a new run over the supplied inputs.",
      "Prior review artifacts were snapshotted by reference only.",
      "Prior approvals were not automatically replayed onto the refreshed evidence."
    ]
  };

  await writeFile(join(refreshDir, "refresh-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(join(refreshDir, "refresh-receipt.md"), renderRefreshReceipt(receipt));
  return receipt;
}

export function renderRefreshReceipt(receipt: RefreshReceipt) {
  const rows = receipt.carriedArtifacts.length
    ? receipt.carriedArtifacts
        .map((artifact) => `| ${artifact.priorRunPath} | ${artifact.snapshotPath ?? ""} |`)
        .join("\n")
    : "| none |  |";

  return `# Refresh Receipt

Prior run: ${receipt.priorRunId} (${receipt.priorRunSlug})

New run: ${receipt.newRunId} (${receipt.newRunSlug})

Profile: ${receipt.profile}

Artifact kind: ${receipt.artifactKind}

Refreshed at: ${receipt.refreshedAt}

## Prior Review Artifacts

| Prior artifact | Snapshot in new run |
|---|---|
${rows}

## Notes

${receipt.notes.map((note) => `- ${note}`).join("\n")}
`;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

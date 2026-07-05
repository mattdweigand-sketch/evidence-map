import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exit } from "node:process";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { writeRunArtifacts } from "../src/artifacts/write.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { buildLegalRunArtifacts } from "../src/legal/artifacts.ts";
import { applyLegalConflictReviewDecisions, readLegalReviewDecisionSet } from "../src/legal/review-decisions.ts";
import { applyGeneralConflictReviewDecisions, readGeneralReviewDecisionSet } from "../src/review/general-decisions.ts";
import { evaluateTrust } from "../src/trust/evaluate.ts";
import { buildHostileReviewFindings } from "../src/verify/hostile-review.ts";

const args = parseArgs(process.argv.slice(2));
const runDirArg = args.run;
const baseDir = args["base-dir"] ? resolve(args["base-dir"]) : getDefaultBaseDir();
if (!runDirArg) {
  console.error("Usage: npm --prefix .system run verify -- --run deliverables/<run-slug>");
  exit(1);
}

const runDir = resolve(baseDir, runDirArg);
try {
  const runMetadata = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as { id?: string };
  if (!runMetadata.id) throw new Error("Run metadata is missing an id.");

  const store = new JsonFileEvidenceMapStore(join(baseDir, "deliverables", "evidence-map-store.json"));
  const run = await store.getRun(runMetadata.id);
  if (!run) throw new Error(`No persisted run found for ${runMetadata.id}.`);

  const legalReviewDecisionSet = run.profile === "legal" ? await readLegalReviewDecisionSet({ baseDir, run }) : undefined;
  const generalReviewDecisionSet = run.profile === "general" ? await readGeneralReviewDecisionSet({ baseDir, run }) : undefined;
  const findings = await store.replaceVerificationFindings(
    run.id,
    await buildHostileReviewFindings(store, run.id, {
      legalReviewDecisions: legalReviewDecisionSet?.decisions,
      generalReviewDecisions: generalReviewDecisionSet?.decisions
    })
  );
  const trustReport = await evaluateTrust(store, run.id);
  const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
  const updatedRun = await store.updateRunStatus(run.id, status);
  const [sources, inspections, conflicts, spec] = await Promise.all([
    store.listSources(run.id),
    store.listFileInspections(run.id),
    store.listSourceConflicts(run.id),
    store.getArtifactSpec(run.id)
  ]);
  if (!spec) throw new Error(`No artifact spec found for ${run.id}.`);
  const legalArtifacts =
    updatedRun.profile === "legal"
      ? await buildLegalRunArtifacts({ store, run: updatedRun, reviewDecisions: legalReviewDecisionSet?.decisions })
      : undefined;
  const effectiveConflicts =
    updatedRun.profile === "legal" && legalReviewDecisionSet
      ? applyLegalConflictReviewDecisions({ conflicts, decisions: legalReviewDecisionSet.decisions })
      : updatedRun.profile === "general" && generalReviewDecisionSet
        ? applyGeneralConflictReviewDecisions({ conflicts, decisions: generalReviewDecisionSet.decisions })
      : conflicts;

  await writeRunArtifacts({
    baseDir,
    run: updatedRun,
    sources,
    inspections,
    conflicts: effectiveConflicts,
    spec,
    findings,
    trustReport,
    legalSourcePacket: legalArtifacts?.legalSourcePacket,
    legalOutputSpec: legalArtifacts?.legalOutputSpec,
    legalEvidenceMap: legalArtifacts?.legalEvidenceMap,
    legalDraftPropositions: legalArtifacts?.legalDraftPropositions,
    legalReviewDecisionSet,
    legalReuseLibrary: legalArtifacts?.legalReuseLibrary,
    generalReviewDecisionSet
  });
  console.log(JSON.stringify(trustReport, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : `No runnable verification state found for ${runDir}`);
  exit(1);
}

function parseArgs(values: string[]) {
  const output: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (key && value) output[key] = value;
  }
  return output;
}

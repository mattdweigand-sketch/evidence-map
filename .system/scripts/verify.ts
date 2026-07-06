import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exit } from "node:process";
import { getDefaultBaseDir } from "../src/artifacts/paths.ts";
import { writeRunArtifacts } from "../src/artifacts/write.ts";
import { JsonFileEvidenceMapStore } from "../src/db/json-file-store.ts";
import { selectSourceEvidence } from "../src/evidence/select.ts";
import { finalizeGeneratedOutput } from "../src/generate/output.ts";
import { buildLegalRunArtifacts } from "../src/legal/artifacts.ts";
import { applyLegalConflictReviewDecisions, readLegalReviewDecisionSet } from "../src/legal/review-decisions.ts";
import { applyGeneralConflictReviewDecisions, readGeneralReviewDecisionSet } from "../src/review/general-decisions.ts";
import { buildReviewQueue, renderReviewQueueCliSummary } from "../src/review/review-queue.ts";
import {
  applySourcePrepDecisionsToInspections,
  applySourcePrepDecisionsToSources,
  readSourcePrepReviewDecisionSet
} from "../src/review/source-prep-decisions.ts";
import { evaluateTrust } from "../src/trust/evaluate.ts";
import { buildHostileReviewFindings } from "../src/verify/hostile-review.ts";

const args = parseArgs(process.argv.slice(2));
const runDirArg = typeof args.run === "string" ? args.run : undefined;
const baseDirArg = typeof args["base-dir"] === "string" ? args["base-dir"] : undefined;
const baseDir = baseDirArg ? resolve(baseDirArg) : getDefaultBaseDir();
if (!runDirArg) {
  console.error("Usage: npm --prefix .system run verify -- --run deliverables/<run-slug> [--json]");
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
  const sourcePrepReviewDecisionSet = await readSourcePrepReviewDecisionSet({ baseDir, run });
  const [sources, inspections, conflicts, spec, storedSourceEvidence, generatedClaims, evidenceMap, previousGeneratedOutput] = await Promise.all([
    store.listSources(run.id),
    store.listFileInspections(run.id),
    store.listSourceConflicts(run.id),
    store.getArtifactSpec(run.id),
    store.listSourceEvidence(run.id),
    store.listGeneratedClaims(run.id),
    store.getEvidenceMap(run.id),
    store.getGeneratedOutput(run.id)
  ]);
  if (!spec) throw new Error(`No artifact spec found for ${run.id}.`);
  const effectiveSources = applySourcePrepDecisionsToSources({
    sources,
    decisions: sourcePrepReviewDecisionSet.decisions
  });
  const effectiveInspections = applySourcePrepDecisionsToInspections({
    inspections,
    decisions: sourcePrepReviewDecisionSet.decisions
  });
  const effectiveConflicts =
    run.profile === "legal" && legalReviewDecisionSet
      ? applyLegalConflictReviewDecisions({ conflicts, decisions: legalReviewDecisionSet.decisions })
      : run.profile === "general" && generalReviewDecisionSet
        ? applyGeneralConflictReviewDecisions({ conflicts, decisions: generalReviewDecisionSet.decisions })
      : conflicts;
  const generatedMode = run.profile === "general" && Boolean(previousGeneratedOutput || evidenceMap);
  const generatedSelection =
    generatedMode
      ? selectSourceEvidence({
          sources: effectiveSources,
          inspections: effectiveInspections,
          evidence: storedSourceEvidence
        })
      : undefined;
  const sourceEvidence =
    generatedSelection
      ? await store.replaceSourceEvidence(
          run.id,
          generatedSelection.evidence.map(({ runId: _runId, ...item }) => item)
        )
      : storedSourceEvidence;
  const refreshedGeneratedSelection = generatedSelection
    ? {
        ...generatedSelection,
        evidence: sourceEvidence,
        selectedEvidence: sourceEvidence.filter((item) => item.useStatus === "selected"),
        excludedEvidence: sourceEvidence.filter((item) => item.useStatus === "excluded")
      }
    : undefined;
  const findings = await store.replaceVerificationFindings(
    run.id,
    await buildHostileReviewFindings(store, run.id, {
      outputMode: generatedMode ? "generate" : undefined,
      generationBlockers: refreshedGeneratedSelection?.blockers,
      generationWarnings: refreshedGeneratedSelection?.warnings,
      legalReviewDecisions: legalReviewDecisionSet?.decisions,
      generalReviewDecisions: generalReviewDecisionSet?.decisions,
      sourcePrepReviewDecisions: sourcePrepReviewDecisionSet.decisions
    })
  );
  const trustReport = await evaluateTrust(store, run.id, {
    sourceConflicts: effectiveConflicts,
    outputMode: generatedMode ? "generate" : "review"
  });
  const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
  const updatedRun = await store.updateRunStatus(run.id, status);
  const generatedOutput =
    generatedMode && evidenceMap
      ? await finalizeGeneratedOutput({
          store,
          run: updatedRun,
          artifactKind: updatedRun.artifactKind,
          trustReport,
          evidenceMap,
          generatedClaims,
          notes: unique([
            ...(previousGeneratedOutput?.notes ?? []),
            ...(refreshedGeneratedSelection?.blockers ?? []).map((blocker) => `Blocker: ${blocker}`),
            ...(refreshedGeneratedSelection?.warnings ?? []).map((warning) => `Warning: ${warning}`),
            "Final Markdown is written only when the generated trust report is ready."
          ])
        })
      : undefined;
  const legalArtifacts =
    updatedRun.profile === "legal"
      ? await buildLegalRunArtifacts({
          store,
          run: updatedRun,
          reviewDecisions: legalReviewDecisionSet?.decisions,
          sourcePrepReviewDecisions: sourcePrepReviewDecisionSet.decisions
        })
      : undefined;

  await writeRunArtifacts({
    baseDir,
    run: updatedRun,
    sources,
    inspections,
    conflicts: effectiveConflicts,
    spec,
    findings,
    trustReport,
    sourceEvidence: generatedMode ? sourceEvidence : undefined,
    generatedClaims: generatedMode ? generatedClaims : undefined,
    evidenceMap: generatedMode ? evidenceMap : undefined,
    generatedOutput,
    sourceExclusions: generatedMode ? refreshedGeneratedSelection?.sourceExclusions : undefined,
    legalSourcePacket: legalArtifacts?.legalSourcePacket,
    legalOutputSpec: legalArtifacts?.legalOutputSpec,
    legalEvidenceMap: legalArtifacts?.legalEvidenceMap,
    legalDraftPropositions: legalArtifacts?.legalDraftPropositions,
    legalReviewDecisionSet,
    legalReuseLibrary: legalArtifacts?.legalReuseLibrary,
    generalReviewDecisionSet,
    sourcePrepReviewDecisionSet
  });
  const reviewQueue = buildReviewQueue({
    run: updatedRun,
    sources: effectiveSources,
    inspections: effectiveInspections,
    conflicts: effectiveConflicts,
    findings,
    trustReport,
    legalSourcePacket: legalArtifacts?.legalSourcePacket,
    sourcePrepReviewDecisionSet
  });
  console.log(args.json === true ? JSON.stringify(trustReport, null, 2) : renderReviewQueueCliSummary(reviewQueue));
} catch (error) {
  console.error(error instanceof Error ? error.message : `No runnable verification state found for ${runDir}`);
  exit(1);
}

function parseArgs(values: string[]) {
  const output: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index]?.replace(/^--/, "");
    if (!key) continue;
    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      output[key] = true;
    } else {
      output[key] = value;
      index += 1;
    }
  }
  return output;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

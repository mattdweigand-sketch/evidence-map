import { resolve } from "node:path";
import { writeRunArtifacts } from "../../artifacts/write.ts";
import type { EvidenceMapStore } from "../../db/store.ts";
import { buildEvidenceLinkSuggestions } from "../../evidence/suggestions.ts";
import { buildSourceEvidenceRecords } from "../../evidence/snippets.ts";
import { buildSourcePacket } from "../../ingest/source-packet.ts";
import { finalizeGeneratedOutput, prepareGeneratedOutput } from "../../generate/output.ts";
import { buildLegalRunArtifacts } from "../../legal/artifacts.ts";
import { buildArtifactSpec, seedCalculations, seedClaims } from "../../spec/build.ts";
import { evaluateTrust } from "../../trust/evaluate.ts";
import { runHostileReview } from "../../verify/hostile-review.ts";
import type { ArtifactKind, WorkflowProfile } from "../../types.ts";

export async function runEvidenceMapWorkflow(
  store: EvidenceMapStore,
  input: {
    baseDir: string;
    name: string;
    artifactKind: ArtifactKind;
    profile?: WorkflowProfile;
    inputPaths: string[];
    draftFiles?: string[];
    generate?: boolean;
  }
) {
  const resolvedInputPaths = input.inputPaths.map((path) => resolve(input.baseDir, path));
  const profile = input.profile ?? "general";
  if (input.generate && profile !== "general") {
    throw new Error("Generation mode is currently available only for the general workflow profile.");
  }
  const draftFiles = input.draftFiles ?? [];
  const run = await store.createRun({
    name: input.name,
    artifactKind: input.artifactKind,
    profile,
    inputPaths: resolvedInputPaths,
    draftFiles
  });

  try {
    const sourcePacket = await buildSourcePacket(resolvedInputPaths, { baseDir: input.baseDir });
    const sources = await store.createSources(run.id, sourcePacket.sources);
    const sourceIdByPath = new Map(sources.map((source) => [source.path, source.id]));
    const inspections = await store.createFileInspections(
      run.id,
      sourcePacket.inspections.map((inspection) => ({ ...inspection, sourceId: sourceIdByPath.get(inspection.path) }))
    );
    const conflicts = await store.createSourceConflicts(
      run.id,
      sourcePacket.conflicts.map(({ sourcePaths, ...conflict }) => ({
        ...conflict,
        sourceIds: sourcePaths.map((path) => sourceIdByPath.get(path)).filter((id): id is string => Boolean(id))
      }))
    );
    const inspectionNames = new Set(inspections.map((inspection) => inspection.name));
    const unknownDrafts = draftFiles.filter((name) => !inspectionNames.has(name));
    if (unknownDrafts.length > 0) {
      throw new Error(
        `Unknown draft file(s): ${unknownDrafts.join(", ")}. Draft names must match an inspected input file: ${[...inspectionNames].join(", ")}`
      );
    }
    const spec = await store.createArtifactSpec(buildArtifactSpec({ runId: run.id, artifactKind: input.artifactKind, name: input.name }));
    const claims = await store.createClaims(run.id, seedClaims({ runId: run.id, artifactKind: input.artifactKind, inspections, draftFiles }));
    const calculations = await store.createCalculations(run.id, seedCalculations({ artifactKind: input.artifactKind }));
    const preparedGeneratedOutput = input.generate
      ? await prepareGeneratedOutput({
          store,
          run,
          sources,
          inspections,
          artifactKind: input.artifactKind
        })
      : undefined;
    const reviewSourceEvidence =
      run.profile === "general" && !preparedGeneratedOutput
        ? await store.replaceSourceEvidence(
            run.id,
            buildSourceEvidenceRecords({
              runId: run.id,
              sources,
              inspections
            })
          )
        : undefined;
    const sourceEvidenceForSuggestions = preparedGeneratedOutput?.sourceEvidence ?? reviewSourceEvidence;
    const evidenceLinkSuggestions =
      run.profile === "general" && sourceEvidenceForSuggestions
        ? await store.replaceEvidenceLinkSuggestions(
            run.id,
            buildEvidenceLinkSuggestions({
              runId: run.id,
              claims,
              evidence: sourceEvidenceForSuggestions
            })
          )
        : undefined;
    const findings = await runHostileReview(
      store,
      run.id,
      preparedGeneratedOutput
        ? {
            outputMode: "generate",
            generationBlockers: preparedGeneratedOutput.selection.blockers,
            generationWarnings: preparedGeneratedOutput.selection.warnings
          }
        : undefined
    );
    const trustReport = await evaluateTrust(store, run.id, { outputMode: preparedGeneratedOutput ? "generate" : "review" });
    const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
    const updatedRun = await store.updateRunStatus(run.id, status);
    const generatedOutput = preparedGeneratedOutput
      ? await finalizeGeneratedOutput({
          store,
          run: updatedRun,
          artifactKind: input.artifactKind,
          trustReport,
          evidenceMap: preparedGeneratedOutput.evidenceMap,
          generatedClaims: preparedGeneratedOutput.generatedClaims,
          notes: [
            ...preparedGeneratedOutput.selection.blockers.map((blocker) => `Blocker: ${blocker}`),
            ...preparedGeneratedOutput.selection.warnings.map((warning) => `Warning: ${warning}`),
            "Final Markdown is written only when the generated trust report is ready."
          ]
        })
      : undefined;
    const legalArtifacts = updatedRun.profile === "legal" ? await buildLegalRunArtifacts({ store, run: updatedRun }) : undefined;
    const artifacts = await writeRunArtifacts({
      baseDir: input.baseDir,
      run: updatedRun,
      sources,
      inspections,
      conflicts,
      spec,
      calculations,
      evidenceLinkSuggestions,
      findings,
      trustReport,
      sourceEvidence: preparedGeneratedOutput?.sourceEvidence ?? reviewSourceEvidence,
      generatedClaims: preparedGeneratedOutput?.generatedClaims,
      evidenceMap: preparedGeneratedOutput?.evidenceMap,
      generatedOutput,
      sourceExclusions: preparedGeneratedOutput?.selection.sourceExclusions,
      legalSourcePacket: legalArtifacts?.legalSourcePacket,
      legalOutputSpec: legalArtifacts?.legalOutputSpec,
      legalEvidenceMap: legalArtifacts?.legalEvidenceMap,
      legalDraftPropositions: legalArtifacts?.legalDraftPropositions,
      legalReuseLibrary: legalArtifacts?.legalReuseLibrary
    });

    return {
      run: updatedRun,
      sources,
      inspections,
      conflicts,
      spec,
      findings,
      trustReport,
      sourceEvidence: preparedGeneratedOutput?.sourceEvidence ?? reviewSourceEvidence,
      generatedClaims: preparedGeneratedOutput?.generatedClaims,
      evidenceMap: preparedGeneratedOutput?.evidenceMap,
      evidenceLinkSuggestions,
      sourceExclusions: preparedGeneratedOutput?.selection.sourceExclusions,
      generatedOutput,
      artifacts
    };
  } catch (error) {
    await store.updateRunStatus(run.id, "failed");
    throw error;
  }
}

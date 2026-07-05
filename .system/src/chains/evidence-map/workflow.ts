import { resolve } from "node:path";
import { writeRunArtifacts } from "../../artifacts/write.ts";
import type { EvidenceMapStore } from "../../db/store.ts";
import { buildSourcePacket } from "../../ingest/source-packet.ts";
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
  }
) {
  const resolvedInputPaths = input.inputPaths.map((path) => resolve(input.baseDir, path));
  const run = await store.createRun({
    name: input.name,
    artifactKind: input.artifactKind,
    profile: input.profile ?? "general",
    inputPaths: resolvedInputPaths
  });

  try {
    const sourcePacket = await buildSourcePacket(resolvedInputPaths);
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
    const spec = await store.createArtifactSpec(buildArtifactSpec({ runId: run.id, artifactKind: input.artifactKind, name: input.name }));
    await store.createClaims(run.id, seedClaims({ runId: run.id, artifactKind: input.artifactKind }));
    await store.createCalculations(run.id, seedCalculations({ artifactKind: input.artifactKind }));
    const findings = await runHostileReview(store, run.id);
    const trustReport = await evaluateTrust(store, run.id);
    const status = trustReport.readiness === "ready" ? "export_ready" : trustReport.readiness === "needs_review" ? "waiting_for_review" : "blocked";
    const updatedRun = await store.updateRunStatus(run.id, status);
    const legalArtifacts = updatedRun.profile === "legal" ? await buildLegalRunArtifacts({ store, run: updatedRun }) : undefined;
    const artifacts = await writeRunArtifacts({
      baseDir: input.baseDir,
      run: updatedRun,
      sources,
      inspections,
      conflicts,
      spec,
      findings,
      trustReport,
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
      artifacts
    };
  } catch (error) {
    await store.updateRunStatus(run.id, "failed");
    throw error;
  }
}

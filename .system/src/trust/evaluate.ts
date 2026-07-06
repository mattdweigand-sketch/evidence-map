import type { EvidenceMapStore } from "../db/store.ts";
import type { Readiness, SourceConflict, TrustReport } from "../types.ts";

export async function evaluateTrust(
  store: EvidenceMapStore,
  runId: string,
  options: { sourceConflicts?: SourceConflict[] } = {}
): Promise<TrustReport> {
  const sources = await store.listSources(runId);
  const claims = await store.listClaims(runId);
  const calculations = await store.listCalculations(runId);
  const assumptions = await store.listAssumptions(runId);
  const findings = await store.listVerificationFindings(runId);
  const conflicts = options.sourceConflicts ?? (await store.listSourceConflicts(runId));

  const blockingIssues = [
    ...findings.filter((finding) => finding.severity === "must_fix").map((finding) => `${finding.location}: ${finding.issue}`),
    ...conflicts.filter((conflict) => conflict.status === "open" && conflict.severity === "blocking").map((conflict) => conflict.description)
  ];
  const warnings = findings.filter((finding) => finding.severity === "should_fix").map((finding) => `${finding.location}: ${finding.issue}`);

  const needsReviewCount = findings.filter((finding) => finding.humanReviewRequired).length;
  const readiness: Readiness = blockingIssues.length > 0 ? "blocked" : needsReviewCount > 0 ? "needs_review" : "ready";

  return store.createTrustReport({
    runId,
    readiness,
    summary: {
      sourceCount: sources.length,
      claimCount: claims.length,
      calculationCount: calculations.length,
      assumptionCount: assumptions.length,
      findingCount: findings.length,
      blockingCount: blockingIssues.length,
      needsReviewCount
    },
    blockingIssues,
    warnings
  });
}

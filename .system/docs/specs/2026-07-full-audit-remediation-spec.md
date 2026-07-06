# Full Audit Remediation Spec

Status: ready to implement.
Origin: full repo audit on 2026-07-06.

## Summary

This spec corrects the six issues identified in the full repo audit:

1. Standalone `verify` reprocesses generated runs as review-only runs and can delete generated final artifacts.
2. Generated numeric claims accept non-date strings such as `TBD` as verified source dates.
3. CSV/table generation silently ignores rows and claims after internal caps while still reporting `ready`.
4. MCP input containment can be bypassed by symlinks inside an allowed input folder.
5. `JsonFileEvidenceMapStore` loses writes across multiple store instances or processes.
6. The MCP server reports version `0.1.0` while the package version is `0.3.2`.

The desired end state is not a broader product redesign. It is a reliability repair pass that preserves the current local, artifact-backed, Markdown-first workflow and closes the exact audit failures with regression tests.

## Ground Rules

- Keep changes inside the existing ownership boundaries in `AGENTS.md`.
- Do not add Postgres, external services, model calls, Office rendering, or external sending.
- Do not bypass verification gates.
- Do not move generated artifacts outside `deliverables/`.
- Add failing regression coverage before changing each behavior.
- `npm --prefix .system run typecheck` and `npm --prefix .system test` must pass after each phase.
- Any cap that can affect final output completeness must be visible in artifacts and must block generated export unless the output explicitly states it is partial. This repo currently has no partial-output export mode, so caps block export.

## Phase 0: Lock In Regression Tests

Add tests that reproduce the audit failures before implementation. Use temporary directories and avoid writing to repo `deliverables/`.

Required tests:

- `.system/tests/workflow.test.ts`: `verify command preserves generated output mode and final artifacts`.
- `.system/tests/workflow.test.ts` or a focused evidence test: `generated metric dates must be valid dates`.
- `.system/tests/workflow.test.ts` or `.system/tests/source-packet.test.ts`: `CSV generation does not silently drop rows beyond 100`.
- `.system/tests/mcp-server.test.ts`: `MCP source packet rejects symlink targets outside baseDir`.
- `.system/tests/json-store.test.ts`: `JSON store serializes writes across store instances`.
- `.system/tests/mcp-server.test.ts` or a focused version test: `MCP server version matches package version`.

Acceptance:

- Each test fails against the current implementation for the intended reason.
- No test depends on existing ignored files under repo `deliverables/`.
- The tests assert artifacts and persisted store state, not only returned objects.

## Phase 1: Preserve Generated Run State In Verify

Files:

- `.system/scripts/verify.ts`
- `.system/src/chains/evidence-map/workflow.ts`
- `.system/src/generate/output.ts`
- `.system/src/artifacts/write.ts`
- `.system/src/evidence/select.ts`
- `.system/src/trust/evaluate.ts`
- `.system/tests/workflow.test.ts`

Problem:

`runEvidenceMapWorkflow` evaluates generated runs with `outputMode: "generate"` and passes generated evidence, generated claims, evidence map, generated output, and source exclusions into `writeRunArtifacts`. Standalone `verify` only reloads the review-mode records. It calls hostile review and trust without generated context, then calls `writeRunArtifacts` without generated artifacts. The export writer infers review mode and can remove `final-output.md`, generated receipts, and formatted output.

Implementation:

1. Add a helper that loads generated-run context from the store:
   - `sourceEvidence = await store.listSourceEvidence(run.id)`
   - `generatedClaims = await store.listGeneratedClaims(run.id)`
   - `evidenceMap = await store.getEvidenceMap(run.id)`
   - `previousGeneratedOutput = await store.getGeneratedOutput(run.id)`
2. Treat a general run as generated mode only when it has a generated output record or generated evidence-map records. Do not infer generated mode from `--generate`, because verify reads an existing run.
3. For generated mode, rederive selection state from persisted sources, inspections, and source evidence with `selectSourceEvidence`. Use that result for:
   - `sourceExclusions`
   - `generationBlockers`
   - `generationWarnings`
4. Call `buildHostileReviewFindings` with `outputMode: "generate"` and the rederived generation blockers/warnings.
5. Call `evaluateTrust(store, run.id, { sourceConflicts: effectiveConflicts, outputMode: "generate" })`.
6. After updating run status, create a fresh generated output record that reflects the new trust result. Reuse the existing `finalizeGeneratedOutput` helper if possible. Preserve prior generated-output notes and append current blocker/warning notes.
7. Call `writeRunArtifacts` with all generated records:
   - `sourceEvidence`
   - `generatedClaims`
   - `evidenceMap`
   - `generatedOutput`
   - `sourceExclusions`
8. Keep review-only and legal verify behavior unchanged except for shared helper extraction.

Acceptance:

- A clean generated run remains `ready` after `npm --prefix .system run verify -- --base-dir <tmp> --run deliverables/<slug> --json`.
- `04_export/final-output.md`, `generated-output-receipt.json`, `formatted-output.md`, and `formatting-receipt.json` still exist after verify.
- The verify output does not resurrect seeded review-only unsupported claims for generated mode.
- Re-running verify twice is idempotent: latest trust report is still `ready`, final artifacts remain, and finding count does not grow.

## Phase 2: Require Valid Source Dates For Generated Numeric Claims

Files:

- `.system/src/date-candidates.ts`
- `.system/src/evidence/map.ts`
- `.system/src/verify/hostile-review.ts`
- `.system/src/generate/markdown.ts`
- `.system/tests/workflow.test.ts`

Problem:

`metricValueClaims` accepts `as_of_date` or `date` as a raw string and marks the generated claim verified when the string is merely truthy. Hostile review checks only that `sourceDates.length > 0`. A row with `as_of_date=TBD` can produce a ready final output.

Implementation:

1. Add a shared source-date normalization helper. It should return an ISO `YYYY-MM-DD` string or `undefined`.
2. Accept only full-field valid dates. Supported inputs may include:
   - `YYYY-MM-DD`
   - already supported strict date candidates that normalize unambiguously to ISO
3. Reject arbitrary non-date text. `TBD`, `current`, `unknown`, and mixed text without a parseable full date must return `undefined`.
4. Use the helper when:
   - building metric value claims from `as_of_date` or `date`
   - falling back to `SourceEvidenceRecord.sourceDate`
   - validating generated claim `sourceDates` in hostile review
5. If a numeric generated claim has no valid source date, mark it `unsupported` or produce a `must_fix` finding. It must not be export-ready.
6. Render receipts should not describe a numeric claim as dated when the date was invalid.

Acceptance:

- CSV row `metric,value,as_of_date` plus `active_users,42,TBD` produces no `final-output.md`.
- The trust report is `blocked`.
- Verification findings include a must-fix issue naming the invalid or missing generated numeric claim source date.
- CSV row `active_users,42,2026-05-01` remains ready and renders `as of 2026-05-01`.

## Phase 3: Remove Silent CSV And Claim Truncation

Files:

- `.system/src/inspect/index.ts`
- `.system/src/evidence/snippets.ts`
- `.system/src/evidence/map.ts`
- `.system/src/evidence/select.ts`
- `.system/src/verify/hostile-review.ts`
- `.system/src/types.ts`
- `.system/src/generate/output.ts`
- `.system/tests/workflow.test.ts`
- `.system/tests/source-packet.test.ts`

Problem:

Delimited inspection stores only header plus first 100 rows. Snippet generation and generated claims can only see those rows. `buildGeneratedClaims` then silently slices generated claims to 100. Runs can be `ready` while data after row 100 is omitted.

Implementation:

1. Replace the current hidden `rows: nonEmptyRows.slice(0, 101)` behavior with explicit capture metadata:
   - `rowCount`
   - `nonEmptyRowCount`
   - `capturedRowCount`
   - `omittedRowCount`
   - `rowCaptureLimit`
   - `rowCaptureTruncated`
2. Capture all non-empty rows for normal source sizes. The 151-row audit fixture must be fully captured.
3. Keep a bounded maximum for pathological files, but make the bound explicit. If rows are omitted, add an inspection warning and a generated-mode blocker.
4. Update `buildTableRowSnippets` to use all captured data rows, not only the first 100.
5. Remove the silent `dedupeClaims(claims).slice(0, 100)` in `buildGeneratedClaims`.
6. If a generated-claim cap is still needed for safety, return it as generation metadata and block export when the cap omits candidate claims. Do not silently return a partial generated output.
7. If source evidence is capped globally, expose the cap as metadata and block export when selected candidate evidence was omitted.
8. Preserve compact Markdown rendering by limiting display length, not by hiding support records from verification.

Acceptance:

- A 151-row metrics CSV produces generated claims for rows after 100, including a late final row.
- The run is `ready` only if every generated numeric claim has a valid source date.
- A file above the configured row or evidence cap is not `ready`; it writes a refusal explaining the truncation.
- `source-inventory.json`, `file-inspections.json`, `source-evidence.json`, `generated-claims.json`, and `evidence-map.json` expose the capture counts needed to understand what was included or refused.
- No code path that affects final support uses an unexplained `.slice(0, 100)` or `.slice(0, 500)`.

## Phase 4: Enforce Realpath Containment For Input Paths

Files:

- `.system/src/mcp/server.ts`
- `.system/src/chains/evidence-map/workflow.ts`
- `.system/src/ingest/expand-input-paths.ts`
- `.system/src/ingest/source-packet.ts`
- `.system/src/inspect/index.ts`
- `.system/tests/mcp-server.test.ts`
- `.system/tests/source-packet.test.ts`

Problem:

MCP validates lexical resolved paths under `baseDir`, but symlinks inside the allowed tree can point outside `baseDir`. `expandInputPaths` uses `stat`, which follows symlinks, and inspection reads the target content.

Implementation:

1. Make workspace input resolution realpath-aware.
2. Resolve and validate:
   - `realBaseDir = await realpath(baseDir)`
   - each requested input realpath
   - each recursively expanded file realpath
3. Reject any real path whose `relative(realBaseDir, realPath)` starts with `..` or is absolute.
4. Use `lstat` during expansion so symlinks can be detected intentionally.
5. Allow symlinks only when their target realpath remains inside `baseDir`.
6. Return a tool error for MCP and throw a clear workflow error for CLI/workflow calls.
7. Error messages must name the original input path and state that the real path escapes `baseDir`.
8. Keep the existing comment that this is a convention rail, not a complete security sandbox.

Acceptance:

- MCP inspect rejects `input/project/linked-private.md` when it is a symlink to `<tmp>/outside/private-source.md`.
- Workflow run rejects the same symlink path before building a source packet.
- The outside file content does not appear in source previews, source evidence, or generated output.
- A symlink to a file inside `baseDir` is accepted or explicitly rejected by documented policy, but the behavior must be tested.

## Phase 5: Make JSON Store Writes Safe Across Store Instances

Files:

- `.system/src/db/json-file-store.ts`
- optional new `.system/src/db/file-lock.ts`
- `.system/tests/json-store.test.ts`

Problem:

The JSON store serializes operations only per object instance. Two `JsonFileEvidenceMapStore` instances pointing to the same file use the same temp path and perform independent load-modify-save cycles. Concurrent writes can fail with `ENOENT` during rename or lose records.

Implementation:

1. Keep the per-instance operation queue.
2. Add a file-level lock shared across store instances and processes.
3. Use an atomic lock directory such as `<store>.lock` with retry and timeout.
4. Hold the lock across the full load-modify-save cycle for every mutating operation.
5. Use unique temp paths for saves, such as `<store>.<pid>.<random>.tmp`, then rename over the target.
6. Remove the temp file on failed writes when possible.
7. Release the lock in `finally`.
8. Reads may remain unlocked if they tolerate atomic rename, but mutating helpers must not load stale data outside the lock.
9. If the lock cannot be acquired before timeout, throw a clear error naming the store path.

Acceptance:

- Two independent `JsonFileEvidenceMapStore` instances concurrently writing 20 source records to the same run all fulfill.
- Reloading the store returns all 20 records.
- The test fails if any promise rejects or any source is lost.
- The existing single-instance concurrency test still passes.
- No shared `.tmp` path remains in `save`.

## Phase 6: Sync MCP Server Version With Package Version

Files:

- `.system/src/mcp/server.ts`
- `.system/package.json`
- optional new `.system/src/version.ts`
- `.system/tests/mcp-server.test.ts`

Problem:

The MCP server constructor reports `0.1.0`, while `.system/package.json` declares `0.3.2`.

Implementation:

1. Introduce one source of truth for the runtime package version.
2. Use that value in `createEvidenceMapMcpServer`.
3. Do not hardcode `0.3.2` in `server.ts`; otherwise the same bug will recur.
4. Add a test that fails when the server version constant and package version drift.

Acceptance:

- `server.ts` no longer contains `version: "0.1.0"`.
- The test compares the exported runtime version to `.system/package.json`.
- Typecheck passes under the current NodeNext TypeScript config.

## Final Verification

Run all commands from the repo root:

```bash
npm --prefix .system run typecheck
npm --prefix .system test
npm --prefix .system audit --omit=dev --json
npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate
npm --prefix .system run verify -- --run "$(find deliverables -maxdepth 1 -type d -name 'capstone-report-*' | sort | tail -n 1)" --json
```

Expected final state:

- Typecheck passes.
- Tests pass.
- Production dependency audit reports zero vulnerabilities.
- Capstone generated run remains generated-mode after verify.
- Ready generated artifacts are not deleted by verify.
- Invalid date strings do not pass as verified source dates.
- CSV rows beyond 100 are either included in generated support or cause an explicit export refusal.
- Symlinks escaping `baseDir` are rejected before content import.
- Cross-instance JSON store writes preserve all records.
- MCP server version matches `.system/package.json`.

## Completion Definition

The remediation is complete only when every audit finding above has:

- a code fix,
- a regression test,
- an artifact-level assertion where artifacts are involved,
- green typecheck and test output,
- and no unrelated refactor or product expansion in the same change.

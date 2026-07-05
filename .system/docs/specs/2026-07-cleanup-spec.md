# Cleanup Spec: July 2026 Audit Fixes

Status: approved, ready to implement.
Origin: full repo audit on 2026-07-05. This spec corrects the functional bugs and hygiene issues found. It deliberately does not chase a 60/30/10 data/code/prompt allocation; this harness is intentionally code-heavy.

## Ground rules

- Work module by module and respect the ownership boundaries in `AGENTS.md`.
- `npm --prefix .system run typecheck` and `npm --prefix .system test` must pass after every phase.
- All 13 existing tests stay green. Where a fix intentionally changes an expectation, this spec says so explicitly. Any other test change is a red flag: stop and re-check the fix.
- Each work item below lists its own acceptance criteria. Add the new tests it names.
- After all phases, re-run the README quickstart against `input/examples/capstone-report` and confirm the planted problems are still caught (see Final Verification).

## Out of scope

- Review-loop MCP tools (resolve claim, attach evidence, close conflict). Roadmap item, not this spec.
- Postgres adapter, store compaction, or multi-run history. Roadmap.
- PPTX/DOCX/PDF deep parsers. Roadmap.
- Removing the seeded claim/calculation records. Seeding is intentional design: it forces the human to supply real claims before export.

---

## Phase 1: Correctness

### 1.1 Stop flagging assumptions and checks sheets as hardcode zones

File: `src/inspect/xlsx.ts`

Problem: `hasCalculationPurpose` (line 100) includes `"assumptions"` and `"checks"`. Numeric constants are the expected content of those sheets, so every real-world workbook with a proper assumptions tab gets flagged as containing hardcodes. Header-row numbers (year labels like 2024, 2025) on calculation sheets are also flagged.

Fix:
- Restrict the calculation-zone set to `["calculations", "outputs"]`.
- Track which row `getHeaderCandidates` selected (return the row number alongside the values) and exclude that row from hardcode flagging.

Acceptance:
- New unit test: a workbook with an "Assumptions" sheet containing numeric constants produces zero hardcode findings for that sheet.
- New unit test: numeric year labels in the detected header row of a calculation sheet are not flagged.
- Existing `workbook-doctor.test.ts` assertions still pass (the "Model" sheet remains a calculation zone and `D4 = 42` in a formula row is still caught).

### 1.2 Consolidate the two-pass hardcode detection

File: `src/inspect/xlsx.ts`

Problem: The pass-1 condition `(rowFormulaCounts.get(rowNumber) ?? 0) > 0` (line 115) only sees formulas that appeared earlier in the row and is fully subsumed by the pass-2 re-scan (lines 128-146). Pass 2 re-scans the entire row once per formula in it, pushing duplicates that only survive because `dedupeHardcodes` cleans them up. `dedupeHardcodes` is also computed twice (lines 162 and 164), and `getNumber` has a dead branch (line 241) that returns the same `undefined` as the fall-through.

Fix:
- Single collection pass: record all non-formula numeric cells and all formula cells per row.
- Single flagging pass afterward: for each row, flag non-formula numerics if the row contains at least one formula ("numeric constant in formula row") or the sheet is a calculation zone ("numeric constant on calculation-like sheet"), excluding the header row per 1.1. Each cell is flagged at most once; prefer the calculation-sheet reason when both apply.
- Compute `dedupeHardcodes` once (or make it unnecessary by construction).
- Delete the dead `getNumber` branch. Keep a one-line comment stating that formula-result objects are deliberately not treated as numeric constants.

Acceptance:
- Identical flagged cell addresses as before on the existing test workbook (the set, not the order).
- No duplicate addresses in `hardcodedNumbers` before any dedupe call.

### 1.3 Fix the capped hardcode warning count

File: `src/inspect/xlsx.ts`

Problem: `hardcodeIssues` is built from `sheet.hardcodedNumbers.slice(0, 25)` per sheet, and the warning string reports `hardcodeIssues.length`, while `structuredSummary.workbook.hardcodedNumberCellCount` reports the uncapped count. The two disagree past 25 hardcodes per sheet.

Fix: Report the uncapped total in the warning. Keep the 25-per-sheet cap on the detailed `hardcodeIssues` list, and when the cap truncates, append "(showing first N per sheet)" to the warning so the truncation is visible.

Acceptance: New unit test with 30+ hardcodes on one sheet asserts the warning shows the true total and the truncation note.

### 1.4 Rename the misnamed inspection map

File: `src/verify/hostile-review.ts`

Problem: `sourceByInspectionId` (line 25) actually maps sourceId to inspection, the opposite of its name. Inspections without a `sourceId` all collide on the `undefined` key.

Fix: Rename to `inspectionBySourceId` and skip entries whose `sourceId` is undefined when building the map.

Acceptance: Typecheck and existing tests pass. No behavior change expected.

### 1.5 Validate CLI arguments

File: `scripts/run.ts`

Problem: `--kind` is cast unchecked (`as ArtifactKind`), so `--kind banana` silently runs with fallback document structure.

Fix: Validate `kind` against the five allowed values (reuse a single exported list or the zod enum from `src/mcp/server.ts`; put the shared constant in `src/types.ts` so both import it). On an invalid kind, print usage listing the valid kinds and exit 1.

Acceptance: New test (execFile the script, same pattern as the verify-command test in `workflow.test.ts`) asserts `--kind banana` exits nonzero with the valid kinds in stderr.

### 1.6 Date candidate improvements

File: `src/date-candidates.ts`

Problem: Single-digit US dates ("4/12/2026") are missed because the MM/DD/YYYY pattern requires two digits. The compact YYYYMMDD pattern accepts mixed separators ("2026-0430").

Fix:
- Extend the US pattern to accept one- or two-digit month and day with separators. Zero-pad in `toIsoDate` output so results stay ISO.
- In the year-first pattern, require the two separators to match using a backreference (`([-_/]?)` then `\1`), so "2026-04-30", "2026_04_30", and "20260430" match but "2026-0430" does not.

Acceptance:
- New unit tests: "4/12/2026" yields "2026-04-12"; "2026-0430" yields nothing; "20260430" yields "2026-04-30".
- Existing `source-packet.test.ts` inference test still passes ("goldman-2026-19-39" yields no date).

---

## Phase 2: Hygiene and efficiency

### 2.1 Extract duplicated store helpers

Files: `src/db/json-file-store.ts`, `src/db/memory-store.ts`, new `src/db/ids.ts`

Problem: `slugify`, `createRunSlug`, and `createId` are copy-pasted between the two stores. `memory-store.ts` also exports `slugify`, which nothing imports.

Fix: Move the three helpers to `src/db/ids.ts`. Both stores import from it. Drop the stray export from `memory-store.ts`.

Acceptance: Typecheck and tests pass. `grep -rn "function slugify" src` returns exactly one hit.

### 2.2 Atomic, serialized JSON store writes

File: `src/db/json-file-store.ts`

Problem: `save` writes the store file in place (a crash mid-write corrupts it), and there is no in-process serialization, so overlapping MCP tool calls can interleave load/save and drop writes.

Fix:
- Write to `<path>.tmp` then `rename` over the target.
- Serialize all store operations through a simple promise-chain mutex (each public method awaits the previous operation before its load/save cycle).

Acceptance:
- New unit test: fire 10 concurrent `createSources` calls for the same run against one store instance; the reloaded file contains all 10 records.
- Existing persistence-across-reload test still passes.

### 2.3 Stop buffering whole files for small reads

File: `src/inspect/index.ts`

Problem: `readBytes` and `readSmallText` (lines 171-179) read the entire file into memory to inspect 4-5 bytes or 250KB. A large PPTX/PDF gets fully buffered for a metadata-only inspection.

Fix: Use `fs/promises` `open` plus `FileHandle.read` with an allocated buffer of the needed length. Close handles in `finally`.

Acceptance: Existing inspection tests pass unchanged. No behavior change; this is memory only.

### 2.4 Expand and stat input paths once

Files: `src/ingest/source-packet.ts`, `src/inspect/index.ts`

Problem: `buildSourcePacket` calls `expandInputPaths`, then `buildFileInspections` calls it again on the already-expanded list, and `toSourceRecord` stats each file a third time.

Fix: `buildSourcePacket` expands once and stats each file once, passing `{ path, stat }` (or the stat fields it needs) into both the source-record builder and a new `inspectFiles(files)` entry point that skips re-expansion. Keep `inspectFile(path)` as a public wrapper for tests and the inspect script.

Acceptance: Existing tests pass. `buildSourcePacket` on a directory triggers exactly one `stat` per file (verify by reading the code path, no test required).

### 2.5 Type the MCP tool result and fix descriptions

File: `src/mcp/server.ts`

Problem: `jsonToolResult` returns `any`. Three tool descriptions use the wrong article before "evidence-map run".

Fix: Return the SDK's `CallToolResult` type. Change descriptions to "an evidence-map run".

Acceptance: Typecheck passes with the `any` removed.

### 2.6 Guard MCP input paths to the workspace

File: `src/mcp/server.ts`

Problem: `inputPaths` resolved against `baseDir` can escape the workspace via `..` or absolute paths. The AGENTS.md rule about not importing unrelated material is currently prompt-only.

Fix: In both `evidencemap_inspect_source_packet` and `evidencemap_run_workflow`, after resolving, reject any input path that is not inside `baseDir` (compare with `path.relative`; reject when it starts with `..` or is absolute). Error message names the offending path. This is a convention rail, not a security boundary: the client still chooses `baseDir`. Say exactly that in a code comment.

Acceptance:
- New MCP test: an `inputPaths` entry of `"../outside"` returns a tool error naming the path.
- Existing MCP tests pass (they use relative paths inside a tmp `baseDir`).

### 2.7 Remove the dead run status

Files: `src/types.ts`

Problem: `RunStatus` includes `"completed"`, which nothing assigns or reads.

Fix: Remove `"completed"` from the union. Leave `SourceStatus "current"` in place: it is the documented label the future review loop will assign.

Acceptance: Typecheck passes.

### 2.8 Cover the currently unreachable review rules with unit tests

Files: new `tests/hostile-review.test.ts`

Problem: The assumption findings (`hostile-review.ts:112-136`) and the stale-source claim loop (lines 76-93) are unreachable through today's adapters because nothing creates assumptions or claims with sourceIds. The logic is part of the contract for the roadmap review loop, so it stays, but it currently ships untested.

Fix: Add unit tests that drive `buildHostileReviewFindings` directly against a `MemoryEvidenceMapStore` seeded with:
- an unsupported assumption without an owner (expect "not decision-ready" plus "lacks an owner", both must_fix),
- an estimate assumption with an owner (expect should_fix only),
- a claim whose sourceId points to a superseded source (expect the stale-source should_fix),
- a claim whose source has numbers but no date on either source or inspection (expect the must_fix).

Acceptance: New tests pass; no production code change beyond what 1.4 already touched.

---

## Phase 3: Documentation

### 3.1 Fix grammar

Files: `src/mcp/server.ts` (covered by 2.5), `.Codex/commands/run.md`, `.Codex/commands/verify.md`

The wrong article before "evidence-map" becomes "an evidence-map" everywhere. `grep -rn "a[ ]evidence-map" --include="*.md" --include="*.ts" .` returns nothing when done (run from repo root, excluding node_modules).

### 3.2 Condense the companion guide

File: `.system/docs/companion-guide.md`

Problem: 471 lines, 40% of repo prose. Duplicated H1 (lines 8 and 10). Newsletter frontmatter and an external Substack framing. Its prompt kits are not wired to anything and restate checks that `hostile-review.ts` and `workbook-findings.ts` enforce deterministically, which invites drift.

Fix: Condense to roughly 120 lines:
- Keep: the Pain Map (trimmed) and the Primitive Model. They are the design rationale nothing else captures.
- Cut: all four prompt kits and their checklists. The harness implements those checks; the runbook operationalizes the workflow.
- Fix the duplicate H1, drop the frontmatter, keep a single closing line crediting the upstream article with the existing link.
- Add one sentence up front: the deterministic checks from the original prompt kits now live in `src/verify/` and `src/inspect/`, and `docs/runbook.md` is the operating workflow.

### 3.3 De-duplicate the module ownership list

Files: `AGENTS.md`, `CONTRIBUTING.md`, `.system/docs/architecture.md`

The list exists in triplicate. `AGENTS.md` keeps the canonical copy. `CONTRIBUTING.md` and `architecture.md` replace their copies with one line pointing to AGENTS.md, keeping any surrounding rules ("put new behavior in the module that owns it", the store rule) that are not the list itself.

### 3.4 De-duplicate the target-artifacts paragraph

Files: `AGENTS.md`, `.system/docs/prd.md`

The paragraph is verbatim in both. `prd.md` keeps it; `AGENTS.md` replaces it with a one-line summary plus a pointer to prd.md.

### 3.5 Cut the README repetition

File: `README.md`

The "not a generator" point appears in the intro (line 7) and again in "What This Is Not" (line 74). Keep the intro sentence. Rewrite "What This Is Not" to carry only what the intro does not: the premise that AI makes files that look finished before they are true, and the examples. Do not restate the generator disclaimer.

### 3.6 Point trust-layer records at types.ts

File: `.system/docs/trust-layer.md`

The Required Records section duplicates `src/types.ts` field-by-field and will drift. Replace the four field lists with one line per record type stating its purpose and a pointer to the interface in `src/types.ts`. Keep the Readiness Rules section as is; it describes behavior, not fields.

### 3.7 Document that v1 runs always block

Files: `.system/docs/trust-layer.md`, `README.md` (one sentence), `ROADMAP.md` (touch only if wording needs alignment)

Problem: Every run seeds a guaranteed-blocking record (unsupported claim for non-workbook kinds, risk-flagged calculation for workbook and mixed), and no tool can resolve findings. `readiness: "ready"`, `RunStatus "export_ready"`, and the `EXPORT_READY`/`HUMAN_REVIEW` gates are unreachable until the review-loop tools land. The docs present these states as live.

Fix: Add a short "Current limitation" note to trust-layer.md: v1 runs always land blocked or needs_review by design; the ready path activates when the review-loop MCP tools (see ROADMAP.md) can resolve seeded claims and findings. Add one sentence to the README near the MCP section. Do not remove the gate code; it is the contract the roadmap fills in.

---

## Final verification

1. `npm --prefix .system run typecheck` passes.
2. `npm --prefix .system test` passes, including all new tests.
3. Delete any stale local store (`deliverables/evidence-map-store.json`), then run the README quickstart:
   `npm --prefix .system run run -- --name "capstone-report" --kind document --input input/examples/capstone-report`
   Confirm the verification report still catches every planted problem: the two hardcoded numbers on the calculation sheet, the hidden sheet, the missing checks sheet, the missing source date, the enrollment-figures conflict, and the unsourced seeded claim. Confirm the clean file (`2026-04-12-survey-raw-export.csv`) still produces no findings.
4. If finding counts in the README sample output changed as a result of 1.1/1.2 (they should not for this example, but verify), update the abridged table in README.md to match real output. The README promises "real output, not a mockup"; keep that true.
5. The article-grammar grep for `a[ ]evidence-map` across `*.md` and `*.ts` files (excluding node_modules) returns nothing.

# End-to-End Verified Output Refactor Spec

Status: ready to dispatch.
Origin: July 2026 repo review asking what remains before an agent can receive a messy folder and generate a verified output.

## Summary

Refactor the general workflow from "review packet only" into a Markdown-first end-to-end harness:

1. Ingest a messy local source folder.
2. Build a source packet and source evidence snippets.
3. Select only usable evidence for the requested output.
4. Generate a structured Markdown output from verified claims.
5. Refuse final export when the output cannot be verified.
6. Preserve every warning, exclusion, decision, and receipt under `deliverables/`.

This is a single-orchestrator workflow refactor. Do not introduce multi-agent coordination, Postgres, external model calls, native Office rendering, OCR, or external sending. The target final artifact for this pass is local Markdown plus JSON receipts.

## Harness Shape

Mode: design + evaluation.

Product shape: workflow orchestrator with CLI and MCP adapters.

Why: the job is not open-ended chat. It is a staged local workflow with typed records, verification gates, receipts, and artifact writes. MCP remains the primary interactive surface; CLI remains the smoke-test and automation surface.

## Goal

After implementation, this command should be possible:

```bash
npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate
```

Expected result:

- The run creates the normal source packet, artifact spec, hostile review, trust report, and export gate.
- The run also creates an evidence packet and generated output artifacts.
- If all generated-output claims are verified, `04_export/final-output.md` and a ready manifest are written.
- If not verified, no final output is written; `04_export/general-export-refusal.md` explains exact blockers.

For the shipped `input/examples/capstone-report` fixture, the intended end state is a ready Markdown output that uses the current survey export, final enrollment figures, and qualitative interview notes while excluding the old enrollment figures and the suspect workbook from final support. The output must make those exclusions visible.

## Non-Goals

- Do not generate `.docx`, `.pptx`, or `.xlsx` files.
- Do not add a model provider, API key, prompt runner, or hidden LLM step.
- Do not add Postgres or a production database.
- Do not bypass verification gates.
- Do not hide unused-source problems; carry them in the packet and output receipt.
- Do not make legal-profile behavior less strict.
- Do not remove existing review-decision tools.

## Current Baseline

The repo already has:

- Source inventory, recursive input expansion, date inference, and status inference in `src/ingest/`.
- Inspectors for CSV/TSV, Markdown/TXT, PDF text, DOCX, PPTX, and XLSX in `src/inspect/`.
- Generic claim/calculation records and seeded unsupported claims/calculations in `src/spec/build.ts`.
- Hostile review and trust reports in `src/verify/` and `src/trust/`.
- General review-decision tools and audited review files in `src/review/` and `src/mcp/server.ts`.
- General export receipts and approved user-supplied artifact copy receipts in `src/export/`.
- Legal profile artifacts under `src/legal/`.

Current missing pieces:

- No general generated final output.
- No reusable evidence-snippet layer.
- No general evidence map that links each generated claim to a source anchor/quote/date.
- Verification still treats too many folder-level problems as run blockers, even when those sources are not used by the final output.
- General claim extraction is partial: deterministic PPTX slide/notes claims exist, but document/report generation is not evidence-driven.

## Target Architecture

Add these modules under `.system/src/`:

- `evidence/snippets.ts`: converts source records plus file inspections into source evidence snippets.
- `evidence/select.ts`: ranks and filters evidence snippets for a requested output.
- `evidence/map.ts`: maps generated claims to evidence snippets and source IDs.
- `generate/markdown.ts`: renders deterministic Markdown output from verified evidence-map records.
- `generate/output.ts`: orchestrates output generation, refusal, receipts, and manifest inputs.
- `format/`: renders deterministic formatted Markdown derivatives after generated-output readiness without changing claims, evidence selection, or readiness.

Extend existing modules:

- `types.ts`: add source evidence, generated claim, evidence map, generated output, output mode, and source exclusion types.
- `db/store.ts`, `db/memory-store.ts`, `db/json-file-store.ts`: add create/list APIs for new records.
- `chains/evidence-map/workflow.ts`: add a generation stage after source prep/spec and before final export gate.
- `artifacts/write.ts`: write `02_artifact-spec/`, `03_verification/`, and `04_export/` artifacts for generated output.
- `export/general.ts`: allow ready manifests and receipts to describe generated Markdown final artifacts.
- `scripts/run.ts`: add `--generate` flag. Default remains existing review-only behavior.
- `mcp/server.ts`: add optional `generate: boolean` to `evidencemap_run_workflow`; default false.
- `docs/prd.md`, `docs/runbook.md`, `docs/trust-layer.md`, `docs/mcp.md`, `README.md`: document Markdown-first generation and refusal behavior.

## Data Model

Add these public types in `src/types.ts`. Field names can be adjusted for local style, but the semantics must remain.

```ts
export type OutputMode = "review" | "generate";

export type EvidenceSnippetKind =
  | "table_row"
  | "paragraph"
  | "slide_text"
  | "speaker_notes"
  | "workbook_sheet"
  | "workbook_cell"
  | "file_summary";

export interface SourceEvidenceRecord {
  id: string;
  runId: string;
  sourceId: string;
  sourceName: string;
  kind: EvidenceSnippetKind;
  anchor: string;
  text: string;
  sourceDate?: string;
  numberCandidates: string[];
  ownerCandidates: string[];
  reviewStatus: ReviewStatus;
  useStatus: "candidate" | "selected" | "excluded";
  exclusionReason?: string;
}

export interface GeneratedClaimRecord {
  id: string;
  runId: string;
  artifactLocation: string;
  claim: string;
  sourceIds: string[];
  evidenceIds: string[];
  assumptions: string[];
  sourceDates: string[];
  reviewStatus: ReviewStatus;
}

export interface EvidenceMapRecord {
  id: string;
  runId: string;
  profile: "general";
  artifactKind: ArtifactKind;
  generatedClaimIds: string[];
  selectedEvidenceIds: string[];
  excludedEvidenceIds: string[];
  summary: {
    generatedClaimCount: number;
    verifiedClaimCount: number;
    unsupportedClaimCount: number;
    selectedEvidenceCount: number;
    excludedEvidenceCount: number;
  };
}

export interface GeneratedOutputRecord {
  id: string;
  runId: string;
  profile: "general";
  artifactKind: ArtifactKind;
  format: "markdown";
  status: "candidate" | "export_ready" | "refused";
  pathRelativeToRun?: string;
  claimIds: string[];
  evidenceMapId: string;
  generatedAt: string;
  notes: string[];
}
```

Store APIs:

- `createSourceEvidence(runId, evidence)`
- `listSourceEvidence(runId)`
- `replaceSourceEvidence(runId, evidence)`
- `createGeneratedClaims(runId, claims)`
- `listGeneratedClaims(runId)`
- `replaceGeneratedClaims(runId, claims)`
- `createEvidenceMap(map)`
- `getEvidenceMap(runId)`
- `createGeneratedOutput(output)`
- `getGeneratedOutput(runId)`

Keep generated-output records separate from user-supplied final artifact receipts. The existing approved-artifact copy path stays intact.

## Evidence Snippet Builder

Create `src/evidence/snippets.ts`.

Input:

- `runId`
- persisted `SourceRecord[]`
- persisted `FileInspectionRecord[]`

Output:

- `SourceEvidenceRecord[]`

Rules:

- Every snippet has a stable ID based on run ID, source ID, kind, anchor, and normalized text.
- Snippet text is capped at 1,000 characters.
- Snippets with no meaningful text are skipped.
- Snippets inherit `sourceDate` from the source first, then inspection `sourceDateCandidates[0]`.
- `reviewStatus` starts as `needs_review` unless deterministic rules can mark it verified.
- `useStatus` starts as `candidate`.

Format-specific extraction:

- CSV/TSV: create `table_row` snippets from parsed rows. If current inspector does not preserve rows, add capped `rows` to `structuredSummary` for the first 100 non-empty rows.
- Markdown/TXT: add paragraph snippets. If current inspector only preserves preview, extend `structuredSummary` with capped `excerpts`.
- PDF: add page/paragraph snippets. Extend `inspect/pdf.ts` or `inspect/index.ts` so inspected PDFs expose capped paragraph excerpts with page anchors.
- DOCX: use existing paragraph excerpts and table previews.
- PPTX: use slide text and speaker notes from existing slide summaries.
- XLSX: create workbook-sheet summary snippets only. Do not use workbook values as final claim support unless they have a source date and no workbook-doctor must-fix findings.

## Source Selection

Create `src/evidence/select.ts`.

Purpose: messy folders include stale files, drafts, old snapshots, and broken workbooks. The generator must select usable evidence instead of blocking on every file-level problem.

Selection rules:

- Prefer sources with status `current`, `raw_data`, or `transcript`.
- Treat filenames containing `final`, `current`, `approved`, or `latest` as status `current` unless they also contain `old`, `archive`, `archived`, or `superseded`.
- Treat filenames containing `interview`, `notes`, `transcript`, or `call` as status `transcript`.
- Treat `old`, `archive`, `archived`, and `superseded` as excluded unless explicitly selected by a review decision.
- Treat failed inspections as excluded unless no alternative exists; if no alternative exists, block.
- Treat number-bearing snippets without source dates as unusable for numeric claims.
- Treat workbook snippets with hardcoded calculation-zone findings as unusable for numeric output claims unless a review decision resolves the risk.
- Resolve simple old/final conflicts deterministically by selecting the final/current source and excluding the old/superseded source.
- Do not auto-resolve conflicts between two current sources with different dated values for the same metric; block.

Every exclusion must produce a visible reason in artifacts.

## Generated Claims

Create deterministic claim generation in `src/generate/output.ts` or `src/evidence/map.ts`.

For this one-session pass, do not attempt prose-quality synthesis. Generate a structured report with claim rows/sections derived from selected evidence.

Claim generation rules:

- CSV rows with headers like `metric`, `value`, `as_of_date` become claims such as: `<metric> was <value> as of <date>.`
- CSV rows from survey-style data become aggregate claims only when the calculation is deterministic and traceable, for example count, average numeric score, yes/no counts.
- Markdown/DOCX/PDF/PPTX paragraph snippets become qualitative claims only when the text is already framed as a source observation. Prefix if needed: `Source notes report that ...`
- Interview/transcript snippets must not become authoritative factual claims unless phrased as reported views.
- Every generated claim must include at least one `sourceId`, one `evidenceId`, and a review status.
- Numeric claims must include a source date.
- Claims are capped to 100 per run.
- Generated claims should be stable across repeated runs on the same inputs.

Review statuses:

- `verified`: deterministic support exists, source date requirements are met when numbers are present, and selected source has no active blocking findings.
- `needs_review`: support exists but requires human interpretation.
- `unsupported`: no usable evidence supports the claim.

## Evidence Mapping

Create `src/evidence/map.ts`.

Build an `EvidenceMapRecord` from generated claims and selected evidence.

Rules:

- A generated final output can only use `verified` generated claims.
- `needs_review` and `unsupported` generated claims can appear in verification artifacts, but not in `04_export/final-output.md`.
- The evidence map must list excluded evidence with reasons.
- The verification report must include a finding if any generated claim is unsupported or if the generator had to drop all claims for a requested output.

## Trust and Verification Changes

Update `src/verify/hostile-review.ts` and `src/trust/evaluate.ts`.

Current review-only rules should remain for existing seeded claims/calculations.

Generation-mode changes:

- Folder-level source warnings remain visible but do not automatically block final export when the source is excluded from generated output.
- Used evidence is strict: any selected source inspection failure, missing numeric date, unresolved source conflict, unsupported claim, or unresolved calculation risk blocks.
- Unused excluded evidence is summarized as warning/exclusion, not final blocker.
- If no generated claims are verified, block export.
- If generated claims exist but some are dropped, warn and list dropped claims.
- If an accepted general risk appears in findings, preserve the existing audit-event requirement.

Do not weaken legal-profile checks.

## Markdown Output

Create `src/generate/markdown.ts`.

Render `final-output.md` only from verified generated claims.

Minimum structure:

```markdown
# <run name>

Generated local Markdown output. No external sending, filing, submission, or publication was performed.

## Summary

- <verified claim> [<source id>, <source date or n/a>]

## Evidence Table

| Claim | Sources | Evidence anchors | Source dates |
|---|---|---|---|

## Excluded Sources

| Source | Reason |
|---|---|

## Verification Boundary

- Source packet: `01_source-packet/source-inventory.json`
- Evidence map: `03_verification/evidence-map.json`
- Trust report: `03_verification/trust-report.json`
```

Output constraints:

- Every claim line must contain a source ID.
- Every numeric claim must contain a source date.
- No generated claim can cite excluded evidence.
- No generated final output is written when readiness is not `ready`.

## Artifact Layout

Add these files when `--generate` or MCP `generate: true` is used:

```text
deliverables/<run>/
  01_source-packet/
    source-evidence.json
    source-evidence.md
  03_verification/
    generated-claims.json
    generated-claims.md
    evidence-map.json
    evidence-map.md
  04_export/
    final-output.md                  # only when ready
    generated-output-receipt.json     # only when ready
    generated-output-receipt.md       # only when ready
    formatted-output.md               # deterministic derivative, only when ready
    formatting-receipt.json           # only when ready
    formatting-receipt.md             # only when ready
    general-export-refusal.md         # when not ready
```

The existing `ready-manifest.json` should include `finalOutput`, `evidenceMap`, `generatedOutputReceipt`, `formattedOutput`, and `formattingReceipt` when generated output is ready.

## CLI and MCP

CLI:

- Add `--generate`, default false.
- Existing no-flag behavior remains review-only and must keep current tests green.
- Usage string documents `--generate`.

MCP:

- Add `generate: z.boolean().default(false)` to `evidencemap_run_workflow`.
- Return generated-output paths and counts when generation runs.
- Keep review-decision tools unchanged.

## Documentation Updates

Update:

- `README.md`: add a Markdown-first generated output example and clarify that native Office output is not generated.
- `.system/docs/prd.md`: revise "First Version" to say the control layer exists and the next generation path emits local Markdown verified output.
- `.system/docs/runbook.md`: add "5. Generated Markdown Output" after Verification.
- `.system/docs/trust-layer.md`: document selected-vs-excluded source behavior and generation-mode gates.
- `.system/docs/mcp.md`: document `generate: true`.

## Tests

Add or update tests in the smallest relevant files.

Required tests:

1. Clean end-to-end generation:
   - Build a temp input folder with a current dated CSV and a short Markdown source.
   - Run workflow with generation enabled.
   - Assert readiness is `ready`.
   - Assert `04_export/final-output.md`, ready manifest, evidence map, generated claims, and receipt are written.
   - Assert every claim in final output includes a source ID.

2. Capstone messy-folder generation:
   - Run generation against `input/examples/capstone-report`.
   - Assert ready final Markdown is written.
   - Assert final output cites `2026-04-12-survey-raw-export.csv`, `enrollment-figures-final.csv`, and `interview-notes.md`.
   - Assert final output does not cite `enrollment-figures-old.csv` or `enrollment-analysis.xlsx`.
   - Assert excluded-source artifacts explain old figures and workbook exclusion.

3. Unresolved conflict refuses export:
   - Two current dated CSV files present the same metric with different values and no final/current tie-break.
   - Generation refuses final output.
   - `general-export-refusal.md` names the conflict.

4. Undated numeric evidence refuses export:
   - A number-bearing CSV has no source date in filename or content.
   - Generation refuses final output.
   - The refusal names the missing source date.

5. Review-only compatibility:
   - Existing `runEvidenceMapWorkflow` tests without generation keep current review-only behavior.

6. MCP generation:
   - `evidencemap_run_workflow` with `generate: true` returns generated-output metadata.
   - `generate: false` remains unchanged.

7. Store persistence:
   - Generated evidence, claims, map, and output records survive JSON store reload.

Validation commands:

```bash
npm --prefix .system run typecheck
npm --prefix .system test
npm --prefix .system run inspect -- --input input/examples/capstone-report
npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate
```

## Acceptance Criteria

The refactor is done when all are true:

- A clean folder can produce a verified local Markdown output without manual review.
- The capstone example can produce a verified Markdown output while visibly excluding stale or risky unused sources.
- A folder with unresolved current-source conflict refuses final export.
- A folder with undated numeric evidence refuses final export.
- Existing review-only behavior remains available and tested.
- MCP can start a generation-mode run and report generated-output artifacts.
- No final output is written unless the trust report is ready.
- All generated claims in final output have source IDs and evidence IDs.
- Every numeric final claim has a source date.
- All excluded sources are visible with reasons.
- `npm --prefix .system run typecheck` passes.
- `npm --prefix .system test` passes.

## Suggested Implementation Order

1. Add types and store APIs.
2. Add evidence snippet builder and tests.
3. Extend inspectors just enough to expose capped row/paragraph snippets.
4. Add source selection and exclusion reasons.
5. Add generated claim builder and evidence map.
6. Add generation-mode hostile-review/trust behavior.
7. Add Markdown renderer and generated output receipt.
8. Wire workflow, CLI, MCP, and artifacts.
9. Add docs.
10. Run full validation and fix drift in sample output docs.

## Stop Rules

Stop and report instead of papering over the issue if:

- Generation requires semantic interpretation that cannot be defended deterministically.
- A final output would need to cite an excluded source.
- A numeric claim has no source date.
- A source conflict cannot be resolved by source status/date/final-current tie-breaks.
- Existing legal tests regress.
- Existing review-only behavior disappears.

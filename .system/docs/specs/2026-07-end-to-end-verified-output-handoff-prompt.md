# Handoff Prompt: End-to-End Verified Output Refactor

Paste this into a fresh implementation agent.

```text
You are working in /Users/matthewweigand/Repo/evidence-map.

Task: implement the end-to-end verified output refactor in one session.

Read first:
- AGENTS.md
- .system/docs/specs/2026-07-end-to-end-verified-output-spec.md
- .system/docs/prd.md
- .system/docs/architecture.md
- .system/docs/trust-layer.md
- .system/docs/runbook.md
- .system/src/types.ts
- .system/src/db/store.ts
- .system/src/chains/evidence-map/workflow.ts
- .system/src/ingest/source-packet.ts
- .system/src/inspect/index.ts
- .system/src/spec/build.ts
- .system/src/verify/hostile-review.ts
- .system/src/trust/evaluate.ts
- .system/src/artifacts/write.ts
- .system/src/export/general.ts
- .system/src/mcp/server.ts
- .system/tests/workflow.test.ts
- .system/tests/mcp-server.test.ts
- .system/tests/source-packet.test.ts

Run shape:
- Workflow orchestrator refactor.
- Single-agent implementation.
- Markdown-first generated output.
- No external model calls, no Postgres, no native Office generation, no OCR, no external sending.

Goal:
An agent can hand the harness a messy local source folder and ask for generated output. The harness should select usable evidence, generate a structured Markdown output from verified claims, write final output only when ready, and otherwise refuse with exact blockers.

Required user-facing command:
`npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate`

Implementation requirements:
1. Add generation-mode types and store APIs:
   - output mode,
   - source evidence records,
   - generated claim records,
   - evidence map records,
   - generated output records.

2. Add evidence modules:
   - `.system/src/evidence/snippets.ts`
   - `.system/src/evidence/select.ts`
   - `.system/src/evidence/map.ts`

3. Add generation modules:
   - `.system/src/generate/markdown.ts`
   - `.system/src/generate/output.ts`

4. Extend inspectors only as needed:
   - CSV/TSV expose capped rows.
   - Markdown/TXT expose capped excerpts.
   - PDF exposes capped page/paragraph excerpts.
   - Reuse existing DOCX/PPTX summaries.
   - XLSX is usable for workbook summaries, not final numeric claim support when workbook-doctor risks are active.

5. Add source selection:
   - Prefer current/raw_data/transcript sources.
   - Infer final/current filenames as current unless old/archive/superseded also appears.
   - Infer interview/notes/transcript/call as transcript.
   - Exclude old/superseded files unless explicitly selected by a review decision.
   - Exclude failed or risky sources unless no alternative exists.
   - Make every exclusion visible with a reason.

6. Add generated claims:
   - Deterministic only.
   - CSV metric/value/as_of_date rows become source-backed claims.
   - Survey-style CSVs can produce simple aggregate claims.
   - Narrative snippets can produce reported-source qualitative claims.
   - Every final claim must have source IDs and evidence IDs.
   - Numeric final claims must have source dates.

7. Add generation-mode trust behavior:
   - Used evidence is strict.
   - Excluded unused evidence is visible but not an export blocker.
   - No verified generated claims means refusal.
   - No final output is written unless readiness is ready.
   - Do not weaken legal-profile checks.

8. Add Markdown final output:
   - `04_export/final-output.md` only when ready.
   - `04_export/generated-output-receipt.json`
   - `04_export/generated-output-receipt.md`
   - ready manifest references the final output and evidence map.

9. Add CLI and MCP support:
   - CLI `--generate` flag, default false.
   - MCP `generate: boolean`, default false.
   - Review-only mode stays backward compatible.

10. Update docs:
   - README
   - `.system/docs/prd.md`
   - `.system/docs/runbook.md`
   - `.system/docs/trust-layer.md`
   - `.system/docs/mcp.md`

Required tests:
- Clean end-to-end generation writes final Markdown and ready manifest.
- Capstone messy-folder generation writes final Markdown, cites the current usable sources, and excludes old/risky sources.
- Unresolved current-source conflict refuses export.
- Undated numeric evidence refuses export.
- Review-only workflow remains compatible.
- MCP generation returns generated-output metadata.
- JSON store reload preserves generated records.

Validation:
Run all of these before final response:
- `npm --prefix .system run typecheck`
- `npm --prefix .system test`
- `npm --prefix .system run inspect -- --input input/examples/capstone-report`
- `npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate`

Acceptance:
- All tests pass.
- The capstone command produces `04_export/final-output.md`.
- The final output does not cite `enrollment-figures-old.csv` or `enrollment-analysis.xlsx`.
- The final output includes source IDs and source dates for numeric claims.
- Excluded sources are listed with reasons.
- No final output is written for unresolved conflicts or undated numeric evidence.
- Existing legal tests pass.
- Existing review-only behavior still works without `--generate`.

Stop rule:
If the implementation would require hidden semantic guessing, external model calls, native Office rendering, or weakening verification gates, stop and report the smallest safe alternative instead.

Closeout requirements:
- Summarize files changed.
- Report validation command results.
- Report the exact generated capstone output path.
- List any non-goal deliberately left out.
```


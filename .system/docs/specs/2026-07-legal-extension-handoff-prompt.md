# Handoff Prompt: Legal Evidence Extension

Paste this into a fresh implementation agent.

```text
You are working in /Users/matthewweigand/Repo/evidence-map.

Task: implement Phase 1 of the legal evidence extension, not the whole roadmap.

Read first:
- AGENTS.md
- .system/docs/specs/2026-07-legal-extension-spec.md
- .system/docs/prd.md
- .system/docs/architecture.md
- .system/docs/trust-layer.md
- .system/src/types.ts
- .system/src/chains/evidence-map/workflow.ts
- .system/src/ingest/source-packet.ts
- .system/src/verify/hostile-review.ts
- .system/src/mcp/server.ts
- .system/tests/workflow.test.ts
- .system/tests/mcp-server.test.ts

Current repo warning:
- The worktree may already be dirty. Do not revert or rewrite unrelated changes.
- Add only the files and edits needed for Phase 1.
- Do not touch generated deliverables except for test-created temp output.

Phase 1 scope:
1. Add a workflow profile boundary:
   - `WorkflowProfile = "general" | "legal"`.
   - Default every existing run path to `general`.
   - Add CLI support for `--profile legal`.
   - Add MCP support for optional `profile: "general" | "legal"` on workflow/source-packet tools.
   - Existing general behavior and tests must remain unchanged.

2. Add legal-domain types under `.system/src/legal/types.ts`:
   - legal source record,
   - legal passage record shape, even if Phase 1 only has empty/manual passages,
   - legal proposition record shape,
   - legal output spec shape,
   - legal finding category union.

3. Add legal source classification:
   - create `.system/src/legal/source-classification.ts`;
   - classify supplied sources conservatively from filename, extension, and available text preview;
   - support source kinds: case, statute, regulation, rule, constitution, brief, motion, order, contract, exhibit, transcript, assignment, secondary, unknown;
   - support authority levels: binding, persuasive, secondary, record, assignment, unknown;
   - prefer `unknown` over a confident guess.

4. Add a legal source packet artifact:
   - for `--profile legal`, write `legal-source-packet.json` and `legal-source-packet.md` into `01_source-packet/` or the existing source-packet artifact directory;
   - include source ID/name, source kind, citation text if detected, jurisdiction if detected, authority level, date, extraction status, treatment status, and review status.

5. Add first deterministic legal trust checks:
   - metadata-only legal sources cannot support final-ready legal work;
   - a legal proposition without source support blocks;
   - a legal proposition without passage/pinpoint support blocks if it claims to be a rule, holding, quote, record fact, or citation;
   - secondary authority cannot support a binding-law claim without review;
   - unknown authority level requires review;
   - treatment status `not_checked` requires review, not ready.

6. Add fixture tests:
   - existing general tests pass unchanged;
   - legal profile run produces legal packet artifacts;
   - missing legal source support blocks;
   - metadata-only source support blocks or requires review as specified;
   - secondary-only binding claim is not ready;
   - CLI rejects invalid profile values if you add CLI validation.

Implementation constraints:
- Keep legal-specific interpretation under `.system/src/legal/`.
- Do not add Postgres.
- Do not add review-loop MCP tools.
- Do not add external web/legal research.
- Do not add automatic model calls.
- Do not implement final legal export.
- Do not implement all roadmap phases.
- Do not send or file anything externally.
- Treat this as a legal reliability layer, not legal advice.

Suggested implementation order:
1. Inspect current run input parsing and MCP schemas.
2. Add profile type and validation with default `general`.
3. Add legal types and classifier.
4. Add legal source-packet artifact generation behind `profile === "legal"`.
5. Add legal trust-review function and route its findings into the existing verification report.
6. Add tests.
7. Run:
   - `npm --prefix .system run typecheck`
   - `npm --prefix .system test`
   - README quickstart if tests pass

Stop rule:
- Stop after Phase 1 acceptance criteria pass.
- If the repo's existing dirty changes conflict with this task, report the conflict instead of reverting them.

Closeout requirements:
- Summarize files changed.
- Report validation commands and results.
- List any Phase 2 work deliberately left untouched.
```

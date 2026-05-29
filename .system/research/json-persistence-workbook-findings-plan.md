# JSON Persistence And Workbook Findings Plan

Date: 2026-05-28

## Goal

Make the MCP workflow durable across server restarts and turn Workbook Doctor signals into verification findings that affect the trust gate.

## Why This Comes Next

The repo now has MCP and first-pass `.xlsx` inspection. The weak points are:

- MCP state is memory-only.
- Workbook risks sit inside `file-inspections.json`, but they are not first-class verification findings.

That means the system can see risks, but cannot yet manage them as review work.

## Scope

Build now:

- `JsonFileTruthLayerStore` behind the existing `TruthLayerStore` contract.
- Default MCP store at `deliverables/truth-layer-store.json`.
- Persistence test proving a run can be read after server restart.
- Workbook Doctor finding promotion:
  - repeated static formulas become `must_fix`.
  - hardcoded numeric cells in calculation-like zones become `must_fix`.
  - hidden sheets become `should_fix`.
  - missing checks sheet becomes `should_fix`.
  - worksheet header warnings become `should_fix`.
- Tests proving workbook risks appear in hostile-review findings.

Do not build yet:

- Postgres.
- finding lifecycle decisions.
- artifact repair.
- final Office rendering.

## Store Design

Use one local JSON file for the first durable store:

```text
deliverables/truth-layer-store.json
```

The file stores arrays for every existing contract:

- runs
- sources
- conflicts
- inspections
- assumptions
- claims
- calculations
- specs
- findings
- reports

This is intentionally simple. It is enough for MCP continuity and tests. Postgres can replace it later without changing the harness.

## Verification Design

Keep Workbook Doctor inspection in `.system/src/inspect/xlsx.ts`.

Add a verification adapter:

```text
.system/src/verify/workbook-findings.ts
```

It reads `FileInspectionRecord.structuredSummary` from `xlsx-workbook-doctor-v1` and returns `VerificationFinding` drafts. `runHostileReview` appends those findings to the existing source, claim, calculation, and assumption checks.

## Acceptance Criteria

- `npm --prefix .system test` passes.
- `npm --prefix .system run typecheck` passes.
- MCP can run a workflow, close, reopen with the same JSON store, and retrieve status.
- A risky workbook produces workbook-specific verification findings.
- The workflow still tolerates invalid `.xlsx` files by recording an inspection failure instead of crashing.

## Next Milestone After This

Add finding lifecycle:

- `open`
- `fixed`
- `accepted_risk`
- `false_positive`

Then add MCP tools to apply review decisions and preserve human gate decisions.

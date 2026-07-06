# Architecture

Evidence Map is a single workflow harness with MCP, Codex, Claude, and CLI as adapters.

```text
Codex / Claude / MCP / CLI
        |
Adapter layer
        |
Evidence Map harness
        |
EvidenceMapStore
        |
JSON store plus run artifacts
```

## Boundary

The harness talks to `EvidenceMapStore`, not directly to a database client.

The project root is the operator workspace. `input/` and `deliverables/` stay at root. Implementation lives under `.system/`.

`src/format/` is downstream of the trust gate. It renders deterministic Markdown derivatives from verified generated-output records only; it does not select sources, create claims, change readiness, or replace the canonical `04_export/final-output.md` artifact.

The current MCP server uses a local JSON store at root `deliverables/evidence-map-store.json`. The CLI stays as a smoke-test and CI adapter. MCP is the primary interactive surface because review, repair, approval, and export are stepwise. General review decisions, general export-gate receipts, and approved final-artifact copy receipts are artifact-backed under each run.

Legal source history, review decisions, matter/course boundaries, and reuse libraries are artifact-backed under each run. Keep Postgres out unless recurring multi-run operations create a concrete store requirement.

## Ownership

The canonical module ownership list lives in `AGENTS.md`.

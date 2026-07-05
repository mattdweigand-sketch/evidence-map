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
JSON today, Postgres later
```

## Boundary

The harness talks to `EvidenceMapStore`, not directly to a database client.

The project root is the operator workspace. `input/` and `deliverables/` stay at root. Implementation lives under `.system/`.

The current MCP server uses a local JSON store at root `deliverables/evidence-map-store.json`. The CLI stays as a smoke-test and CI adapter. MCP is the primary interactive surface because review, repair, approval, and export will be stepwise.

Postgres can replace the JSON store when recurring workflows need source/version history across many runs.

## Ownership

The canonical module ownership list lives in `AGENTS.md`.

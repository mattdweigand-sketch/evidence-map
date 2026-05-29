# Architecture

Truth Layer OS is a single workflow harness with MCP, Codex, Claude, and CLI as adapters.

```text
Codex / Claude / MCP / CLI
        |
Adapter layer
        |
Truth Layer harness
        |
TruthLayerStore
        |
JSON today, Postgres later
```

## Boundary

The harness talks to `TruthLayerStore`, not directly to a database client.

The project root is the operator workspace. `input/` and `deliverables/` stay at root. Implementation lives under `.system/`.

The current MCP server uses a local JSON store at root `deliverables/truth-layer-store.json`. The CLI stays as a smoke-test and CI adapter. MCP is the primary interactive surface because review, repair, approval, and export will be stepwise.

Postgres can replace the JSON store when recurring workflows need source/version history across many runs.

## Ownership

- `.system/src/chains/truth-layer/` owns workflow steps.
- `.system/src/db/` owns persistence contracts and adapters.
- `.system/src/ingest/` owns source inventory.
- `.system/src/spec/` owns artifact structure.
- `.system/src/trust/` owns readiness evaluation.
- `.system/src/verify/` owns hostile review.
- `.system/src/artifacts/` owns local receipts.
- `.system/src/mcp/` owns MCP tool registration and adapter behavior.

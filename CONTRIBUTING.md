# Contributing

## Run the tests

```bash
npm --prefix .system install
npm --prefix .system run typecheck
npm --prefix .system test
```

CI runs both on every push and pull request. Keep them green.

## Module ownership

- `.system/src/chains/evidence-map/` owns intake, step ordering, and gate flow.
- `.system/src/ingest/` owns source inventory and source packet creation.
- `.system/src/spec/` owns artifact specifications for decks, workbooks, documents, and mixed outputs.
- `.system/src/trust/` owns readiness evaluation and blocking issue detection.
- `.system/src/verify/` owns hostile review findings.
- `.system/src/artifacts/` owns generated run folders and receipts.
- `.system/src/db/` owns persistence contracts and adapters.
- `.system/src/mcp/` owns MCP tool registration and adapter behavior.

Put new behavior in the module that owns it; do not cross those boundaries from the workflow.

## The store rule

The harness talks to `EvidenceMapStore` (`.system/src/db/store.ts`) and never to a database client directly. New persistence needs go into the store contract first, then into the adapters (`memory-store.ts`, `json-file-store.ts`).

## Before large PRs

Open an issue first and describe the change. Small fixes and doc improvements can go straight to a PR.

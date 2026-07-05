# Contributing

## Run the tests

```bash
npm --prefix .system install
npm --prefix .system run typecheck
npm --prefix .system test
```

CI runs both on every push and pull request. Keep them green.

## Module ownership

The canonical module ownership list lives in `AGENTS.md`.

Put new behavior in the module that owns it; do not cross those boundaries from the workflow.

## The store rule

The harness talks to `EvidenceMapStore` (`.system/src/db/store.ts`) and never to a database client directly. New persistence needs go into the store contract first, then into the adapters (`memory-store.ts`, `json-file-store.ts`).

## Before large PRs

Open an issue first and describe the change. Small fixes and doc improvements can go straight to a PR.

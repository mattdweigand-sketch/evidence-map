# evidence-map

## What This Is

Evidence Map is a general-purpose AI workflow harness for reviewing deliverables against the sources behind them.

It supports recurring reports and reviews (quarterly business reviews, program status reports), financial and operating models, external-facing presentations (client, board, grant, thesis defense), compliance and regulatory responses, research summaries and coursework deliverables, and any file where a claim or number can become a decision.

## How To Run It

```bash
npm --prefix .system install
npm --prefix .system test
npm --prefix .system run run -- --name "capstone-report" --kind document --input input/examples/capstone-report
```

Useful commands:

```bash
npm --prefix .system run inspect -- --input input/sample-project
npm --prefix .system run verify -- --run deliverables/sample-project
npm --prefix .system run mcp
```

## Project Shape

- `input/` contains source folders. Use one lowercase project-named subfolder per job. `input/examples/` ships with the repo.
- `deliverables/` contains generated local run artifacts.
- `.system/` contains implementation, docs, tests, scripts, package manifest, and MCP server.

## Conventions

- The evidence layer is created before any final file.
- Source prep and structure are required stages, not optional cleanup.
- Every claim should carry source IDs, source dates, assumptions, and review status.
- Every calculation should identify dependencies, formula risk, and verification status.
- Generated files, reports, evidence maps, and review packets stay under `deliverables/`.
- Prefer typed store APIs and structured records over ad hoc file parsing.

## Workflow Boundary

- `.system/src/chains/evidence-map/` owns intake, step ordering, and gate flow.
- `.system/src/ingest/` owns source inventory and source packet creation.
- `.system/src/spec/` owns artifact specifications for decks, workbooks, documents, and mixed outputs.
- `.system/src/trust/` owns readiness evaluation and blocking issue detection.
- `.system/src/verify/` owns hostile review findings.
- `.system/src/artifacts/` owns generated run folders and receipts.
- `.system/src/db/` owns persistence contracts and adapters.
- `.system/src/mcp/` owns MCP tool registration and adapter behavior.

## Do Not Do Without Asking

- Do not auto-send generated files externally.
- Do not bypass verification gates for final exports.
- Do not write to production databases.
- Do not move generated artifacts outside `deliverables/`.
- Do not import unrelated private source material unless explicitly requested.
- Do not run destructive git commands.

## Deeper Context

- `.system/docs/prd.md` is the product source of truth.
- `.system/docs/architecture.md` explains the adapter and store boundary.
- `.system/docs/trust-layer.md` defines the verification model.
- `.system/docs/runbook.md` turns the companion guide into the operating workflow.

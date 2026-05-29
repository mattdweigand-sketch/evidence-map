# Truth Layer OS

Truth Layer OS makes work deliverables inspectable before they get shipped.

It is not a deck, workbook, or report generator. The artifact can come from PowerPoint, Excel, ChatGPT, Claude, an RFP tool, or a human draft.

Truth Layer OS builds the control layer around that artifact: source inventory, conflict log, assumptions, artifact specification, evidence map, hostile verification, and export readiness.

## Core Workflow

1. Put source files in `input/<project-slug>/`.
2. Build the truth layer.
3. Review the source packet and artifact specification.
4. Add the draft artifact or artifact outline.
5. Map claims, numbers, assumptions, and calculations back to evidence.
6. Run verification before export.

```bash
npm --prefix .system install
npm --prefix .system test
mkdir -p input/board-qbr
printf "metric,value\nrevenue,100\n" > input/board-qbr/2026-05-01-raw-export.csv
npm --prefix .system run run -- --name "board-qbr" --kind deck --input input/board-qbr
```

For interactive agent workflows, run the MCP server:

```bash
npm --prefix .system run mcp
```

The MCP surface is documented in `.system/docs/mcp.md`. MCP and CLI run state persists at `deliverables/truth-layer-store.json`. The CLI remains useful for smoke tests, fixtures, and CI.

## Why It Exists

AI can make files that look finished before they are true. A chart can mix actuals and plan data. A workbook can contain hardcoded projections instead of live formulas. A deck can carry claims with no source trail.

Truth Layer OS exposes the claim layer before the artifact is approved. Every claim, number, assumption, and calculation becomes inspectable first.

That avoids the dangerous failure mode where something looks polished before anyone has checked whether the underlying content is true, current, approved, and safe to reuse.

## Output

The root is the operator workspace:

- `input/`: source folders. Use one lowercase project-named subfolder per job.
- `deliverables/`: source packets, verification reports, review artifacts, and export gates.
- `.system/`: implementation, docs, tests, scripts, package manifest, and MCP server.

Runs live under `deliverables/<run-slug>/`. Slugs include a short run ID suffix so repeated names do not overwrite prior artifacts:

- `01_source-packet/`: source inventory and conflict log.
- `01_source-packet/file-inspections.json`: parser status, metadata, warnings, and structured summaries for inspected files.
- `02_artifact-spec/`: deck, workbook, document, or mixed artifact specification.
- `03_verification/`: hostile-review findings and readiness report.
- `04_export/`: readiness gate for approved artifacts.

## Current State

This is the general-purpose foundation. It now records file-inspection outputs for source prep. CSV/TSV/text/Markdown are inspected directly. Source folders are expanded recursively. `.xlsx` files get a first Workbook Doctor pass for sheet inventory, hidden sheets, headers, formulas, hardcodes, missing checks sheets, and repeated static formulas. Workbook risks are promoted into verification findings. PowerPoint, Word, and PDF files are still metadata-only until their deep parsers land.

## License

MIT. See `LICENSE`.

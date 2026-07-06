# Evidence Map

[![CI](https://github.com/mattdweigand-sketch/evidence-map/actions/workflows/ci.yml/badge.svg)](https://github.com/mattdweigand-sketch/evidence-map/actions/workflows/ci.yml)

Evidence Map makes work deliverables inspectable before they get shipped.

You give it a folder of source files. It inventories the sources, pulls out usable evidence, flags risky claims and numbers, and writes a review packet under `deliverables/`.

If the selected evidence is clean enough, a general report run can write a local Markdown claim receipt with source and evidence pointers for each generated claim. If the selected evidence is not clean enough, the run refuses that generated Markdown receipt and lists the blockers.

Evidence Map is not a native deck, workbook, or Office-file generator. Draft artifacts can come from PowerPoint, Excel, ChatGPT, Claude, an RFP tool, or a human author. Evidence Map builds the control layer around that work before anyone trusts or ships it.

`ready` is scoped. In generation mode, it means the generated Markdown receipt and review packet passed their gates. It does not certify the original `.xlsx`, `.pptx`, `.docx`, PDF, or other input files for external shipping. Risky or excluded sources stay visible in the packet so a reviewer can decide whether those original artifacts need repair.

## Basic loop

1. Put source files in `input/<project-name>/`.
2. Run the workflow.
3. Open the new folder under `deliverables/<run-name>-<id>/`.
4. Start with `03_verification/trust-report.json` and `03_verification/review-queue.md`.
5. Use `04_export/` only for the artifact named by the ready manifest.

## What you get

| Folder | What it means | Start here |
|---|---|---|
| `01_source-packet/` | What files came in, how they were inspected, and what conflicts were inferred. | `source-packet.md` |
| `02_artifact-spec/` | The expected structure and checks for the requested artifact kind. | `artifact-spec.md` |
| `03_verification/` | Findings, readiness, review queue, evidence suggestions, generated claims, and evidence map. | `trust-report.json`, `review-queue.md` |
| `04_export/` | A ready manifest and Markdown claim receipt when ready, or a refusal with exact blockers. | `README.md`, `final-output.md`, `general-export-refusal.md` |

## Who this is for

Anyone whose AI-drafted or human-drafted files travel to a decision maker:

- An operator shipping a quarterly review whose numbers came from four exports and a forecast model.
- A student defending a capstone whose committee will ask where every figure came from.
- An analyst handing a model to a committee that will forward it without the analyst in the room.

If a claim or number in your file can become someone else's decision, this harness gives it a review trail first.

## 60-second quickstart

The repo ships a general worked example: a coursework-style capstone report folder with a clean survey export, a workbook with deliberate problems, qualitative interview notes, and two conflicting enrollment exports.

```bash
npm --prefix .system install
npm --prefix .system run run -- --name "capstone-report" --kind document --input input/examples/capstone-report
```

Open `deliverables/capstone-report-*/03_verification/` to see the review findings and trust report.

To generate a verified local Markdown claim receipt, add `--generate`:

```bash
npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate
```

When ready, the run writes `04_export/final-output.md`, `04_export/formatted-output.md`, `04_export/edited-output.md`, receipts, and a ready manifest. These Markdown files are built only from verified generated claims. They are evidence receipts, not polished prose reports: full source IDs, evidence IDs, source dates, and excluded-source reasons are preserved in JSON, while the Markdown summarizes dense evidence lists with counts and pointers. If a selected source conflict, unsupported generated claim, or undated numeric claim remains, no final Markdown file is written. `04_export/general-export-refusal.md` lists the blockers. Native `.docx`, `.pptx`, and `.xlsx` outputs are not generated.

To refresh a recurring deliverable from a prior run while preserving the prior review trail by receipt:

```bash
npm --prefix .system run refresh -- --from-run "<prior-run-id>" --name "capstone-report-refresh" --kind report --input input/examples/capstone-report --generate
```

## Legal profile quickstart

The legal profile is a local reliability layer for supplied legal packets. It inventories legal sources, extracts citeable passages from Markdown, text, DOCX, and text-based PDF sources, builds a legal evidence map, applies legal trust checks, and writes a gated local export receipt. It is not legal advice and it does not research, file, send, or submit anything externally.

```bash
npm --prefix .system run run -- --name "legal-duty" --kind document --profile legal --input input/examples/legal-duty
```

Open the latest `deliverables/legal-duty-*/` folder:

- `01_source-packet/legal-source-packet.json`: legal source classification and treatment state.
- `01_source-packet/legal-passages.json`: paragraph/page passage anchors with quote hashes.
- `01_source-packet/legal-source-history.json`: local source/version fingerprints.
- `02_artifact-spec/legal-output-spec.json`: inferred legal output spec and source-scope rules.
- `02_artifact-spec/legal-boundary.json`: matter/course boundary for reuse checks.
- `03_verification/legal-evidence-map.json`: marked legal propositions and source/pinpoint support.
- `03_verification/legal-reuse-library.json`: reviewed propositions that may be inspected for reuse.
- `04_export/README.md`: final legal export receipt or refusal.

Legal proposition intake is deterministic. Use `LEGAL-MAP` lines for mapped propositions and `LEGAL-DRAFT` lines for material draft propositions that must appear in the map. See `input/examples/legal-duty/legal-memo-draft.md` for the minimal marker shape.

## What a run finds

This is the actual abridged `verification-report.md` from the quickstart above:

> **Readiness: blocked** - Blocking issues: 5, Needs review: 10
>
> | Severity | Location | Issue |
> |---|---|---|
> | must_fix | workbook:enrollment-analysis.xlsx | Hardcoded numbers appear in calculation-like zones. |
> | must_fix | source:enrollment-analysis.xlsx | Number-bearing source has no source date. |
> | should_fix | workbook:enrollment-analysis.xlsx:Archive | Workbook contains a hidden sheet. |
> | should_fix | workbook:enrollment-analysis.xlsx | No checks sheet detected. |
> | must_fix | source-conflict | Potential version/status conflict across: enrollment-figures-final.csv, enrollment-figures-old.csv |
> | must_fix | section-map | Claim has no source attribution. |
> | should_fix | source:interview-notes.md | Source status is unclear. |

The clean file in the folder (`2026-04-12-survey-raw-export.csv`) produces no findings: it has a date, a recognizable role, and consistent structure. Everything else gets caught. The example workbook has its problems planted on purpose: two hardcoded numbers on a calculation sheet, a hidden sheet, no checks tab, and no date anywhere.

## MCP setup

For interactive agent workflows, run the harness as a local stdio MCP server:

```bash
npm --prefix .system run mcp
```

Claude Code (`.mcp.json` in your project, or `claude mcp add`):

```json
{
  "mcpServers": {
    "evidence-map": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/evidence-map/.system"
    }
  }
}
```

The same shape works in any MCP client that supports local stdio servers. MCP is the best interface when you want to repair a run step by step: attach source support, resolve calculation risks, accept reviewed findings, resolve source conflicts, or copy approved user-supplied final artifacts after a run is ready.

Core tools include `evidencemap_inspect_source_packet`, `evidencemap_run_workflow`, `evidencemap_refresh_workflow`, `evidencemap_status`, `evidencemap_next_action`, `evidencemap_get_verification_report`, and `evidencemap_get_evidence_link_suggestions`. `evidencemap_run_workflow` accepts `generate: true` for local Markdown generation. Run state persists at `deliverables/evidence-map-store.json`. The full surface is documented in `.system/docs/mcp.md`. The CLI remains useful for smoke tests, fixtures, and CI.

General-profile runs carry an artifact-backed review trail and a local export gate. Blocked or review-required runs write a refusal. Ready runs write a ready manifest for the gated artifact named in that manifest. In generation mode, ready runs also write final, formatted, and edited Markdown claim receipts. Native Office generation and broad prose-quality synthesis remain out of scope.

## What this is not

The premise is that AI can make files that look finished before they are true. A chart can mix actuals and plan data. A workbook can contain hardcoded projections instead of live formulas. A deck can carry claims with no source trail. Evidence Map exposes the claim layer before the artifact is approved. The review packet is the product: final Office rendering, prose-quality synthesis, and external sending happen elsewhere and should not be treated as approved merely because a generated Markdown receipt is ready.

## Repo layout

The root is the operator workspace:

- `input/`: source folders. Use one lowercase project-named subfolder per job. `input/examples/` ships with the repo.
- `deliverables/`: source packets, verification reports, review artifacts, and export gates (gitignored).
- `.system/`: implementation, docs, tests, scripts, package manifest, and MCP server.

Runs live under `deliverables/<run-slug>/`. Slugs include a short run ID suffix so repeated names do not overwrite prior artifacts:

- `00_refresh/`: refresh receipt and prior review-trail snapshots when a run is created from a prior run.
- `01_source-packet/`: source inventory, file inspections, conflict log, and source evidence snippets.
- `02_artifact-spec/`: deck, workbook, document, or mixed artifact specification.
- `03_verification/`: hostile-review findings, readiness report, evidence-link suggestions, calculation repair packet, generated claims, and evidence map.
- `04_export/`: readiness gate for approved artifacts, generated Markdown claim receipts, deterministic formatted and edited derivatives when ready, or refusal details when blocked.

CSV/TSV/text/Markdown and text-based PDF sources are inspected directly. General PDFs expose page paragraphs, section candidates, citation candidates, and table-like rows when text is extractable. `.xlsx` files get a Workbook Doctor pass: sheet inventory, hidden sheets, headers, formulas, hardcodes, missing checks sheets, and repeated static formulas. PowerPoint files get slide text, notes, and chart-reference inspection. DOCX files get paragraph, heading, and table inspection. The legal profile adds citeable DOCX passage extraction and converts shared PDF text extraction into legal passage anchors.

## Roadmap, contributing, license

- Legal profile: [`.system/docs/legal-profile.md`](.system/docs/legal-profile.md)
- Release checklist: [`.system/docs/release-checklist.md`](.system/docs/release-checklist.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- License: MIT. See [`LICENSE`](LICENSE).

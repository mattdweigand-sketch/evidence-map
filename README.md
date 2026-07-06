# Evidence Map

[![CI](https://github.com/mattdweigand-sketch/evidence-map/actions/workflows/ci.yml/badge.svg)](https://github.com/mattdweigand-sketch/evidence-map/actions/workflows/ci.yml)

Evidence Map makes work deliverables inspectable before they get shipped.

It is not a native deck, workbook, or Office-file generator. The artifact can come from PowerPoint, Excel, ChatGPT, Claude, an RFP tool, or a human draft. Evidence Map builds the control layer around that artifact: source inventory, conflict log, assumptions, artifact specification, evidence map, hostile verification, evidence-link suggestions, repair packets, and export readiness. For general report/document workflows, it can also generate local Markdown outputs from verified claims only.

## Who This Is For

Anyone whose AI-drafted or human-drafted files travel to a decision maker:

- An operator shipping a quarterly review whose numbers came from four exports and a forecast model.
- A student defending a capstone whose committee will ask where every figure came from.
- An analyst handing a model to a committee that will forward it without the analyst in the room.

If a claim or number in your file can become someone else's decision, this harness gives it a review trail first.

## 60-Second Quickstart

The repo ships a general worked example: a coursework-style capstone report folder with a clean survey export, a workbook with deliberate problems, qualitative interview notes, and two conflicting enrollment exports.

```bash
npm --prefix .system install
npm --prefix .system run run -- --name "capstone-report" --kind document --input input/examples/capstone-report
```

Open `deliverables/capstone-report-*/03_verification/` to see the findings.

To generate a verified local Markdown output, add `--generate`:

```bash
npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate
```

When ready, the run writes `04_export/final-output.md`, a deterministic derivative at `04_export/formatted-output.md`, a deterministic edited Markdown output at `04_export/edited-output.md`, receipts, and a ready manifest. These Markdown derivatives are built only from verified generated claims and must preserve claim IDs, source IDs, evidence IDs, source dates, and excluded-source reasons. If a selected source conflict, unsupported generated claim, or undated numeric claim remains, no final Markdown file is written; `04_export/general-export-refusal.md` lists the blockers. Native `.docx`, `.pptx`, and `.xlsx` outputs are not generated.

To refresh a recurring deliverable from a prior run while preserving the prior review trail by receipt:

```bash
npm --prefix .system run refresh -- --from-run "<prior-run-id>" --name "capstone-report-refresh" --kind report --input input/examples/capstone-report --generate
```

## Legal Profile Quickstart

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

## What A Run Finds

This is the actual (abridged) `verification-report.md` from the quickstart above — real output, not a mockup:

> **Readiness: blocked** — Blocking issues: 5, Needs review: 10
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

## MCP Setup

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

The same shape works in any MCP client that supports local stdio servers. Core tools exposed: `evidencemap_inspect_source_packet`, `evidencemap_run_workflow`, `evidencemap_refresh_workflow`, `evidencemap_status`, `evidencemap_next_action`, `evidencemap_get_verification_report`, and `evidencemap_get_evidence_link_suggestions`. `evidencemap_run_workflow` accepts `generate: true` for local Markdown generation. General-profile review tools can create, edit, delete, or merge claims, attach source support with anchors/quotes/rationale, resolve calculation risks, accept current findings with rationale, resolve source conflicts, and copy approved user-supplied final artifacts locally after the run is ready with an explicit approval token. Legal-profile review tools can attach passage support, update authority/treatment status, accept legal risks, and resolve source conflicts with an explicit approval token. Run state persists at `deliverables/evidence-map-store.json`. The full surface is documented in `.system/docs/mcp.md`. The CLI remains useful for smoke tests, fixtures, and CI.

General-profile v1 runs can now carry an artifact-backed review-decision trail and a local export gate: blocked or review-required runs write a refusal, while ready runs write a ready manifest. General runs seed deterministic unsupported claim candidates from inspected PPTX, Markdown/text, DOCX, and text-based PDF content; write evidence-link suggestions for reviewer action; and write calculation repair packets for mapped workbook/calculation risks. In generation mode, general runs build source evidence snippets, select usable sources, generate deterministic Markdown claims, write final Markdown only when trust gates are ready, and then write deterministic formatted and edited Markdown derivatives with invariant receipts. Once review-only runs are ready, MCP can still copy approved user-supplied final artifacts into `04_export/approved-artifacts/` and write `04_export/general-final-artifact-receipt.json` / `.md`. Native Office generation and broad prose-quality synthesis remain out of scope. Legal-profile runs have a narrower review-decision path and final Markdown gate, but final export still refuses unresolved blockers.

## What This Is Not

The premise is that AI can make files that look finished before they are true. A chart can mix actuals and plan data. A workbook can contain hardcoded projections instead of live formulas. A deck can carry claims with no source trail. Evidence Map exposes the claim layer before the artifact is approved, so nothing looks polished before anyone has checked whether the underlying content is true, current, approved, and safe to reuse.

## Repo Layout

The root is the operator workspace:

- `input/`: source folders. Use one lowercase project-named subfolder per job. `input/examples/` ships with the repo.
- `deliverables/`: source packets, verification reports, review artifacts, and export gates (gitignored).
- `.system/`: implementation, docs, tests, scripts, package manifest, and MCP server.

Runs live under `deliverables/<run-slug>/`. Slugs include a short run ID suffix so repeated names do not overwrite prior artifacts:

- `00_refresh/`: refresh receipt and prior review-trail snapshots when a run is created from a prior run.
- `01_source-packet/`: source inventory, file inspections, conflict log, and source evidence snippets.
- `02_artifact-spec/`: deck, workbook, document, or mixed artifact specification.
- `03_verification/`: hostile-review findings, readiness report, evidence-link suggestions, calculation repair packet, generated claims, and evidence map.
- `04_export/`: readiness gate for approved artifacts, generated Markdown output, deterministic formatted and edited derivatives when ready, or refusal details when blocked.

CSV/TSV/text/Markdown and text-based PDF sources are inspected directly. General PDFs expose page paragraphs, section candidates, citation candidates, and table-like rows when text is extractable. `.xlsx` files get a Workbook Doctor pass: sheet inventory, hidden sheets, headers, formulas, hardcodes, missing checks sheets, and repeated static formulas. PowerPoint files get slide text, notes, and chart-reference inspection. DOCX files get paragraph, heading, and table inspection. The legal profile adds citeable DOCX passage extraction and converts shared PDF text extraction into legal passage anchors.

## Roadmap, Contributing, License

- Legal profile: [`.system/docs/legal-profile.md`](.system/docs/legal-profile.md)
- Release checklist: [`.system/docs/release-checklist.md`](.system/docs/release-checklist.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- License: MIT. See [`LICENSE`](LICENSE).

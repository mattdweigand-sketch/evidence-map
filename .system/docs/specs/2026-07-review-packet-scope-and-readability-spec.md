# Review Packet Scope and Readability Spec

## Problem

The general-profile generation gate could be read as approving the whole input folder. That is too broad for real use. Generation mode excludes risky sources, including broken workbooks, and can still mark the generated Markdown output ready when selected evidence is clean. That is correct for the generated receipt, but it does not make the original workbook, deck, document, PDF, or any other input file safe to ship.

Generated Markdown also read like a raw extraction ledger rather than a report. That is acceptable for the current product because the review packet is the product, but public docs and artifact labels need to say that clearly.

Finally, Markdown packet views expanded every evidence ID for aggregate claims. A 30-row survey claim produced a row with 30 evidence IDs and 30 anchors. The JSON should keep the full trail, but Markdown should summarize dense evidence with counts and pointers.

## Goal

Ship a deterministic remediation that:

- Describes Evidence Map as a review/control packet, not a native artifact generator.
- Makes readiness scope explicit in docs and generated receipts.
- Treats generated Markdown as a claim receipt, not prose-quality report generation.
- Keeps full source IDs, evidence IDs, dates, and excluded-source reasons in JSON artifacts.
- Makes Markdown views scan-friendly by collapsing multi-evidence claim references to counts plus pointers.

## Non-goals

- Do not add native `.docx`, `.pptx`, or `.xlsx` generation.
- Do not add external model calls, OCR, Postgres, or external sending.
- Do not change evidence selection semantics.
- Do not remove excluded-source visibility from the packet.
- Do not certify user-supplied final artifacts semantically when they are copied into `04_export/approved-artifacts/`.

## Product Contract

The review packet is the primary artifact. It includes source inventory, file inspections, source conflicts, generated claims, evidence maps, verification findings, trust reports, review queues, export receipts, and refusal records.

In generation mode, `ready` means:

- the selected evidence for generated Markdown passed the generation-mode trust gate;
- every generated final claim has structured source IDs and evidence IDs;
- every generated numeric claim has a source date;
- no selected-source conflict or unsupported generated claim remains.

In generation mode, `ready` does not mean:

- original input files are safe to ship;
- an excluded workbook/deck/document/PDF was repaired;
- a native Office artifact was generated or validated for final external use;
- prose quality, executive polish, formatting, or external submission has been approved.

## Implementation

### Documentation

Update:

- `README.md`
- `.system/docs/prd.md`
- `.system/docs/trust-layer.md`
- `.system/docs/runbook.md`
- `ROADMAP.md`
- `.system/docs/mcp.md`

Required wording:

- `ready` is scoped to the artifact named in the ready manifest.
- Generated Markdown is a claim receipt.
- The review packet is the product.
- Native Office generation and prose-quality synthesis remain out of scope.

### Generated Markdown

Update `renderFinalMarkdown` in `.system/src/generate/markdown.ts`:

- Title/intro should call the artifact a local Markdown claim receipt.
- Add a `Readiness Scope` section.
- For one evidence ID, keep the ID inline.
- For multiple evidence IDs, render a count and pointer, for example:
  - `30 records in 01_source-packet/source-evidence.json (first: evidence_x; last: evidence_y)`
- Replace `Evidence anchors` / `Evidence IDs` table expansion with a compact evidence summary and detail pointer.

### Generated Claims Markdown

Update `renderGeneratedClaimsMarkdown`:

- Keep the full JSON unchanged in `generated-claims.json`.
- In Markdown, summarize multi-evidence claims with count plus `source-evidence.json` pointer.

### Formatted and Edited Markdown

Update deterministic derivatives:

- `formatted-output.md` and `edited-output.md` should use the same multi-evidence summary convention.
- Formatting invariants should require full IDs for single-evidence claims and count-plus-pointer for multi-evidence claims.
- JSON receipts may still preserve complete ID arrays.

### Export Receipts

Update general export and approved-artifact receipts:

- `ready-manifest.md` notes should say readiness is local and scoped.
- `04_export/README.md` should not call generated Markdown a final native artifact.
- Approved-artifact receipts should state that copying a file records local handoff only and does not certify semantic correctness.

## Acceptance Criteria

- A generated capstone run still reaches `readiness: "ready"` for selected Markdown output.
- The capstone generated Markdown still lists excluded `enrollment-analysis.xlsx` and why it was excluded.
- The capstone generated Markdown does not cite `enrollment-analysis.xlsx` or `enrollment-figures-old.csv` as support before the excluded-source section.
- Aggregate claim rows in generated Markdown do not dump all 30 evidence IDs inline.
- Markdown views point to `01_source-packet/source-evidence.json` for dense evidence details.
- JSON artifacts still contain full evidence IDs.
- Clean one-evidence generation still renders the single evidence ID inline.
- Existing refusal behavior for unresolved conflicts and undated numeric evidence remains unchanged.

## Validation

Run:

```bash
npm --prefix .system run typecheck
npm --prefix .system test
npm --prefix .system run inspect -- --input input/examples/capstone-report
npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate
git diff --check
```

The final run may write ignored artifacts under `deliverables/`; do not commit generated deliverables.

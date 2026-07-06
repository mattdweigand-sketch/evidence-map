# Operating Runbook

This runbook generalizes the companion guide into a repeatable workflow.

## 1. Source Prep

Collect the source folder. Remove sensitive or irrelevant material before upload.

Create:

- Source inventory.
- Source status labels.
- Fact, assumption, estimate, interpretation, and open-question separation.
- Conflict log.

Do not create slides, formulas, or final copy yet.

## 2. Structure

For a deck, define the narrative spine and slide map with claim headlines, source IDs, visuals, assumptions, open questions, notes, and review status.

For a workbook, define the tab architecture with raw data, assumptions, calculations, outputs, checks, and documentation.

For a document or report, define the section map with claims, sources, open issues, and review needs.

## 3. Artifact Intake

Add the draft artifact or artifact outline to the run.

The draft can come from PowerPoint, Excel, ChatGPT, Claude, an RFP tool, or a human author. Evidence Map does not need to generate it.

Map the artifact back to the evidence layer:

- Claims.
- Numbers.
- Charts.
- Tables.
- Formulas.
- Assumptions.

Preserve source IDs. Label assumptions. Keep formulas inspectable. Put evidence in speaker notes, a checks tab, or a companion evidence map.

## 4. Verification

Run the hostile review.

Check for:

- Unsupported claims.
- Numbers without dates or sources.
- Charts without traceable data.
- Formula inconsistency.
- Hardcoded outputs where formulas are expected.
- Assumptions presented as facts.
- Stale or mixed date ranges.
- Brand/template drift.
- Human judgment items.

The model can enumerate issues. A human owns the final gate.

Use the supporting review artifacts:

- `03_verification/evidence-link-suggestions.json` suggests source-to-claim links from deterministic term and number overlap. Suggestions do not verify claims until an audited review decision is recorded.
- `03_verification/calculation-repair-packet.json` turns calculation and workbook risks into repair checklists and suggested inputs for the approval-gated calculation-risk tool.
- `03_verification/review-queue.json` groups blockers by next action.

## 5. Generated Markdown Output

For general report/document workflows, generation mode can create a local Markdown claim receipt after source prep and structure:

- Build source evidence snippets from inspected rows, paragraphs, slides, notes, and workbook summaries.
- Select current, raw-data, and transcript evidence; exclude stale, failed, risky, and undated numeric evidence with visible reasons.
- Generate deterministic claims only from selected evidence.
- Write `04_export/final-output.md` only when the trust report is ready for the generated Markdown scope.
- Write `04_export/formatted-output.md` only as a deterministic derivative of the ready final Markdown output.
- Write `04_export/edited-output.md` only as a deterministic edited Markdown derivative of the ready final Markdown output.
- Otherwise write `04_export/general-export-refusal.md` with exact blockers.

Generation mode does not create `.docx`, `.pptx`, or `.xlsx` files and does not send, file, submit, publish, or call external models. `ready` does not certify original input files for external shipping; it only applies to the generated Markdown receipt and the review packet for the selected evidence.

## 6. Refresh

For recurring work, start a new run from a prior run instead of overwriting old artifacts:

```bash
npm --prefix .system run refresh -- --from-run "<prior-run-id>" --name "next-run" --kind report --input input/project --generate
```

Refresh writes `00_refresh/refresh-receipt.json` and `.md`, snapshots prior review-trail artifacts when present, and links the prior run to the new run. It does not silently apply old approvals to changed evidence.

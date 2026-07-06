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

## 5. Generated Markdown Output

For general report/document workflows, generation mode can create a local Markdown output after source prep and structure:

- Build source evidence snippets from inspected rows, paragraphs, slides, notes, and workbook summaries.
- Select current, raw-data, and transcript evidence; exclude stale, failed, risky, and undated numeric evidence with visible reasons.
- Generate deterministic claims only from selected evidence.
- Write `04_export/final-output.md` only when the trust report is ready.
- Otherwise write `04_export/general-export-refusal.md` with exact blockers.

Generation mode does not create `.docx`, `.pptx`, or `.xlsx` files and does not send, file, submit, publish, or call external models.

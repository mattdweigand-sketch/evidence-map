# Roadmap

Planned work, roughly in order. No dates. Open an issue if one of these matters to you.

- **PPTX deep parser and claim extraction.** Slide inventory, title and body text, charts, speaker notes, and claim candidates so decks stop being metadata-only.
- **Broader general review-loop MCP tools.** The first slice can attach source support to existing claims, resolve source conflicts, and accept current findings with audit records. Next slices should add claim creation/editing, calculation repair decisions, richer evidence attachment, and export preview/apply for the general profile.
- **LLM-assisted evidence matching.** Suggest source-to-claim links with confidence and review status instead of relying on manual mapping.
- **General-profile hardened export gate.** A real export step that copies approved non-legal artifacts only when blocking findings are closed, with receipts. The legal profile already has a local Markdown export/refusal gate.
- **General DOCX and PDF deep parsers.** Section maps, tables, citations, and page-cited text for non-legal document workflows. The legal profile already extracts paragraphs from DOCX and page/paragraph anchors from text-based PDFs.
- **Update/refresh primitive.** Rebuild a recurring deliverable from a prior run without losing structure, decisions, or the review trail.
- **Conflict inference for same-metric, different-date source pairs.** Today the conflict log catches same-stem files with differing status labels; two dated exports of the same metric (for example `2026-03-02-enrollment-figures.csv` vs `2026-04-30-enrollment-figures.csv`) are not yet grouped.

## Legal Profile Status

The legal profile is artifact-backed and local-only. It currently supports legal source classification, passage extraction for Markdown/text/DOCX/text-based PDF, legal output specs, legal evidence maps, draft discipline checks, review-decision audit artifacts, source history, reuse boundaries, reuse-library artifacts, and a final Markdown export gate.

Postgres is intentionally out of scope for the current legal profile. Source history and reuse are stored as run artifacts unless a future recurring-workflow need justifies a store adapter.

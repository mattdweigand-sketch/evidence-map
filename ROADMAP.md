# Roadmap

Planned work, roughly in order. No dates. Open an issue if one of these matters to you.

- **PPTX deep parser and claim extraction.** Slide inventory, title and body text, charts, speaker notes, and claim candidates so decks stop being metadata-only.
- **Review-loop MCP tools.** Add claim, attach evidence, resolve conflict, apply review decision, and export preview/apply, so an agent can work findings instead of only reading them.
- **LLM-assisted evidence matching.** Suggest source-to-claim links with confidence and review status instead of relying on manual mapping.
- **Hardened export gate.** A real export step that copies approved artifacts only when blocking findings are closed, with receipts.
- **DOCX and PDF deep parsers.** Section maps, tables, citations, and page-cited text for documents and source PDFs.
- **Postgres store adapter.** Swap the JSON store behind the same `EvidenceMapStore` contract when recurring runs need source and version history.
- **Update/refresh primitive.** Rebuild a recurring deliverable from a prior run without losing structure, decisions, or the review trail.
- **Conflict inference for same-metric, different-date source pairs.** Today the conflict log catches same-stem files with differing status labels; two dated exports of the same metric (for example `2026-03-02-enrollment-figures.csv` vs `2026-04-30-enrollment-figures.csv`) are not yet grouped.

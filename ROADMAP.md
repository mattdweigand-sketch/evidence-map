# Roadmap

Planned work, roughly in order. No dates. Open an issue if one of these matters to you.

- **Richer general claim extraction and matching.** PPTX inspection now captures slide text, notes, and chart references, and deck/mixed runs seed deterministic unsupported claim candidates from that extracted text. Later slices should broaden claim extraction to other artifact formats and suggest reviewed source-to-claim links.
- **Broader general review-loop MCP tools.** Current general review tools can create/edit/delete/merge claims, attach source support with anchors/quotes/rationale, resolve calculation risks, resolve source conflicts, accept current findings with audit records, and copy approved final artifacts locally after readiness. Next slices should add richer calculation repair artifacts.
- **LLM-assisted evidence matching.** Suggest source-to-claim links with confidence and review status instead of relying on manual mapping.
- **General-profile final artifact generation/editing.** The general profile now writes a local export refusal or ready manifest and can copy approved user-supplied final artifacts once gates are ready. A later step should prepare or apply generated edits only after the same gates pass.
- **General PDF deep parser and richer document structure.** DOCX inspection now captures paragraphs, headings, and tables; PDF still needs deeper section maps, tables, citations, and page-cited text for non-legal workflows. The legal profile already extracts paragraphs from DOCX and page/paragraph anchors from text-based PDFs.
- **Update/refresh primitive.** Rebuild a recurring deliverable from a prior run without losing structure, decisions, or the review trail.
- **Richer conflict inference.** The conflict log catches same-stem files with differing status labels and conservative same-metric dated data exports. Later work should infer conflicts across less-obvious metric aliases without creating noisy narrative-file blockers.

## Legal Profile Status

The legal profile is artifact-backed and local-only. It currently supports legal source classification, passage extraction for Markdown/text/DOCX/text-based PDF, legal output specs, legal evidence maps, draft discipline checks, review-decision audit artifacts, source history, reuse boundaries, reuse-library artifacts, and a final Markdown export gate.

Postgres is intentionally out of scope for the current legal profile. Source history and reuse are stored as run artifacts unless a future recurring-workflow need justifies a store adapter.

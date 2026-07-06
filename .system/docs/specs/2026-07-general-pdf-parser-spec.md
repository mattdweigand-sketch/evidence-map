# General PDF Parser Spec

Status: approved for implementation.
Origin: 2026-07-05 request to move PDF parser functionality from the legal profile into the general parser layer.

## Summary

Promote text-based PDF extraction to the general inspection layer so every workflow profile can see whether a PDF has extractable text, pages, paragraphs, date candidates, owners, and number-bearing content.

The legal profile should keep legal interpretation: passage IDs, pin cites, quote hashes, authority review, treatment review, and legal trust findings. The shared parser should only answer neutral file-inspection questions.

## Problem

General PDF handling currently stops at metadata:

- `src/inspect/index.ts` checks for the `%PDF-` signature and returns `pdf-metadata-v1`.
- `src/legal/passages.ts` separately uses `pdf-parse` to extract page text for legal passages.

That means the repo already has useful PDF text extraction, but general-profile runs still treat text-based PDFs as not deeply inspected. It also puts reusable file parsing inside a domain-specific module.

## Target Boundary

- `src/inspect/` owns generic PDF text extraction and file-inspection summaries.
- `src/legal/` consumes generic PDF extraction and converts pages/paragraphs into legal passage records.
- `src/trust/` and `src/verify/` continue to reason over `FileInspectionRecord` status and structured summaries.

## Implementation Plan

1. Add `src/inspect/pdf.ts`.
   - Use the existing `pdf-parse` dependency.
   - Extract pages, page text, page paragraphs, total paragraph count, extractable page count, number candidate count, and a normalized text body.
   - Close the parser in a `finally` block.

2. Update `src/inspect/index.ts`.
   - Replace metadata-only PDF handling with `pdf-text-v1`.
   - For text-based PDFs, return `status: "inspected"` and include `textPreview`.
   - For PDFs with no extractable text, return `status: "metadata_only"` with an explicit warning.
   - For malformed PDFs, return `status: "failed"` with the parse error.
   - Keep the `%PDF-` signature check.

3. Update `src/legal/passages.ts`.
   - Remove direct `pdf-parse` usage from the legal module.
   - Reuse the shared PDF extraction function.
   - Preserve legal passage IDs, page anchors, quote hashes, and failure behavior.

4. Update tests and docs.
   - Add focused general parser tests for text-based and malformed PDFs.
   - Keep legal PDF passage tests green.
   - Update README parser capability language.

## Non-Goals

- OCR for scanned PDFs.
- Table extraction.
- Full PDF layout reconstruction.
- General DOCX deep parsing.
- Any legal interpretation in `src/inspect/`.

## Acceptance Criteria

- A text-based PDF inspected through `inspectFile` returns `parser: "pdf-text-v1"` and `status: "inspected"`.
- The inspection summary includes page count, extractable page count, paragraph count, and number candidate count.
- A malformed PDF reports a failed PDF text inspection.
- Legal PDF passage extraction still produces page-based passage anchors.
- `npm --prefix .system run typecheck` passes.
- `npm --prefix .system test` passes.

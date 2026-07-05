# Legal Profile

The legal profile is a local reliability layer for supplied legal packets. It is not legal advice, does not do external research, and does not file, send, or submit anything.

Run it with the normal workflow plus `--profile legal`:

```bash
npm --prefix .system run run -- --name "legal-duty" --kind document --profile legal --input input/examples/legal-duty
```

## Source Support

Supported legal passage extraction:

- Markdown and text: paragraph anchors.
- DOCX: paragraph anchors from `word/document.xml`.
- Text-based PDF: page and paragraph anchors through the local PDF parser.

Unsupported or unreadable DOCX/PDF files produce failed passage records and blocking legal findings. Metadata-only legal sources cannot support final-ready legal work.

## Proposition Markers

Legal proposition intake is deterministic. The harness does not infer legal meaning from unmarked draft prose.

Use `LEGAL-MAP` for propositions that belong in the legal evidence map:

```text
LEGAL-MAP [rule] source=hawkins-v-mcgee.md passage=passage_hawkins-v-mcgee_p0004 pin="para. 4" authority=binding: A promise may create a warranty.
```

Use `LEGAL-DRAFT` for material draft propositions that must be represented in the map:

```text
LEGAL-DRAFT [rule]: A promise may create a warranty.
```

If a marked draft proposition is not represented in the evidence map, hostile review flags it as draft material outside the map.

## Legal Artifacts

Legal runs add these artifacts:

- `01_source-packet/legal-source-packet.json`
- `01_source-packet/legal-passages.json`
- `01_source-packet/legal-source-history.json`
- `02_artifact-spec/legal-output-spec.json`
- `02_artifact-spec/legal-boundary.json`
- `03_verification/legal-evidence-map.json`
- `03_verification/legal-draft-propositions.json`
- `03_verification/legal-review-decisions.json`
- `03_verification/legal-reuse-library.json`
- `04_export/README.md`

If the legal gate is ready, `04_export/final-legal.md` is written. If it is not ready, `04_export/legal-export-refusal.md` explains the unresolved blockers.

## Review Decisions

Legal review decisions are artifact-backed and approval-token gated. The current MCP tools can:

- attach existing legal passage support to an existing legal proposition,
- update source authority classification,
- update treatment/currentness status,
- accept a current legal risk,
- resolve a source conflict.

The approval token is `APPROVE_LEGAL_REVIEW_DECISION`. Decisions leave audit events in `legal-review-decisions.json`.

## Reuse Boundary

The legal reuse library is local and artifact-backed. It records reviewed propositions, source version fingerprints, passage quote hashes, and the matter/course boundary. Same-boundary reuse is allowed for reviewed propositions. Cross-boundary reuse is flagged unless a reviewer explicitly carries the risk.

# Trust Layer

The trust layer makes polished work inspectable, no matter where the draft artifact was created.

## Required Records

Source records:

- ID.
- Name.
- Path.
- Type.
- Date.
- Owner.
- Status.
- Intended use.
- Notes.

Claim records:

- Claim text.
- Artifact location.
- Source IDs.
- Assumptions.
- Transformation.
- Review status.

Calculation records:

- Location.
- Inputs.
- Formula or logic.
- Expected behavior.
- Risk flags.
- Verification status.

Assumption records:

- Name.
- Value.
- Unit.
- Source.
- Owner.
- Last updated.
- Status.
- Notes.

## Readiness Rules

Current implemented blocking rules:

- A required source is missing.
- A claim has no source.
- A number-bearing inspected source has no valid source date candidate.
- A calculation has unresolved formula risk.
- A source conflict remains open.
- A high-risk assumption lacks an owner or status.
- A source inspection fails.

Current implemented review rules:

- A claim is sourced but the source is stale or background-only.
- An assumption is an estimate.
- A reviewer must choose between conflicting sources.
- A source is unclear, unsupported, or metadata-only.

Chart traceability, slide-level source checks, and document-level claim extraction are enforced only after those records exist. PowerPoint, Word, and PDF are metadata-only in the current version. An artifact is ready only when blocking issues are zero and required review findings are cleared or explicitly accepted outside the harness.

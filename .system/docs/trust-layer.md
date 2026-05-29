# Trust Layer

The trust layer makes generated work inspectable.

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

An artifact is blocked when:

- A required source is missing.
- A claim has no source.
- A number has no source date.
- A chart lacks traceable data.
- A calculation has unresolved formula risk.
- A source conflict remains open.
- A high-risk assumption lacks an owner or status.

An artifact needs review when:

- A claim is sourced but the source is stale or background-only.
- An assumption is an estimate.
- A calculation depends on manual judgment.
- A reviewer must choose between conflicting sources.

An artifact is ready only when blocking issues are zero and required review is complete.

# Office File Truth Layer Build Plan

Date: 2026-05-28

## Assumptions

- The repo should remain general purpose. It should support board decks, QBRs, budgets, operating models, investor updates, client presentations, regulatory responses, and similar work.
- The first production target is a local TypeScript CLI harness. A web UI and production database can come later.
- The core formats are `.xlsx`, `.csv`, `.pptx`, `.docx`, `.pdf`, `.md`, and `.txt`.
- The harness should not replace human review. It should make review inspectable, enforce gates, and preserve the evidence trail.
- Final artifacts should stay under `deliverables/` and should not be sent externally by the repo.

## Success Definition

The finished system can take a messy source folder and produce:

- A source packet with real file inspection, source status, dates, owners where available, and conflict logs.
- An artifact specification for a deck, workbook, document, report, or mixed output.
- A claim map, assumption map, calculation map, and evidence map.
- A generated draft artifact when the source packet and spec are approved.
- A hostile verification report that checks claims, dates, formulas, charts, assumptions, layout, and traceability.
- A gated export folder that blocks release when material issues remain.

## Product Shape

The guide maps to eight primitives:

1. Inspect: map files, sheets, slides, formulas, sources, assumptions, and constraints.
2. Normalize: clean labels, dates, units, headers, table shapes, and metadata.
3. Reconcile: compare sources, preserve conflicts, and create an audit trail.
4. Model: define linked calculations, assumptions, scenarios, checks, and documentation.
5. Narrate: turn source material into a decision story for a named audience.
6. Render: create the workbook, deck, document, report, or mixed artifact from the approved spec.
7. Verify: check formulas, numbers, claims, charts, layout, readability, and source match.
8. Update: refresh a prior artifact without destroying structure, decisions, or review trail.

These primitives sit inside the four-stage workflow already in the repo:

- Source prep: Inspect, Normalize, Reconcile.
- Structure: Model, Narrate.
- Creation: Render.
- Verification: Verify, Update.

## Adapter Strategy

MCP is the primary interactive adapter. The workflow is review-heavy and stateful, so agents need tools they can call in sequence:

- inspect source packet
- build or refresh spec
- get status
- get next action
- create draft
- generate evidence map
- verify artifact
- apply review decision
- repair artifact
- preview export
- apply export

The CLI stays as the smoke-test and CI adapter. It should call the same harness as MCP, not fork the workflow.

## Current Repo Baseline

Already present:

- `.system/src/chains/truth-layer/workflow.ts`: stage orchestration.
- `.system/src/ingest/source-packet.ts`: source inventory from filenames.
- `.system/src/spec/build.ts`: generic artifact spec.
- `.system/src/verify/hostile-review.ts`: basic rule-based review.
- `.system/src/trust/evaluate.ts`: readiness gate.
- `.system/src/artifacts/write.ts`: deliverable folder writer.
- `.system/src/db/store.ts`: store boundary.
- `.system/src/db/memory-store.ts`: in-memory implementation.
- `.system/src/db/json-file-store.ts`: local JSON persistence for MCP state at `deliverables/truth-layer-store.json`.
- `.system/src/mcp/server.ts`: first MCP adapter for source prep, run, status, next action, and verification report.
- `.system/src/inspect/index.ts`: first file-inspection dispatcher and parsers for CSV, text, Markdown, and `.xlsx`, with metadata-only handling for PowerPoint, Word, and PDF files.
- `.system/src/inspect/xlsx.ts`: first Workbook Doctor pass for sheet inventory, hidden sheets, header warnings, formula cells, hardcoded numbers, missing checks sheets, and repeated static formulas.
- `.system/src/verify/workbook-findings.ts`: promotes Workbook Doctor risks into hostile-review findings.

Main gap:

The repo has the control plane, first MCP surface, JSON persistence, first inspection records, first `.xlsx` Workbook Doctor pass, and workbook-specific verification findings. It does not yet inspect PowerPoint, Word, or PDF contents, extract real claims, generate final artifacts, or run a deep verification loop.

## Target Module Map

Add these modules:

```text
.system/src/inspect/
  index.ts
  files.ts
  csv.ts
  xlsx.ts
  pptx.ts
  docx.ts
  pdf.ts
  markdown.ts

.system/src/normalize/
  dates.ts
  units.ts
  tables.ts
  metadata.ts

.system/src/reconcile/
  conflicts.ts
  metrics.ts
  sources.ts

.system/src/evidence/
  extract-claims.ts
  extract-assumptions.ts
  extract-calculations.ts
  build-evidence-map.ts

.system/src/spec/
  deck-spec.ts
  workbook-spec.ts
  document-spec.ts
  report-spec.ts
  mixed-spec.ts

.system/src/render/
  deck.ts
  workbook.ts
  document.ts
  report.ts
  receipts.ts

.system/src/verify/
  workbook-doctor.ts
  deck-review.ts
  document-review.ts
  source-review.ts
  review-loop.ts

.system/src/update/
  prior-run.ts
  refresh.ts
  diff.ts

.system/src/mcp/
  server.ts
  next-action.ts
```

Keep `.system/src/chains/truth-layer/workflow.ts` as the orchestrator. It should call these modules through stable contracts.

## Data Contract Additions

Extend `.system/src/types.ts` with these record families.

### Inspection Records

- `FileInspectionRecord`: file path, type, metadata, detected dates, extracted text summary, parser warnings.
- `WorkbookInspection`: sheets, tables, formulas, named ranges, hidden sheets, charts, protections, workbook issues.
- `WorksheetInspection`: purpose, dimensions, used range, table ranges, headers, blank rows, merged cells, formulas, hardcodes, data quality flags.
- `FormulaPattern`: sheet, range, formula text, normalized formula pattern, neighboring patterns, consistency status.
- `DeckInspection`: slides, layouts, masters, charts, speaker notes, embedded files, brand hints.
- `SlideInspection`: slide number, title text, claim candidates, number candidates, chart candidates, speaker notes, source IDs found.
- `DocumentInspection`: sections, headings, claim candidates, number candidates, citations, tables.
- `PdfInspection`: pages, text blocks, table candidates, date candidates, citation candidates.

### Truth Records

- `EvidenceMapRecord`: artifact location, claim ID, source IDs, source dates, transformation, assumption IDs, calculation IDs, confidence, review status.
- `MetricRecord`: metric name, value, unit, period, source ID, source date, context, confidence.
- `HumanQuestion`: location, question, why it matters, blocking status, owner, resolution.
- `ReviewDecision`: issue ID, decision, reviewer, date, rationale.

### Artifact Records

- `ArtifactDraft`: artifact kind, path, created from spec ID, evidence map ID, status.
- `ExportReceipt`: artifact path, readiness report ID, verification report ID, exported at, exported by.
- `PriorRunLink`: current run ID, prior run ID, refresh mode, carried-forward decisions.

### Finding Lifecycle

Change findings from one-time records into tracked issues:

- `status`: `open`, `fixed`, `accepted_risk`, `false_positive`.
- `introducedAtStage`: `source_prep`, `structure`, `creation`, `verification`, `update`.
- `resolvedBy`: optional repair ID or reviewer decision.
- `recheckResult`: optional status after reviewer loop.

## Store Changes

Add methods to `TruthLayerStore`:

- `createFileInspections`, `listFileInspections`.
- `createWorkbookInspections`, `listWorkbookInspections`.
- `createDeckInspections`, `listDeckInspections`.
- `createDocumentInspections`, `listDocumentInspections`.
- `createMetrics`, `listMetrics`.
- `createEvidenceMap`, `listEvidenceMap`.
- `createHumanQuestions`, `listHumanQuestions`.
- `updateVerificationFindingStatus`.
- `createArtifactDraft`, `listArtifactDrafts`.
- `createExportReceipt`, `getExportReceipt`.
- `linkPriorRun`, `getPriorRunLinks`.

Implement the same contract in `MemoryTruthLayerStore` first. Add JSON persistence after the contracts settle.

## Dependency Plan

The repo currently has no runtime dependencies. Add dependencies only when each parser or renderer lands.

Recommended first-pass libraries:

- Excel inspect and render: `exceljs`.
- Formula parsing: start with internal scanners, add `hyperformula` only if dependency graph needs become real.
- CSV parsing: `csv-parse`.
- PPTX inspect: `jszip` plus `fast-xml-parser`.
- PPTX render: `pptxgenjs`.
- DOCX inspect: `mammoth` plus `jszip` for metadata when needed.
- DOCX render: `docx`.
- PDF inspect: `pdf-parse` first, table extraction as a later adapter.
- ZIP/XML utilities: `jszip`, `fast-xml-parser`.

Keep every parser behind `.system/src/inspect/*` so libraries can be swapped without changing workflow code.

## Phase 1: Inspection Foundation

Goal: replace filename-only source prep with real file inspection.

Status: started. The first slices add durable file-inspection records, parser status, structured summaries for CSV/text/Markdown, first `.xlsx` Workbook Doctor summaries, metadata-only handling for PowerPoint/Word/PDF files, artifact output, MCP exposure, and tests.

Build:

- `.system/src/inspect/index.ts` dispatcher by file extension.
- Per-format inspectors for `.csv`, `.xlsx`, `.pptx`, `.docx`, `.pdf`, `.md`, `.txt`.
- Unified `FileInspectionRecord`.
- Parser warning system for unsupported, encrypted, corrupt, or partially parsed files.
- Tests with fixtures for every supported file type.

Acceptance criteria:

- `npm --prefix .system run inspect -- --input input/project` returns both source records and inspection records.
- Unsupported files are not fatal. They are marked inspectable only by metadata.
- The source packet includes parser warnings.

## Phase 2: Workbook Doctor

Goal: implement the Excel risk checks from the guide.

Status: started. The first pass detects workbook sheet inventory, hidden sheets, header warnings, formula cells, hardcoded numeric cells in calculation-like zones, missing checks sheets, and repeated static formulas like the copied `C2/B2-1` pattern. These risks now become hostile-review findings.

Build:

- Workbook map:
  - sheet inventory
  - apparent sheet purpose
  - hidden, empty, protected, stale, duplicate, suspicious sheet flags
  - table/range map
  - header quality
  - blank rows and columns
  - merged cells
  - dates stored as text
  - numbers stored as text
  - mixed units or currencies
  - duplicate rows
- Formula map:
  - formulas by sheet and range
  - normalized formula patterns
  - repeated reference detection
  - inconsistent formulas across parallel rows or columns
  - hardcodes inside calculation zones
  - formulas returning errors
  - suspicious static references
- Assumption map:
  - assumption candidates
  - source, owner, date, unit, and status if available
  - fact vs estimate vs placeholder vs unsupported judgment
- Checks tab spec:
  - tie-outs
  - formula consistency
  - hardcode scan
  - stale date scan
  - output sensitivity check

Acceptance criteria:

- A workbook with `=C5/B5-1` copied across future years is flagged when adjacent period references should roll forward.
- Hardcoded values in calculation zones are flagged.
- Hidden sheets and stale sheets appear in the workbook map.
- The verification report includes workbook-specific pass/fail status.

## Phase 3: Deck Architect And Evidence Layer

Goal: make PowerPoint decks traceable before they are rendered.

Build:

- PPTX inspection:
  - slide inventory
  - title and body extraction
  - chart detection
  - speaker note extraction
  - source ID detection
  - master/layout/template inventory
- Deck architecture spec:
  - audience
  - decision or action
  - what the audience knows
  - what the audience must believe
  - one-sentence narrative spine
  - risk if misunderstood
  - slide map with claim headlines
- Slide evidence map:
  - slide claim
  - source IDs
  - source dates
  - chart/table/visual required
  - assumptions
  - open questions
  - speaker note requirements
  - review status
- Speaker note template:
  - Claim
  - Source IDs
  - Calculation
  - Assumptions
  - Needs review

Acceptance criteria:

- Deck specs use claim headlines, not generic topics.
- Any slide claim without a source ID is blocked.
- Any chart without traceable source data is blocked.
- Speaker notes can carry the evidence layer.

## Phase 4: Document And PDF Inspection

Goal: support documents, regulatory responses, reports, and source PDFs.

Build:

- DOCX inspection:
  - heading map
  - section text
  - table extraction
  - citations and footnotes where available
  - claim and number candidates
- PDF inspection:
  - page-level text
  - detected tables
  - dates
  - metric candidates
  - source reliability warnings
- Markdown and text inspection:
  - headings
  - lists
  - tables
  - claim and number candidates

Acceptance criteria:

- Documents produce section maps.
- PDFs produce page-cited text and table candidates.
- Claims extracted from docs can be linked to source IDs and page/section references.

## Phase 5: Reconciliation And Source Packet V2

Goal: make the source packet a real controlled packet, not a file list.

Build:

- Metric extraction across inspected files.
- Date and period normalization.
- Unit and currency normalization.
- Conflict detection:
  - same metric, different value
  - same metric, different period
  - current and stale source both used
  - actuals mixed with plan or forecast
  - source owner mismatch
- Conflict severity rules:
  - blocking when a decision metric conflicts without resolution
  - warning when background material conflicts with current material
- Human question generation.

Acceptance criteria:

- Q3 actuals and Q4 plan numbers are not silently blended.
- Conflicting revenue figures from two sources appear in the conflict log.
- Every conflict has a status and required resolution path.

## Phase 6: Artifact-Specific Spec Builders

Goal: replace the generic spec with artifact-specific blueprints.

Build:

- `deck-spec.ts`:
  - narrative spine
  - slide map
  - evidence requirements
  - speaker note requirements
  - brand/template constraints
- `workbook-spec.ts`:
  - raw data tab
  - assumptions tab
  - calculation tabs
  - output views
  - checks tab
  - documentation tab
  - formula and hardcode rules
- `document-spec.ts`:
  - audience
  - section map
  - evidence requirements
  - citation style
  - open questions
- `report-spec.ts`:
  - report sections
  - metrics
  - evidence map
  - charts and tables
- `mixed-spec.ts`:
  - cross-artifact dependencies
  - workbook-to-deck evidence map
  - shared assumptions

Acceptance criteria:

- Artifact specs are concrete enough for rendering.
- Specs block creation when required source packet fields are unresolved.
- Specs write both JSON and Markdown.

## Phase 7: Creation Stage

Goal: generate draft artifacts from approved specs.

Build:

- Workbook renderer:
  - raw data tabs
  - assumptions tab
  - calculation tabs
  - output tabs
  - checks tab
  - documentation tab
  - source ID columns
- Deck renderer:
  - storyboard mode first
  - rendered `.pptx` second
  - claim headlines
  - charts or chart placeholders
  - speaker notes with evidence layer
- Document renderer:
  - `.docx` from section spec
  - evidence notes or appendix
  - claim references
- Report renderer:
  - Markdown and optional PDF output
  - evidence appendix

Acceptance criteria:

- Final artifact creation is blocked unless the source packet and spec are approved.
- Draft artifacts are written under `deliverables/<run>/04_export/drafts/`.
- Export-ready artifacts are written only after verification passes.

## Phase 8: Hostile Verification V2

Goal: verify the actual artifact, not only the pre-artifact records.

Build:

- Workbook review:
  - formula consistency
  - hardcode scan
  - source traceability
  - assumption status
  - checks tab pass/fail
  - stale data
  - output reliability
- Deck review:
  - claim source coverage
  - number source/date coverage
  - chart source traceability
  - assumptions presented as facts
  - speaker notes evidence quality
  - brand/template drift
- Document/report review:
  - unsupported claims
  - missing citations
  - stale numbers
  - conflicting source usage
  - unresolved human questions
- Layout/readability checks:
  - overflow text
  - missing titles
  - contrast issues where detectable
  - empty charts or tables

Acceptance criteria:

- Verification reads the generated artifact back from disk.
- Findings include precise locations.
- Blocking findings prevent export.
- Review report separates must-fix, should-fix, polish, and human judgment items.

## Phase 9: Builder And Reviewer Loop

Goal: implement the two-context review pattern from the notes.

Build:

- `review-loop.ts` with distinct roles:
  - builder proposes or repairs
  - reviewer only enumerates issues
  - resolver updates finding status
- Stable issue IDs so repeated reviews can tell whether an issue is fixed.
- Repair plan output:
  - must fix
  - should fix
  - optional polish
  - questions for human owner
- Recheck workflow:
  - run reviewer
  - apply repairs where safe
  - rerun reviewer
  - stop when no blocking findings remain or human decision is required

Acceptance criteria:

- The reviewer never rewrites the artifact directly.
- The loop records which findings were fixed, accepted, or left open.
- Export remains blocked until blocking findings are closed or explicitly accepted by a human reviewer.

## Phase 10: Persistence And Recurring Updates

Goal: make the harness useful for recurring board decks, QBRs, budgets, and investor updates.

Build:

- JSON store first:
  - one run database under `deliverables/<run>/truth-layer-store.json`
  - easy debugging
  - no external database required
- Optional SQLite or Postgres adapter later:
  - source version history
  - recurring run comparison
  - prior decisions
  - carried-forward assumptions
- Prior-run update:
  - compare new source packet to prior run
  - identify changed metrics
  - preserve approved structure where still valid
  - invalidate stale evidence
  - produce update diff

Acceptance criteria:

- A recurring run can link to a prior run.
- Stale carried-forward claims are flagged.
- Changed source metrics trigger review.

## Phase 11: CLI Surface

Goal: keep simple command-line smoke tests around the MCP-first harness.

Add scripts:

```bash
npm --prefix .system run inspect -- --input input/project
npm --prefix .system run prepare -- --name project --kind deck --input input/project
npm --prefix .system run spec -- --run deliverables/project
npm --prefix .system run create -- --run deliverables/project
npm --prefix .system run verify -- --run deliverables/project
npm --prefix .system run repair -- --run deliverables/project
npm --prefix .system run export -- --run deliverables/project
npm --prefix .system run update -- --run deliverables/project --prior deliverables/prior-project
```

Command behavior:

- `inspect`: parse source files and print inspection summary.
- `prepare`: create source packet, conflicts, metrics, assumptions, and questions.
- `spec`: build artifact-specific spec.
- `create`: render draft artifact from approved spec.
- `verify`: inspect generated artifact and write findings.
- `repair`: apply safe repairs or write a repair plan.
- `export`: copy verified artifact into final export only if gates pass.
- `update`: create a new run from a prior run and new sources.

## Phase 11A: MCP Surface

Goal: expose every review-stage operation as a tool an agent can call safely.

Add or expand tools:

```text
truthlayer_inspect_source_packet
truthlayer_prepare_source_packet
truthlayer_get_status
truthlayer_next_action
truthlayer_build_spec
truthlayer_create_draft
truthlayer_generate_evidence_map
truthlayer_verify_artifact
truthlayer_apply_review_decision
truthlayer_repair_artifact
truthlayer_preview_export
truthlayer_apply_export
truthlayer_update_from_prior_run
```

Rules:

- Preview tools can write local artifacts.
- Apply tools need explicit approval tokens.
- Export tools must enforce trust gates.
- MCP tools and CLI scripts must share the same core modules.

## Phase 12: Optional Review UI

Goal: make human review faster once the CLI works.

Build later:

- Local static HTML report in `deliverables/<run>/review/index.html`.
- Source inventory table.
- Conflict log with approve/resolution controls.
- Claim map and evidence map.
- Workbook formula risk table.
- Deck slide map.
- Finding lifecycle view.
- Export gate view.

This should be generated as a static review packet before any full app is considered.

## Gate Rules

Creation is blocked when:

- No source packet exists.
- Required source statuses are unclear.
- Blocking conflicts are open.
- Artifact spec is missing.
- Human questions marked blocking are unresolved.

Export is blocked when:

- Any material claim lacks a source ID.
- Any number lacks a source date or assumption label.
- Any chart lacks traceable source data.
- Any workbook calculation has unresolved formula risk.
- Any high-risk assumption lacks owner, status, or review decision.
- Any generated artifact fails read-back verification.

Ready means:

- Blocking findings are zero.
- Required review items are closed.
- The artifact can be traced from output back to sources, assumptions, and calculations.

## Testing Plan

Use fixture-driven tests.

Fixtures:

- Clean CSV.
- Messy CSV with blank rows and mixed units.
- Workbook with hidden sheet.
- Workbook with hardcoded projections.
- Workbook with repeated formula references.
- Workbook with inconsistent formula pattern.
- Deck with no speaker notes.
- Deck with notes that include source IDs.
- Deck with chart and missing source.
- DOCX with section claims and numbers.
- PDF with extracted table.
- Mixed folder with stale deck, current export, plan file, and transcript.

Test levels:

- Unit tests for parsers and normalizers.
- Contract tests for store APIs.
- Workflow tests for end-to-end runs.
- Golden-file tests for Markdown and JSON deliverables.
- Negative tests for blocked export.

Minimum acceptance suite:

- `npm --prefix .system test` passes.
- A workbook risk fixture is blocked.
- A sourced deck fixture reaches needs-review or ready based on notes.
- A mixed-source conflict fixture is blocked until conflict resolution is supplied.

## Implementation Sequence

Build in this order:

1. Extend types and store contracts.
2. Add file inspection dispatcher and simple parsers.
3. Add workbook inspection and Workbook Doctor.
4. Add deck inspection and Deck Architect.
5. Add claim, metric, assumption, and calculation extraction.
6. Add source reconciliation.
7. Replace generic spec builder with artifact-specific builders.
8. Add draft renderers for workbook and deck.
9. Add artifact read-back verification.
10. Add finding lifecycle and reviewer loop.
11. Add JSON persistence.
12. Add recurring update support.
13. Add static review packet.

## First Milestone

The first meaningful milestone should be:

```bash
npm --prefix .system run prepare -- --name board-qbr --kind mixed --input input/board-qbr
```

It should produce:

- `01_source-packet/source-inventory.json`
- `01_source-packet/file-inspections.json`
- `01_source-packet/source-conflicts.json`
- `01_source-packet/metrics.json`
- `01_source-packet/assumptions.json`
- `01_source-packet/human-questions.json`
- `02_artifact-spec/artifact-spec.json`
- `03_verification/preflight-findings.json`

No final Office file should be generated in this milestone.

## Second Milestone

The second milestone should be Workbook Doctor:

```bash
npm --prefix .system run inspect -- --input input/model-review
npm --prefix .system run verify -- --run deliverables/model-review
```

It should flag:

- hidden sheets
- hardcoded outputs
- repeated formulas
- inconsistent formulas
- missing assumptions metadata
- missing checks tab

This milestone proves the repo can catch the specific Excel failure in the notes.

## Third Milestone

The third milestone should be Deck Architect:

```bash
npm --prefix .system run prepare -- --name investor-update --kind deck --input input/investor-update
npm --prefix .system run spec -- --run deliverables/investor-update
```

It should produce:

- narrative spine
- slide map
- claim headlines
- source IDs per slide
- open questions
- speaker note requirements

No slide rendering is required yet.

## Fourth Milestone

The fourth milestone should be draft creation:

```bash
npm --prefix .system run create -- --run deliverables/investor-update
npm --prefix .system run verify -- --run deliverables/investor-update
```

It should produce a draft `.pptx` or `.xlsx`, then read the artifact back and verify traceability.

## Risk Register

- Office parsing is messy. Keep parsers isolated behind interfaces.
- Formula dependency analysis can become expensive. Start with risk heuristics, then add a real formula engine only where needed.
- PDF table extraction will be imperfect. Mark confidence and require human review for table-derived metrics.
- LLM extraction may hallucinate. Keep structured records tied to source locations and require confidence/review status.
- Rendering can create polished but wrong files. Always read generated artifacts back before export.
- A generic system can become too vague. Use artifact-specific specs while keeping the pipeline general.

## What Not To Build Yet

- External sending or sharing.
- Production database.
- Full web app.
- Multi-user permissions.
- Autonomous final approval.
- Vendor-specific automation for ChatGPT, Claude, or Copilot.

The right first product is a local harness that makes every important claim, number, formula, assumption, and chart inspectable before a file leaves the room.

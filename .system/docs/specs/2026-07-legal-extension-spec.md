# Legal Evidence Extension Spec

Status: proposed, ready for implementation planning.
Origin: request on 2026-07-05 to adapt Evidence Map for legal coursework and legal-work review packets.

## Summary

Build a legal evidence extension on top of the existing Evidence Map harness. The extension should let an operator give the repo a folder of legal case materials and a requested output, then receive a source-grounded legal deliverable with explicit authority, citations, assumptions, conflicts, and review status.

The target example is a law student who receives a packet of cases, statutes, excerpts, briefs, exhibits, or assignment materials and needs a verified output such as a case brief, legal memo, rule synthesis, issue outline, argument outline, or citation table.

This is a reliability layer, not legal advice. The harness may prepare reviewable work product. It must not claim that an answer is legally correct, file or send anything externally, or bypass a human legal reviewer, professor, attorney, or operator gate.

## Recommendation

Implement this as a legal profile inside `evidence-map`, not as a separate repo and not as a fork of `rfp-ddq-os`.

Reasons:

- `evidence-map` already owns the general source-packet, evidence-map, hostile-review, MCP, and deliverables workflow.
- Legal work is a domain-specific evidence problem, not a new artifact format. A legal memo is still a document/report, but its claims require legal authority metadata and pinpoint citations.
- `rfp-ddq-os` is useful as a reference for review queues, approval tokens, and Postgres-backed decisions, but its core model is questionnaire answers. Do not couple this repo to it.
- `evidence-map-os` is useful methodology language, but it is not the runnable harness.

## Product Job

For a source folder and a requested legal output, the harness should:

1. Inventory all supplied legal materials.
2. Deep-inspect text-bearing legal sources.
3. Classify each source by legal role and authority level.
4. Extract citeable passages with stable anchors.
5. Build a legal output specification before drafting.
6. Map each legal proposition, factual assertion, and quote to source IDs and pinpoint references.
7. Run hostile legal review before final export.
8. Block final readiness when authority, citation, quote, jurisdiction, or factual support is missing.

## Users

- Law student preparing coursework from a packet supplied by a professor.
- Legal operator preparing an internal research memo from approved source materials.
- Attorney or reviewer checking whether a draft memo is traceable to supplied materials.
- Compliance, policy, or business user using legal materials for a source-grounded internal summary.

## Non-Goals

- No legal advice guarantee.
- No automatic filing, submission, service, email, or external sending.
- No production legal database writes.
- No promise that all law is current unless currentness sources are provided and checked.
- No unbounded web legal research in the MVP.
- No hidden reliance on general model knowledge.
- No multi-agent architecture in the MVP.

## Harness Shape

Use a single workflow orchestrator with a legal profile.

The profile should sit beside the general workflow:

```text
CLI / MCP / Codex / Claude
        |
adapter layer
        |
Evidence Map workflow
        |
profile: general | legal
        |
EvidenceMapStore
        |
JSON today, Postgres later
```

The MVP can stay JSON-backed. Postgres matters later when legal users need recurring matters, source version history, reviewer workflow, and reusable research libraries.

## CLI and MCP Surface

Keep the current artifact kind semantics. Legal is a workflow profile, not a file format.

Recommended CLI shape:

```bash
npm --prefix .system run run -- --name "torts-duty-memo" --kind document --profile legal --input input/legal/torts-duty
```

Recommended MCP additions:

- `evidencemap_run_workflow` accepts optional `profile: "general" | "legal"`.
- `evidencemap_inspect_source_packet` accepts optional `profile: "general" | "legal"`.
- `evidencemap_get_verification_report` should return legal findings when the run profile is legal.

Do not add a new MCP server for legal. The profile should reuse the existing server and store contract.

## Module Boundary

Add legal-specific code under `.system/src/legal/`.

Recommended files:

- `src/legal/types.ts` owns legal-domain record types.
- `src/legal/source-classification.ts` owns legal source role and authority classification.
- `src/legal/passages.ts` owns extracted passage anchors and quote fingerprints.
- `src/legal/spec.ts` owns legal output specs.
- `src/legal/trust.ts` owns legal readiness rules.
- `src/legal/hostile-review.ts` owns legal hostile-review findings.
- `src/legal/fixtures.ts` may hold test fixture helpers if needed.

Keep generic parsing in existing ingest/inspect modules when it benefits all profiles. Legal-specific interpretation belongs in `src/legal/`.

## Data Model

### Run Profile

Add:

```ts
export type WorkflowProfile = "general" | "legal";
```

Store profile on runs or run metadata. Default to `general` so existing commands and tests do not change.

### Legal Source Record

Legal source records extend a generic source with legal authority metadata.

Fields:

- `id`
- `runId`
- `sourceId`
- `sourceKind`: `case | statute | regulation | rule | constitution | brief | motion | order | contract | exhibit | transcript | assignment | secondary | unknown`
- `title`
- `citationText`
- `normalizedCitation`
- `jurisdiction`
- `courtOrAuthority`
- `decisionDate`
- `effectiveDate`
- `authorityLevel`: `binding | persuasive | secondary | record | assignment | unknown`
- `sourceStatus`: `current | superseded | background | draft | unknown`
- `treatmentStatus`: `not_checked | checked_current | questioned | negative | superseded`
- `proceduralPosture`
- `parties`
- `notes`
- `reviewStatus`: `unreviewed | needs_review | verified | conflicting | unsupported`

MVP classification may be heuristic and conservative. Unknown is acceptable. Unsupported confidence is not.

### Legal Passage Record

Legal passage records are the citeable units that propositions point to.

Fields:

- `id`
- `runId`
- `sourceId`
- `passageId`
- `locationKind`: `page | paragraph | section | line | cell | unknown`
- `pageNumber`
- `paragraphNumber`
- `sectionLabel`
- `lineRange`
- `pinpoint`
- `quote`
- `quoteHash`
- `textBefore`
- `textAfter`
- `extractionStatus`: `extracted | metadata_only | failed | manual`
- `notes`

`quoteHash` should be deterministic from normalized quote text so quote drift can be detected.

### Legal Proposition Record

A legal proposition is any claim that should not appear in final legal work without support.

Fields:

- `id`
- `runId`
- `artifactLocation`
- `propositionType`: `rule | holding | reasoning | standard_of_review | procedural_fact | record_fact | application | counterargument | conclusion | quote | citation`
- `text`
- `sourceIds`
- `passageIds`
- `pinCites`
- `assumptions`
- `jurisdiction`
- `authorityLevelRequired`: `binding | persuasive_ok | secondary_ok | record`
- `reviewStatus`: `unreviewed | needs_review | verified | unsupported | conflicting`
- `notes`

Rules and holdings should usually require legal authority. Record facts should require record/exhibit/transcript support. Conclusions should point back to the rule and fact propositions they combine.

### Legal Output Spec

Fields:

- `id`
- `runId`
- `outputKind`: `case_brief | legal_memo | rule_synthesis | issue_outline | argument_outline | citation_table | case_comparison | other`
- `audience`
- `assignmentOrUseCase`
- `jurisdiction`
- `courseOrMatter`
- `questionPresented`
- `requiredSections`
- `citationStyle`: `bluebook | alwd | professor_specific | plain | unknown`
- `allowedSourceScope`: `provided_packet_only | provided_plus_user_approved_research`
- `reviewOwner`
- `reviewRules`

For the law-student case, default to `provided_packet_only` unless the user explicitly asks for research outside the packet.

### Legal Finding

Legal hostile review should use existing `VerificationFinding` where possible, with legal categories in `issue` or a new optional `category`.

Recommended categories:

- `missing_authority`
- `missing_pinpoint`
- `quote_drift`
- `unsupported_record_fact`
- `jurisdiction_mismatch`
- `authority_level_mismatch`
- `secondary_only_rule`
- `unresolved_conflict`
- `negative_treatment_not_checked`
- `case_posture_unclear`
- `assignment_scope_violation`
- `model_knowledge_leak`
- `citation_format_issue`
- `conclusion_outpaces_support`

## Source Classification

MVP source classification should be conservative and mostly deterministic.

Filename and content hints:

- Case: reporter citation, `v.`, court/date patterns, opinion headings.
- Statute: code section symbols, `section`, `USC`, `CFR`, state code references.
- Brief/motion/order: litigation filing captions and document titles.
- Exhibit/record: exhibit labels, deposition/transcript markers, page-line citations.
- Assignment: syllabus, prompt, rubric, professor instructions.
- Secondary: treatise, restatement, article, textbook, practice guide.

Authority classification:

- `binding` only when jurisdiction, court, and assignment/matter jurisdiction make that safe.
- `persuasive` when court/source is legal authority but not clearly binding.
- `secondary` for commentary and treatises.
- `record` for exhibits, transcripts, contracts, declarations, and raw facts.
- `unknown` when unsure. Unknown authority should require review before final readiness.

## Workflow

### Stage 0: Legal Intake

Collect or infer:

- output kind
- audience
- assignment/use case
- jurisdiction
- source folder
- allowed source scope
- citation style
- review owner
- final format

Block if:

- source folder is missing,
- output kind is unknown and cannot be inferred,
- allowed source scope is unclear for legal research,
- user asks for legal advice or external submission without human review.

### Stage 1: Legal Source Packet

Create generic source records plus legal source records.

Output artifacts:

- `01_source-packet/source-inventory.json`
- `01_source-packet/legal-source-packet.json`
- `01_source-packet/legal-source-packet.md`

The packet should show:

- source ID
- legal source kind
- citation
- jurisdiction
- authority level
- date
- treatment status
- extraction status
- role in the requested output
- open classification questions

### Stage 2: Passage Extraction

For text-bearing sources, extract passages with page/paragraph anchors.

MVP supported inputs:

- `.md`
- `.txt`
- text-based `.pdf`
- `.docx`

Metadata-only legal sources should not be treated as final-supporting evidence. They can be inventoried, but any proposition relying on them should block or require review.

### Stage 3: Legal Output Spec

Build the legal output spec before drafting.

For a legal memo, the spec should include:

- question presented
- brief answer placeholder
- facts section sources
- rule section authorities
- analysis section proposition plan
- counterauthority section
- conclusion section
- citation style
- review rules

For a case brief, include:

- facts
- procedural history
- issue
- rule
- holding
- reasoning
- disposition
- notes or class questions

### Stage 4: Legal Evidence Map

Map each proposition to source IDs and passage IDs.

Minimum map coverage:

- every rule statement
- every holding statement
- every quoted passage
- every procedural posture statement
- every fact used in analysis
- every material conclusion
- every counterauthority or conflict

### Stage 5: Draft Output

Draft only from the legal output spec and evidence map.

The draft should preserve citations and never introduce new legal propositions without map entries. Any new proposition discovered during drafting should be added to the map or marked unsupported.

### Stage 6: Hostile Legal Review

Run deterministic legal checks first, then optionally render an LLM hostile-review prompt for a human/model reviewer. The harness should not silently call an external model in the MVP.

Checks:

- Every legal proposition has source and passage support.
- Every direct quote matches an extracted passage hash.
- Every rule or holding has a citation and pinpoint.
- Every fact in analysis has record or case support.
- Authority level matches the output jurisdiction or is marked persuasive/secondary.
- Conflicts are carried into the output or resolved.
- Secondary authority is not presented as binding law.
- Treatment status is checked or marked as needing review.
- The draft does not rely on sources outside allowed scope.

### Stage 7: Final Gate

Final readiness is allowed only when:

- no blocking legal findings remain,
- all required human-review findings are resolved or explicitly accepted,
- unsupported propositions have been removed or marked,
- final README lists unresolved legal risks,
- no external submission or legal action is attempted.

## Readiness Rules

### Blocking Issues

Block final readiness when:

- A source required by a proposition is missing.
- A legal proposition has no source.
- A legal proposition has source IDs but no passage or pinpoint support.
- A quoted passage does not match the extracted source text.
- A record fact lacks record/case/exhibit/transcript support.
- A source is metadata-only and is used as final support.
- A rule statement relies only on model knowledge.
- A source conflict remains open.
- The output jurisdiction is known but the authority jurisdiction conflicts and is not labeled.
- A binding-law claim is supported only by secondary or persuasive authority.
- The assignment says to use only the provided packet and the draft relies on outside material.

### Needs Review

Require review when:

- legal authority level is unknown,
- treatment status is `not_checked`,
- citation style is unknown,
- a rule is synthesized from multiple authorities,
- a source is stale, superseded, or background,
- a proposition is an inference,
- a conclusion combines several facts and rules,
- a conflict is accepted unresolved,
- source extraction is manual.

### Ready

Legal readiness means the packet is inspectable and review-cleared. It does not mean the legal conclusion is correct.

## Permissions and Safety

Always allowed:

- local source inventory,
- local text extraction,
- local evidence-map generation,
- local review artifacts under `deliverables/`,
- deterministic validation.

Ask first:

- importing sources outside the repo workspace,
- web or database legal research,
- adding dependencies,
- creating final binary exports,
- applying review decisions.

Never allowed by default:

- external filing,
- external sending,
- court submission,
- client communication,
- production legal database writes,
- representing the output as legal advice.

## Context and Retrieval

The legal profile must treat context assembly as a trust problem.

Rules:

- Never inject all source text blindly when the packet is large.
- Retrieve passages by source role, proposition, and section.
- Every retrieved passage must carry source ID, source kind, authority level, date, and pinpoint.
- Assignment/rubric instructions are workflow authority, not legal authority.
- Secondary sources can explain law but cannot silently become binding authority.
- Model memory is not a source.

## Roadmap

### Phase 1: Legal Profile and Static Trust Contract

Goal: Add the legal profile without deep parser ambition.

Work:

- Add `WorkflowProfile = "general" | "legal"` and preserve default `general`.
- Add legal record types under `src/legal/types.ts`.
- Add legal output spec builder for common legal output kinds.
- Add deterministic legal source classification from filenames and existing text previews.
- Add legal hostile-review checks for missing authority, missing pinpoint, metadata-only support, secondary-only binding claims, and unsupported record facts.
- Add legal fixture tests using `.md` and `.txt` sources.
- Add CLI/MCP support for optional `profile: legal`.

Acceptance:

- Existing general workflow tests pass unchanged.
- Legal run creates legal source packet and legal verification findings.
- Legal proposition without passage support blocks.
- Metadata-only legal source cannot support final legal readiness.
- Secondary authority cannot support a binding-law claim without review.

### Phase 2: Text Extraction and Passage Anchors

Goal: Make legal sources citeable.

Work:

- Add shared text extraction for `.txt`, `.md`, `.docx`, and text-based `.pdf`.
- Record paragraph/page anchors where available.
- Add quote hashes and quote-drift validation.
- Expose passage records in run artifacts.
- Add tests for stable passage IDs and quote mismatch findings.

Acceptance:

- A direct quote in the draft maps to a passage hash.
- Altered quote text is flagged.
- A proposition with source ID but no passage/pinpoint blocks.
- DOCX/PDF text extraction failures become review/blocking findings, not silent success.

### Phase 3: Legal Evidence Map and Draft Discipline

Goal: Make legal propositions first-class records.

Work:

- Add legal proposition records to store contract or legal run artifacts.
- Build legal evidence-map artifacts with proposition type, source IDs, passage IDs, authority level, and review status.
- Add draft discipline check that every material draft proposition appears in the map.
- Add legal output specs for case brief, legal memo, rule synthesis, issue outline, and citation table.

Acceptance:

- Every rule, holding, fact, quote, and conclusion in a fixture memo is represented in the evidence map.
- Missing counterauthority or conflict is visible as a finding.
- Draft material outside the map is flagged.

### Phase 4: Review Loop and Resolution Tools

Goal: Let an operator resolve legal findings without editing JSON manually.

Work:

- Add MCP tools to attach passage support, change authority classification, resolve conflicts, accept risk, and mark review decisions.
- Require approval tokens for review-state changes.
- Regenerate legal source packet, evidence map, and verification report after decisions.

Acceptance:

- A blocked legal run can move to waiting-for-review or export-ready through structured decisions.
- All decisions leave audit events.
- Re-running verification does not duplicate old findings.

### Phase 5: Final Export Gate

Goal: Produce final legal deliverables only after gates are satisfied.

Work:

- Add final Markdown/DOCX export for legal memos and case briefs.
- Add final README with source packet, legal evidence map, hostile review, accepted risks, and validation status.
- Refuse export when legal trust gates fail.

Acceptance:

- Final output includes citations and no unsupported material propositions.
- Export refusal explains the exact unresolved legal blockers.
- No external send/file action exists.

### Phase 6: Durable Store and Reusable Research Library

Goal: Support recurring legal workflows.

Work:

- Add Postgres adapter support for legal records if recurring use justifies it.
- Add source/version history.
- Add reusable authority/proposition library with freshness/treatment review.
- Add matter/course boundaries so legal memories do not bleed across contexts.

Acceptance:

- A prior legal run can be refreshed without losing decisions.
- Reused propositions carry original source, date, treatment status, reviewer, and scope.
- Cross-matter reuse is blocked unless explicitly approved.

## Evaluation Plan

Create a small frozen fixture set before broad implementation:

1. Case brief fixture: one case excerpt and assignment prompt.
2. Legal memo fixture: two cases with a tension/conflict.
3. Record fact fixture: a transcript/exhibit plus a draft fact statement.
4. Quote drift fixture: draft quote differs from source quote.
5. Jurisdiction fixture: one binding source and one persuasive source.
6. Scope fixture: assignment says provided packet only, draft uses outside source.

Required invariant tests:

- General profile behavior does not regress.
- Legal profile never treats metadata-only legal sources as verified support.
- Model-memory-only legal propositions block.
- Quote drift blocks.
- Missing pinpoints block.
- Unknown treatment status requires review.
- Secondary-only binding-law claim requires review or blocks.
- Final export refuses unresolved legal blockers.

## First Implementation Slice

The first implementation should stop at Phase 1.

Do not implement all phases in one pass. Phase 1 should establish the profile boundary, legal types, legal source packet, first deterministic trust checks, and tests. That makes later parsing and review-loop work easier without forcing a broad rewrite.

## Open Questions

- Should legal profile state live directly on `EvidenceMapRun`, or should the JSON store keep a profile metadata sidecar for compatibility?
- Should legal records be persisted through the store API in Phase 1, or emitted as run artifacts first and promoted to store records in Phase 3?
- Which citation style should be default for coursework: Bluebook, plain, or assignment-specific?
- Should first PDF support use existing local dependencies only, or add a dedicated PDF parser in Phase 2?
- Should treatment checking remain manual until an approved legal research connector exists?

## Final Verification for Phase 1

After Phase 1 implementation:

1. `npm --prefix .system run typecheck` passes.
2. `npm --prefix .system test` passes.
3. Existing README quickstart still works for `input/examples/capstone-report`.
4. A legal fixture run with `--profile legal --kind document` writes legal source packet and legal verification artifacts.
5. Legal fixtures prove missing authority, missing pinpoint, metadata-only support, and secondary-only binding claims are caught.
6. No generated files move outside `deliverables/`.

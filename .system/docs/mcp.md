# MCP Server

Evidence Map can run as a local stdio MCP server. This lets Claude Code, Codex, or another MCP client call the harness directly instead of treating the workflow as a one-shot CLI command.

## Run

```bash
npm --prefix .system run mcp
```

## Client Config

Use this shape in an MCP client config that supports local stdio servers:

```json
{
  "mcpServers": {
    "evidence-map": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/evidence-map/.system"
    }
  }
}
```

## Tools

- `evidencemap_inspect_source_packet`
- `evidencemap_run_workflow`
- `evidencemap_refresh_workflow`
- `evidencemap_status`
- `evidencemap_next_action`
- `evidencemap_get_verification_report`
- `evidencemap_get_evidence_link_suggestions`
- `evidencemap_create_general_claim`
- `evidencemap_edit_general_claim`
- `evidencemap_delete_general_claim`
- `evidencemap_merge_general_claims`
- `evidencemap_attach_claim_source_support`
- `evidencemap_resolve_calculation_risk`
- `evidencemap_resolve_source_conflict`
- `evidencemap_accept_general_risk`
- `evidencemap_apply_general_final_artifacts`
- `evidencemap_attach_legal_passage_support`
- `evidencemap_update_legal_source_authority`
- `evidencemap_update_legal_source_treatment`
- `evidencemap_accept_legal_risk`
- `evidencemap_resolve_legal_source_conflict`

`evidencemap_inspect_source_packet` and `evidencemap_run_workflow` accept `profile: "general" | "legal"`. `evidencemap_run_workflow` also accepts `generate: true` for general-profile Markdown generation. In generation mode the response includes generated-output status, format, relative final-output path when ready, relative formatted-output path when ready, generated claim count, selected evidence count, and excluded source count. `evidencemap_refresh_workflow` requires a prior run ID, runs a fresh workflow over supplied inputs, and writes `00_refresh/refresh-receipt.json` plus snapshots of prior review-trail artifacts when present.

The general review tools require `approvalToken: "APPROVE_GENERAL_REVIEW_DECISION"` and write `general-review-decisions.json` / `.md` under `03_verification/`. They can create/edit/delete/merge general claims, attach source support with optional anchors/quotes/rationale, resolve calculation risks, resolve source conflicts, and accept current findings with rationale. `evidencemap_get_evidence_link_suggestions` returns deterministic source-to-claim suggestions; these suggestions do not change readiness until a review decision is recorded. `evidencemap_apply_general_final_artifacts` uses the same approval token to preview or copy approved user-supplied files into `04_export/approved-artifacts/` only when the general trust gate is ready; apply writes `general-final-artifact-receipt.json` / `.md`. The legal review tools require `approvalToken: "APPROVE_LEGAL_REVIEW_DECISION"` and only mutate local run artifacts/state.

## Boundary

The MCP server uses `JsonFileEvidenceMapStore` by default and writes durable state here:

```text
deliverables/evidence-map-store.json
```

It can run the evidence-map workflow and write local review artifacts under `deliverables/`. General review decisions are artifact-backed in the run folder. Generation mode writes local Markdown only: `04_export/final-output.md`, `04_export/formatted-output.md`, and `04_export/edited-output.md` when ready, or `04_export/general-export-refusal.md` when blocked. Refresh mode writes a receipt and prior-review snapshots under `00_refresh/`. The legal profile currently keeps source history, boundary metadata, review decisions, and reuse libraries artifact-backed in the run folder.

The server does not send files externally, write production databases, or bypass verification gates.

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
- `evidencemap_status`
- `evidencemap_next_action`
- `evidencemap_get_verification_report`
- `evidencemap_attach_legal_passage_support`
- `evidencemap_update_legal_source_authority`
- `evidencemap_update_legal_source_treatment`
- `evidencemap_accept_legal_risk`
- `evidencemap_resolve_legal_source_conflict`

`evidencemap_inspect_source_packet` and `evidencemap_run_workflow` accept `profile: "general" | "legal"`. The legal review tools require `approvalToken: "APPROVE_LEGAL_REVIEW_DECISION"` and only mutate local run artifacts/state.

## Boundary

The MCP server uses `JsonFileEvidenceMapStore` by default and writes durable state here:

```text
deliverables/evidence-map-store.json
```

It can run the existing evidence-map workflow and write local review artifacts under `deliverables/`. The legal profile currently keeps source history, boundary metadata, review decisions, and reuse libraries artifact-backed in the run folder.

The server does not send files externally, write production databases, or bypass verification gates.

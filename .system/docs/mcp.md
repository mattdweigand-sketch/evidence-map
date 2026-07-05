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

## Boundary

The MCP server uses `JsonFileEvidenceMapStore` by default and writes durable state here:

```text
deliverables/evidence-map-store.json
```

It can run the existing evidence-map workflow and write local review artifacts under `deliverables/`. Postgres can replace the JSON store when recurring update history and multi-run source/version tracking matter.

The server does not send files externally, write production databases, or bypass verification gates.

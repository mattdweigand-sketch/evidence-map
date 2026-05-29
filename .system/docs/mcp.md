# MCP Server

Truth Layer OS can run as a local stdio MCP server. This lets Codex, Claude, or another MCP client call the harness directly instead of treating the workflow as a one-shot CLI command.

## Run

```bash
npm --prefix .system run mcp
```

## Client Config

Use this shape in an MCP client config that supports local stdio servers:

```json
{
  "mcpServers": {
    "truth-layer-os": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/Users/matthewweigand/Code/truth-layer-os/.system"
    }
  }
}
```

## Tools

- `truthlayer_inspect_source_packet`
- `truthlayer_run_workflow`
- `truthlayer_status`
- `truthlayer_next_action`
- `truthlayer_get_verification_report`

## Boundary

The MCP server uses `JsonFileTruthLayerStore` by default and writes durable state here:

```text
deliverables/truth-layer-store.json
```

It can run the existing truth-layer workflow and write local review artifacts under `deliverables/`. Postgres can replace the JSON store when recurring update history and multi-run source/version tracking matter.

The server does not send files externally, write production databases, or bypass verification gates.

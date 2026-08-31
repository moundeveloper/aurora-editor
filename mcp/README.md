# Aurora MCP server

Aurora exposes its local project vault over an MCP STDIO server. The editor and MCP server use the
same project repository, so an MCP-authored project appears in Aurora's project browser and remains
fully editable.

## Run

```powershell
pnpm mcp
```

Register it with Codex from the repository root:

```powershell
codex mcp add aurora-editor -- node mcp/src/index.ts
```

The server currently provides:

- `aurora_project_list` — list projects in the vault.
- `aurora_project_get` — inspect a complete editable project document.
- `aurora_project_create_showcase` — author and activate the Neon Singularity hybrid animation.

For a protocol-level smoke test that launches the server and calls its authoring tool through an MCP
client:

```powershell
pnpm mcp:create-showcase "My Aurora Premiere"
pnpm mcp:inspect-project <project-id>
```

Set `AURORA_VAULT` for an isolated vault. By default both the application server and MCP server use
`%USERPROFILE%\Aurora`.

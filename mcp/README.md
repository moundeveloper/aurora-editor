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
- `aurora_project_create_pillar_run` — author and activate the DRONE-07 cinematic pillar run.
- `aurora_scene_object_influence_upsert` — add or update array, radial-array, mirror, subdivision, displacement, or twist influences on an existing mesh or group.
- `aurora_scene_camera_lens_set` — switch depth of field on for a camera and set its focus distance and f-number, either as values or as keyframed curves.
- `aurora_scene_light_upsert` — add or update an ambient, directional, point, or spot light, including a spot's cone angle, range, and edge softness.
- `aurora_scene_environment_set` — light a scene from an imported `.hdr` or `.exr` radiance map, optionally drawing it as the background.
- `aurora_scene_model_add` — place an imported `.glb` or `.gltf` mesh in a scene.

For a protocol-level smoke test that launches the server and calls its authoring tool through an MCP
client:

```powershell
pnpm mcp:create-showcase "My Aurora Premiere"
pnpm mcp:create-drone "DRONE-07 Pillar Run"
pnpm mcp:inspect-project <project-id>
```

Set `AURORA_VAULT` for an isolated vault. By default both the application server and MCP server use
`%USERPROFILE%\Aurora`.

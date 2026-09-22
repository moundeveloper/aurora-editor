# Crimson Citadel | The White Gardens

Created and activated in Aurora's local vault through its STDIO MCP server.

- Project ID: `31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f`
- 53 native mesh assets and scene objects; six towers, four bridge galleries, crimson ivy, cloud banks, doves, and a sloping meadow.
- 25,000 white flowers and 15,000 red foliage instances.
- A low-angle, rolled perspective camera and two editable lights.
- `Crimson-Citadel.aurora.json` is a portable copy of the saved project document.
- `aurora-render.png` is the verified 1920 × 1080 render from Aurora's actual WebGL scene runtime and post-processing. `render-metrics.json` contains its profiling report.
- `composition-preview.png` is a software geometry preview used to inspect framing. It is **not an Aurora WebGL render**: it approximates lighting and omits Aurora's shadows, ambient occlusion, and view transform.

The result is a stylized geometric reconstruction, not a photorealistic match to the reference.

## Observed limits and useful additions

| Limit | Workaround used | Addition that would improve fidelity or workflow |
| --- | --- | --- |
| MCP exposed preset project creation but no arbitrary scene creation, bulk object editing, or camera-pose authoring. | Added the `aurora_project_create_crimson_citadel` tool and invoked it using an MCP client. | General project creation and atomic bulk scene upsert, including camera pose and render settings. |
| No exposed fog or volumetric atmosphere in the current scene settings/runtime. | Pale colors on distant architecture and sculpted cloud geometry. | Height/distance fog, volumetric clouds, light shafts, and bloom controls exposed over MCP. |
| No MCP texture upload/material-map assignment tools. The application has material-map support, and environment assignment accepts an already imported HDR/EXR. | Solid-color native geometry for stone, ivy, and petals. | Texture import and PBR base-color/normal/roughness/displacement assignment with UV controls. |
| Native models are limited to 12,000 vertices/faces each. | Split larger meshes and share vertices within botanical geometry. | Batched native model creation, reusable geometry prototypes, and configurable geometry budgets. |
| Scattering is capped at 5,000 instances per source; no dedicated MCP scatter settings tool is exposed. | Eight independent, deterministically seeded sources authored by the new creation tool. | Scatter upsert with masks, surface offsets, density maps, LOD, and orientation randomness. |
| Full-project MCP reads returned a connection-closed error on the first, much larger scene. | Reduced geometry duplication; verified project listing through MCP and read the saved document locally for preview/export. The final compact export is about 14.4 MB. | Paginated object/asset queries, summary queries, and export-to-file responses. |
| Desktop/browser-control connectors were unavailable during initial creation. **Resolved for rendering.** | Added `aurora_scene_render_preview`, which uses isolated headless Chromium and Aurora's actual renderer. | Live unsaved-state inspection would still need an editor bridge. The new tool reads saved projects. |

## Validation

All generated native meshes passed Aurora's polygon validator. Creation and regeneration succeeded through the STDIO MCP protocol and the saved project passed repository schema validation. Type checking and rendering/store/MCP regression tests pass. The actual WebGL render and the editor UI were subsequently inspected after the performance fixes; see [the performance report](performance.md).

## Reproduce

From the repository root:

```powershell
node mcp/src/create-crimson-citadel.ts
```

To regenerate this project in place:

```powershell
node mcp/src/create-crimson-citadel.ts 31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f
node mcp/src/render-project.ts 31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f full 1920 1080
```

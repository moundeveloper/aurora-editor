# Crimson Citadel performance and visual verification

All 53 mesh objects, 25,000 flower instances and 15,000 foliage instances remain in the saved scene. No quality settings or authored geometry were removed to get these improvements.

## Fixes

1. **Cache instance transforms and bounds.** Surface scattering previously resampled every instance, allocated matrices, uploaded buffers and recomputed bounds on every redraw. The cache now invalidates only for relevant settings, transforms or geometry changes. Path scattering uses evaluated path transforms, so static paths cache and animated paths still move. Visibility and shadow flags still update independently. Zero counts and missing targets remove stale instances.
2. **Stop traversing native vertex arrays on playhead/selection changes.** Both 3D panels previously included `assets` in the same deep watcher as the playhead. Native draft and published meshes were traversed repeatedly. Rendering now watches lightweight asset metadata/published revision numbers, with separate time/selection and deep scene watchers.
3. **Serialize raw Vue state at persistence/history boundaries.** Undo/save snapshots retain their independent data but avoid reactive proxy access for each vertex. Edit and undo were exercised in a fresh, isolated editor context, with all HTTP writes intercepted.
4. **Correct viewport statistics.** The viewport now reports all render passes rather than only the post-processing screen triangle.

## Measurements

The before/after editor runs use a 1440 × 900 Chrome viewport on Intel UHD Graphics. Each timeline/selection sample includes two scheduled animation frames, so these are interaction timings, not GPU frame times. The “before” editor sample was taken after the scatter cache was in place but before the deep-watcher fix; it demonstrates that the watcher alone still caused multi-second freezes.

| Operation | Before corresponding fix | After |
| --- | ---: | ---: |
| Timeline step | 5,208–6,156 ms | 35–57 ms in the final verification |
| Selecting a different object | 2,616–2,853 ms | 30–34 ms |
| Commit object edit | 699 ms | 220–281 ms across two runs |
| Undo | 725 ms | 106–120 ms across two runs |

Evidence: `editor-before.json`, `editor-editing-before.json`, `editor-final.json`, `editor-verified.json` and corresponding screenshots. Edit/undo checks restored the original object position and produced no browser exceptions.

The repeatable **actual Aurora** camera render at 1920 × 1080, full quality, measured:

- 11.3 ms median warm frame; 15.9 ms P95 across six measured frames.
- 1.9 ms median scene synchronization.
- 40,000 instances; zero redundant instance-buffer uploads during the benchmark.
- 185 draw calls and 1,245,717 triangles counted across all passes, including shadows and ambient occlusion.
- Intel UHD Graphics through ANGLE/D3D11, not a software renderer.

The PNG and raw metrics are `aurora-render.png` and `render-metrics.json`. Hardware, browser warm-up, resolution and other running processes affect these timings. Cold editor load still takes roughly 6–9 seconds for this native JSON project; full history checkpoints still copy its data. Binary geometry storage and structurally shared history snapshots would further reduce loading/checkpoint costs if larger projects require it.

## Repeatable tool

`aurora_scene_render_preview` is registered in the MCP server. It launches isolated headless Chromium, uses the real scene runtime and post-processing, waits for requested assets, and returns a PNG plus profiling metrics. It does not rely on the UI being available, does not touch existing browser tabs, and does not save project changes. Its Vite dependency cache is separate from the editor's to avoid triggering editor reloads.

```powershell
node mcp/src/render-project.ts 31d7d3e4-cd9d-4e42-b7a3-2ebe2ba1ac3f full 1920 1080
```

The repository's [AGENTS.md](../../AGENTS.md) and [MCP documentation](../../mcp/README.md) preserve this workflow for future sessions. This is a still-camera render of saved state, not an unsaved UI screenshot or a complete 2D composition/motion-blur export.

The implementation follows [Three.js instance-buffer/bounds update semantics](https://threejs.org/docs/pages/InstancedMesh.html) and uses [Playwright's supported installed browsers](https://playwright.dev/docs/browsers).

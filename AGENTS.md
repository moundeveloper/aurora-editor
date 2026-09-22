# Aurora Editor agent workflow

## Inspecting a scene

Use Aurora's MCP server (`node mcp/src/index.ts`) for project operations. For visual verification, call **`aurora_scene_render_preview`** with a saved `projectId`, optional `sceneId`/`cameraId`, `time`, `quality`, `width`, and `height`. This tool runs the real Aurora Three.js runtime and post-processing in isolated headless Chromium, returns an image and metrics, and saves PNG/JSON artifacts under the vault's `renders` directory. It does not require the editor UI or development servers to be running and does not mutate the project.

If the MCP tools are not attached to the agent session, use their protocol client:

```powershell
node mcp/src/render-project.ts <project-id> preview 960 540
```

View the returned local PNG path with the image-viewing tool. Read `mcp/README.md` for setup. Do not rediscover desktop automation or use `preview-crimson-citadel.ts` as final visual verification: that older script is only a software approximation. The MCP renderer uses installed Chrome/Edge, a Playwright Chromium installation, or `AURORA_CHROMIUM_PATH`. Dependencies install through `pnpm install`.

The preview reads **saved** scene state and renders a camera, not the user's current unsaved UI. For UI regressions, the read-only browser smoke script `tests/browser/large-scene-smoke.mjs <project-id> <label>` runs against the dev server (`AURORA_APP_URL`, default `http://localhost:5173`), intercepts HTTP writes, exercises timeline/selection/edit/undo, and saves a screenshot and timings. It uses a fresh browser context, not the user's tabs.

## Large-scene performance

- Keep repeated geometry instanced. Static scatter transforms and bounds must not rebuild/upload on every redraw. Invalidate for relevant geometry/transform/settings changes, including path animation.
- Do not deep-watch `assets` alongside playhead/selection values. Published native vertex arrays are large and immutable; use `assetRenderSignature` for rendering dependencies, and separate timeline watchers from deep scene watchers.
- Persistence/history serialization should read raw Vue state to avoid a proxy access per vertex. Preserve undo semantics and immutable published revisions.
- Verify performance with the actual editor as well as the camera render. Camera benchmarks report warm render/GPU completion timing; editor timing also includes reactive updates and scheduled animation frames.
- Prefer quality/resolution overrides for previews over deleting geometry or lowering saved scatter counts. The Crimson Citadel retains all 53 mesh objects and 40,000 instances.

## MCP and UI feature parity

- Every user-facing capability exposed through Aurora's MCP server must also be available through the editor UI. This applies to scene/model authoring, presets, settings, rendering, previews, profiling, and diagnostics.
- Adding or expanding an MCP tool is incomplete until the equivalent UI workflow is implemented. Expose the meaningful options and results in discoverable controls; a terminal command or raw JSON editor does not count as UI access.
- Both interfaces must use the same underlying operations, validation, project data, and rendering behavior. Preserve normal UI undo/redo and persistence for editing actions; avoid separate MCP-only implementations of product features.
- When changing an existing MCP capability, check its UI counterpart. Identify and document any existing parity gap explicitly, and include closing that gap in work on the affected capability. Do not silently assume current tools already satisfy this rule.
- Validate both the MCP operation and the equivalent UI workflow before declaring a feature complete.

## Validation

Use `pnpm type-check` and relevant Vitest tests. For rendering changes include `src/engine/scene3d/__tests__` and `src/engine/rendering/__tests__`; for persistence/history changes include the store/history tests. Test the MCP preview through `mcp/src/render-project.ts` and inspect the resulting image before claiming a scene is visually verified.

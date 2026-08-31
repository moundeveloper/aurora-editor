# Hybrid 2D/3D feasibility

Aurora currently renders with `CanvasRenderingContext2D`; PixiJS, WebGL/WebGPU, real media decoding, durable asset storage, executable nodes, and export encoding were not present at the start of this branch.

## Decision

**GO WITH REQUIRED REFACTOR**

The exploratory implementation uses a hybrid shared-WebGL2 context. Three.js owns the canvas/context, PixiJS receives the same context, and Aurora executes explicit ordered passes with renderer-state resets. Serialized state contains only Aurora models; Three runtime objects live in a disposable registry.

This validates the core 2D/3D boundary without stacking DOM canvases or reading pixels through JavaScript. Direct rendering is intentionally the first step. Aurora-owned intermediate render targets remain required for cross-renderer masks, adjustment effects, caching, and full export.

## Initial classifications

| Area | Status |
|---|---|
| Absolute-time numeric keyframes | READY |
| WebGL2 browser target | MINOR CHANGES |
| Layer/project schema | REQUIRES REFACTOR |
| Preview renderer lifecycle | REQUIRES REFACTOR |
| Pixi + Three shared context | HIGH RISK |
| Direct render-target texture sharing | HIGH RISK |
| Node execution | REQUIRES REFACTOR |
| Durable GLB/HDR storage | BLOCKED |
| Real media decoding | BLOCKED |
| Deterministic encoded export | BLOCKED |

## Backend initialization

`HybridWebGLRenderBackend.initialize` is asynchronous — it builds the Three renderer, hands its
WebGL2 context to PixiJS, and decodes the source image. Renders requested during that window must
not start a second setup: two renderer pairs on one canvas share a single GL context with
conflicting state and the preview goes blank. Concurrent callers therefore share the in-flight
attempt, `dispose` waits for it to settle before tearing anything down, and a failed attempt is not
cached so a later render can retry.

This matters whenever the preview is mounted while the playhead is moving — switching from the 3D
workspace to Motion during playback drives a render on every frame, including the frames that land
inside the setup window.

## Branch scope

- renderer-neutral contracts and render plan;
- shared-context PixiJS 8 + Three.js WebGL2 backend;
- serialized 3D scene layer with primitive PBR meshes, camera, ambient/directional/point lights, shadows, and absolute-time animation;
- dedicated compact 3D workspace, hierarchy, inspector, picking, orbit controls, and transform gizmos;
- project schema migration and local metadata save/reload;
- deterministic plan, serialization, alpha-contract, and resize tests.

GLB/HDR blob persistence, native 3D post effects, Aurora render-target pooling, and real WebCodecs export are follow-up phases because the corresponding foundations did not exist in the original codebase.


# Aurora engine update log

This file tracks implemented changes, verification, and remaining work. New
user-facing capabilities must have equivalent UI and MCP access (AGENTS.md).

## Batch 1 — rendering overhead (completed)

- Undeformed image planes use single-pass double-sided transparency. Rigged or
  influenced planes retain two-pass rendering.
- AO and depth-of-field passes allocate on enable and dispose on disable, preserving
  pass order, resizing, and camera updates.
- Removed duplicate object-transform evaluation per scene synchronization.
- Shadow bounds are skipped when scene shadows are disabled or no light casts them.
- Browser checks wait for the requested project to finish opening.

Verification: type-check and 165 scene/rendering tests passed. HUD at 720 × 1000
dropped from 47 to 32 draw calls, with zero differing RGB pixels in a before/after
frame comparison. Citadel retains 40,000 instances and zero static instance uploads.
See [detailed evidence](artifacts/phase-hud/engine-improvements.md). Timing results
are not controlled before/after speedup measurements.

## Batch 2 — scene bounds and animation evaluation (in progress)

- Cache shadow bounds using evaluated transforms, geometry attributes and versions,
  and instance-buffer versions/counts. Added/removed meshes invalidate the cache.
- Skinned/morphing meshes conservatively bypass bounds reuse.
- Cache sorted keyframe order. Key values and easing remain live; retiming,
  insertion, deletion, replacement, and reordering invalidate order as needed.
- Unmodified meshes bypass influence-signature construction; disabling the last
  influence restores the base mesh. Scenes without groups skip group-array setup.
- Both optimizations are internal and apply equally to UI, exports, and MCP renders.

Validation pending: targeted invalidation tests, animation/scene/rendering suites,
type-check, real HUD/Citadel camera renders and editor smoke tests.

## Remaining work — not implemented

- Broader dependency-based scene evaluation, including safe Boolean/rig dependencies.
- Shared resources and scheduling across render surfaces.
- Structurally shared history snapshots and binary geometry storage.
- Transparent-aware depth-of-field handling.
- Profiling controls with UI/MCP parity and sustained playback benchmarks.

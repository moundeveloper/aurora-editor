# Aurora custom render engine

## Objective

Aurora's interactive preview must remain responsive while a project combines timeline layers,
node effects, masks, deformation rigs, decoded media, reusable clusters, and 3D scenes. The engine
targets a 16.7 ms frame budget at 60 Hz and must always prefer a recent frame over completing stale
work. Export remains deterministic and full quality.

## Research basis

- Frostbite's FrameGraph describes rendering as a graph of passes and resources so features remain
  modular while the engine can schedule and reuse resources efficiently:
  <https://www.gdcvault.com/play/1024612/FrameGraph->.
- WebGPU separates command recording, device work, and queue execution and provides reusable render
  bundles and explicit GPU resources: <https://gpuweb.github.io/gpuweb/>.
- WebCodecs exposes asynchronous codec queues and transferable, reference-counted `VideoFrame`
  resources; it also explicitly requires scarce codec resources to be released promptly:
  <https://www.w3.org/TR/webcodecs/>.
- Loop and Blinn's SIGGRAPH work renders Bézier boundaries analytically in a fragment shader rather
  than repeatedly rasterising paths on the CPU:
  <https://www.microsoft.com/en-us/research/publication/resolution-independent-curve-rendering-using-programmable-graphics-hardware/>.
- OffscreenCanvas is transferable to a worker, providing a migration path for removing rendering
  work from the UI thread: <https://html.spec.whatwg.org/dev/imagebitmap-and-animations.html>.

## Architecture

```text
Vue / Pinia authoring state
          |
          v
 AuroraFrameEngine  ---- performance telemetry / adaptive quality
          |
          v
 AuroraFrameGraphCompiler ---- source deduplication / lifetime analysis
          |
          v
 Aurora render device ---- persistent resources / pooled targets / one GPU owner
       |          |
       |          +---- media decode queue
       +--------------- 2D, effects, masks, rigs, 3D compatibility
```

The project document is not the runtime scene. It remains serialisable and MCP-friendly. The engine
compiles it into persistent runtime resources and updates only animated values per frame.

## Invariants

1. At most one render is in flight per surface. New requests replace stale queued requests.
2. A source layer is evaluated once per frame even if several graph branches consume it.
3. GPU resources are pooled by descriptor and explicitly released.
4. Structural changes rebuild only the affected runtime; value changes update uniforms/transforms.
5. Preview quality may adapt. Export quality, time, colour, and output dimensions never do.
6. A failed optional capability falls back without changing the saved project.
7. Every surface exposes CPU time, effective scale, dropped requests, logical passes, unique sources,
   draw calls, and triangles.

## Compatibility matrix

| Feature | Runtime path |
| --- | --- |
| Text, rectangles, ellipses, paths | Persistent 2D source; analytic paths are the long-term path renderer |
| Images and video | Content-addressed texture cache; sequential decode while playing, exact seek while scrubbing |
| Clusters | Nested transforms compiled into one source subtree |
| Layer transforms and opacity | Per-frame uniform/transform update |
| Node colour, transform, blur, glow, vignette | Compiled effect operations; shared upstream source |
| Mix, Stack, masks | Composite graph with pooled intermediate targets |
| 2D rigs | Persistent mesh with animated vertex positions |
| 3D primitives, models, materials, influences | Persistent 3D runtime rendered once per source |
| Cameras, paths, constraints, cuts, lights, shadows | Per-frame 3D runtime update; structural rebuild only when topology changes |
| Viewer, node preview, export preview | Same engine and graph semantics with different budgets |
| GIF/export | Deterministic immediate mode with adaptive quality disabled |

## Migration

The first integrated milestone introduces the compiler, scheduler, telemetry, adaptive preview, and
persistent 3D reconciliation while retaining the proven feature implementation behind the render
device boundary. Subsequent device work can replace individual compatibility paths without touching
the editor, project format, MCP server, or export contract.

# Feature proposals

This began as a menu rather than a plan. Implementation has since started on the
`feat/scene-realism` line; the status below is checked against the current tree so the
original proposals can remain useful without claiming completed work is still absent.

Every item was checked against the current tree, so the "why now" lines describe real
seams in Aurora rather than generic wish-list entries.

**Effort key** — `S` under a day · `M` two to four days · `L` one to two weeks ·
`XL` multi-week. Estimates assume the existing architecture holds and include tests.

## Implementation status

| ID | Status | Landed work |
| --- | --- | --- |
| P1 | Implemented | Deterministic VP9/AV1 WebM export through WebCodecs and Aurora's own WebM muxer. |
| P2 | Partial | The persistent node-audio mixer UI exists; Web Audio playback, render mixing, and amplitude drivers remain. |
| P3 | Implemented | glTF/GLB assets load as hierarchy-preserving, skeleton-safe model objects. |
| P4 | Implemented | HDR/EXR radiance maps drive scene lighting and optional environment backgrounds. |
| P5 | Implemented | Typed, ordered layer effects share the node evaluator and have live inspector controls plus legacy migration. |
| P7 | Implemented | 3D scenes use shutter-based subframe accumulation, scene and layer toggles, and quality-aware sample counts. |
| P10 | Removed | Onion skinning was implemented for Motion and 3D, then removed at the user's request: on photographic/rendered composites the ghosts read as a muddy wash rather than a legible pose, so it was not useful here. |
| P11 | Implemented | Named, coloured project markers persist, render on the ruler, snap timeline edits, and support previous/next navigation. |
| P12 | Implemented | Modal G/R/S gestures support axes, typed values, snapping, framing, and local/global orientation. |
| P15 | Partial | Spot lights, soft shadows, and keyframeable rect **area lights** exist. Per-object light linking remains: Three 0.185 collects lights per scene (a light's layers are tested against the camera, not each object), so real include/exclude lists need a multi-pass or custom-shader path, not the M-effort the proposal assumed. |
| P16 | Implemented | Keyframeable camera focus distance and f-stop drive the bokeh render pass, in the viewport playback path as well as when paused. |
| P18 | Implemented | Solid, Rendered, Wireframe, Matcap, and X-ray shading modes, plus a wireframe overlay that rides on top of any mode. |
| P27 | Implemented | Revision-safe persistent RGBA frames, background range caching, replay, cancellation, and a timeline cache bar. |
| P28 | Implemented | Searchable commands, portable global shortcuts, and a persisted in-app shortcut recorder. |
| P30 | Implemented | Named, workspace-aware undo states are visible in a compact panel and support non-destructive backward/forward jumps. |

All proposals not listed here remain unimplemented.

---

## Tier 0 — Half-built things

These already have a UI, a data model, or an importer, and stop just short of working.
They are the cheapest credibility per hour in the whole list.

| ID | Proposal | Effort |
| --- | --- | --- |
| P1 | Real video export (MP4/WebM) | L |
| P2 | Make the audio workspace real | L |
| P3 | glTF mesh import | L |
| P4 | HDRI environment lighting | M |
| P5 | Per-layer effect stack | M |

### P1 · Real video export

`ExportWorkspace` offers H.264, ProRes, and vertical presets, but `startExport` only
walks a progress bar on a timer — GIF is the sole format that actually encodes. The
deterministic frame walk in `gifExport.ts` is already the hard part; point it at
`VideoEncoder` (WebCodecs) and mux to MP4/WebM. ProRes is not reachable in-browser, so
that preset should either go or become a server-side ffmpeg job.
*Touches* `engine/rendering/gifExport.ts`, a new `videoExport.ts`, `ExportWorkspace.vue`,
`stores/editor.ts`.

### P2 · Make the audio workspace real

`AudioWorkspace.vue` is a self-contained mock: the node graph lives in component-local
state, nothing persists, and no Web Audio API call exists anywhere in the tree. Wire it
to a real `AudioContext` graph, persist it beside the node graph, draw waveforms in the
timeline, and lock playback to the audio clock. The payoff beyond audio itself is an
**amplitude driver**: expose loudness as an animatable source any property can follow,
which is how most motion-graphics work actually gets synced.
*Touches* `AudioWorkspace.vue`, `models/editor.ts`, `stores/editor.ts`, `TimelinePanel.vue`.

### P3 · glTF mesh import

`kindForFile` already classifies `.glb`/`.gltf` as `model3d`, the asset browser has a
"3D Models" folder with an icon for them — and `stores/editor.ts:799` then explicitly
refuses to make a layer from one. Meanwhile `makeGeometry` can only build a box, a
sphere, or a plane. Loading real meshes is the single biggest expressive unlock in the
3D side of the editor. Needs a `GLTFLoader` path, material mapping onto the existing PBR
model, and a decision on whether imported hierarchies become Aurora groups (they should).
*Touches* `engine/scene3d/ThreeSceneRuntime.ts`, `sceneFactory.ts`, `models/editor.ts`,
`SceneHierarchyPanel.vue`.

### P4 · HDRI environment lighting

Same story as P3: `.hdr`/`.exr` import as kind `hdr`, get an "Environments" folder and a
sparkle icon, and are then dropped. `Aurora3DScene.environmentIntensity` exists but is
only an ambient-light multiplier. Load the map, build a PMREM environment, and drive
`scene.environment` plus the world background from it. This is the fastest route to
renders that stop looking like a tech demo.
*Touches* `ThreeSceneRuntime.ts`, `AuroraSceneRenderPipeline.ts`, `ThreeDInspectorPanel.vue`.

### P5 · Per-layer effect stack

`EditorLayer.effects` is now a typed, ordered stack of node operators. The inspector can
add, configure, reorder, bypass, and remove instances, while the frame planner runs the
stack through the same evaluator used by the node graph. Version-14 migration converts
known string entries, retains their edited parameters and bypass state, and removes only
the verified generated graph nodes older projects used.
*Touches* `models/editor.ts`, `engine/nodes/evaluateGraph.ts`, `InspectorPanel.vue`.

---

## Tier 1 — Animation and timing

| ID | Proposal | Prior art | Effort |
| --- | --- | --- | --- |
| P6 | Expressions / property drivers | AE expressions, Blender drivers | L |
| P7 | Motion blur | Blender, AE | M |
| P8 | Time remapping and speed ramps | AE time remap, Resolve retime | L |
| P9 | F-curve modifiers | Blender | M |
| P10 | Onion skinning | Blender | S |
| P11 | Markers and marker snapping | all three | S |

### P6 · Expressions / property drivers

Bind any `AnimatableProperty` to another property or a small expression. Aurora's
property model is uniform and already evaluated through one function
(`evaluateNumericProperty`), which is exactly the hook a driver system needs. Start
narrow — link, offset, scale, and a whitelisted math subset — rather than shipping a JS
sandbox on day one. Pairs with P2's amplitude driver.

### P7 · Motion blur

The frame graph samples time deterministically, so an N-sample shutter accumulation is a
contained change: render sub-frames across the shutter interval and average. Per-layer
and per-scene toggles, with a shutter-angle control. No pass in
`AuroraSceneRenderPipeline` does this today.

### P8 · Time remapping and speed ramps

Layers and clusters have `start`/`duration` but time inside them runs 1:1 with the
project. A remap curve per layer would give freeze frames, reverse, and ramps. Cluster
tabs already carry their own playhead context, so the plumbing is partly there.

### P9 · F-curve modifiers

Keyframes support `hold`/`linear`/`bezier` with easing handles. Blender's next layer up
is stackable modifiers — cycle, noise, offset, limit — which turn hand-keyed motion into
procedural motion cheaply. Especially strong with the existing curve editor.

### P10 · Onion skinning

Ghost the previous and next N frames behind the current one in both the 2D viewer and the
3D viewport. Cheap to build on the existing render path, and it makes hand-keyed
animation review far easier. Blender calls it onion skinning; AE has no real equivalent.

### P11 · Markers and marker snapping

Named markers on the timeline, snapping to them, and jump-to-next/previous. `snap`
already exists as a store flag, so this is mostly model plus UI.

---

## Tier 2 — 3D authoring

| ID | Proposal | Prior art | Effort |
| --- | --- | --- | --- |
| P12 | Blender-grade transform interaction | Blender | M |
| P13 | Material texture slots | Blender, Substance | M |
| P14 | More influences: bevel, solidify, boolean, screw | Blender modifiers | L |
| P15 | Area lights, light linking, soft shadows | Blender | M |
| P16 | Depth of field | Blender, AE camera lens blur | M |
| P17 | Path and surface scattering | Blender geometry nodes | L |
| P18 | Viewport shading and overlay modes | Blender | M |
| P19 | Physics bake to keyframes | Blender rigid body | XL |

### P12 · Blender-grade transform interaction

`G`/`R`/`S` exist, which sets the expectation for everything Blender pairs with them:
type `X`/`Y`/`Z` mid-drag to constrain an axis, type a number to enter an exact value,
hold for increment snap, and choose a pivot (median, individual, active). Also
"frame selected" and a local/global gizmo toggle. Small individually, and together the
difference between a demo and a tool.

### P13 · Material texture slots

Materials carry `baseColor`, `emissive`, `metalness`, `roughness`, `opacity`,
`emissiveIntensity`, and a single image map used by planes. Add roughness, normal,
metalness, and emissive map slots fed from the asset library — a big visual return for a
contained change. A full shader-node graph is the XL version; slots are the M version and
probably where to stop.

### P14 · More influences

The influence stack (array, radial array, mirror, subdivision, displace, twist) maps onto
Blender's modifier stack, and the missing entries are the ones people reach for most:
bevel, solidify, screw, and boolean. Boolean is the hard one — the rest are geometry
passes in the same shape as what already exists. Also worth adding: drag-to-reorder in
the stack UI.

### P15 · Area lights, light linking, soft shadows

Ambient, directional, point, and spot are covered. Area lights with real shape (rect,
disc) are what studio-looking renders need, and Blender 4.x-style **light linking** —
per-object include/exclude lists — is the control that makes multi-light scenes tractable.

### P16 · Depth of field

Cameras have `fov`, `near`, `far` and can follow paths and objects, but there is no lens
blur. A focus-distance and aperture pair plus a bokeh pass in the pipeline. Reads as
"cinematic" more than any other single addition; pairs naturally with P7.

### P17 · Path and surface scattering

Bézier paths exist and drive camera and object constraints. Scattering instances along a
path or across a surface — with jitter and per-instance variation — extends the group
array work into set dressing. Runtime instancing only; no new scene objects, same as the
group array approach.

### P18 · Viewport shading and overlay modes

Solid and Rendered exist. Blender's dropdown adds wireframe, matcap, X-ray, backface
culling, statistics, and per-object display-as. Each is small; the set is what makes a
viewport feel finished.

### P19 · Physics bake to keyframes

Rigid-body simulation baked down to keyframes, so the result stays editable and
deterministic. Genuinely useful for falling/colliding motion graphics, and genuinely
expensive — a solver plus a bake pipeline. Listed for completeness; I would not start here.

---

## Tier 3 — Compositing and color

| ID | Proposal | Prior art | Effort |
| --- | --- | --- | --- |
| P20 | Colour management and view transforms | Resolve, ACES | L |
| P21 | Scopes: waveform, parade, vectorscope | Resolve | M |
| P22 | Animatable masks with a tracker | Resolve power windows, AE | L |
| P23 | Node graph quality of life | Nuke, Resolve, Blender | M |

### P20 · Colour management and view transforms

The renderer outputs sRGB with ACES tone mapping hard-wired, and intermediate passes are
tagged `NoColorSpace` by hand in the pipeline. A configurable working space with an
explicit display transform would make grading predictable and HDR reachable. Worth doing
before the colour tooling in P21, not after.

### P21 · Scopes

Waveform, RGB parade, and vectorscope on the viewer output. Straightforward given frames
are already read back for GIF export, and it is the difference between grading by eye and
grading.

### P22 · Animatable masks with a tracker

There is a `mask` node, `maskSegmentFeather`, and a `MaskEdgePainter`, but no animatable
shape masks with per-vertex keyframes, and no tracker. Resolve's power windows plus a
point or planar tracker is the standard combination. The tracker is the risky half —
worth splitting into two pieces of work.

### P23 · Node graph quality of life

Subgraphs/groups, reroute nodes, backdrop notes, node presets, viewer pinning, and an
A/B compare wipe. None are hard; all are things people expect the moment a graph gets
past a dozen nodes.

---

## Tier 4 — Text and motion graphics

| ID | Proposal | Prior art | Effort |
| --- | --- | --- | --- |
| P24 | Per-character text animators | AE text animators | L |
| P25 | Parameterised cluster templates | AE Essential Graphics / MOGRT | M |
| P26 | Text on a path | AE, Illustrator | M |

### P24 · Per-character text animators

After Effects' text animators — range selectors driving position, rotation, opacity, and
colour per character or word — are the backbone of title work. Needs a real text layout
engine with font loading, which is the bulk of the cost.

### P25 · Parameterised cluster templates

Reusable clusters already exist, with their own tabs and library. Marking selected
properties as *public* turns a cluster into a template with a small control panel — the
MOGRT idea. Low cost, high leverage on top of what is already built.

### P26 · Text on a path

Bézier paths exist and are already used as constraint targets. Flowing text along one is
a contained feature that composes with P24.

---

## Tier 5 — Workflow and platform

| ID | Proposal | Prior art | Effort |
| --- | --- | --- | --- |
| P27 | Frame cache with a timeline cache bar | AE green bar, Resolve render cache | L |
| P28 | Command palette and rebindable keymap | Blender F3, VS Code | M |
| P29 | Project versions and snapshot diff | Resolve, git-shaped | M |
| P30 | History panel | Blender, Photoshop | S |

### P27 · Frame cache with a cache bar

`renderRevision` and `AuroraResourcePool` already give a correct cache key. Persist
rendered frames, pre-render ranges in the background, and show cached spans in the
timeline. The clearest perceived-performance win available, and it makes scrubbing feel
instant.

### P28 · Command palette and rebindable keymap

A searchable palette over every store action, and user-rebindable shortcuts. Cheap given
actions are already centralised in the store, and it is how power users judge an editor.

### P29 · Project versions and snapshot diff

There is a server vault, a project library, and MCP access. Named snapshots plus a
readable diff of what changed between two versions is mostly plumbing over what exists,
and it removes the fear that makes people avoid experimenting.

### P30 · History panel

Undo/redo exists but is invisible. A list of recent actions you can click back through,
with per-workspace grouping.

---

## If it were my call

1. **P1** — real video export. An editor that cannot produce a video file is a demo, and
   the frame walk is already written.
2. **P3 + P4** — glTF meshes and HDRI environments. Both are already half-wired, and
   together they change what a scene can look like more than anything else here.
3. **P27** — frame cache and cache bar. Turns the whole app from "waits" to "responds".
4. **P12** — Blender-grade transform interaction. You already advertise `G`/`R`/`S`;
   this is the rest of that promise, and it is the kind of polish that compounds.
5. **P16 + P7** — depth of field and motion blur. The two cheapest changes that make
   output look intentional.

**Deliberately last:** P19 (physics) is weeks for a narrow payoff, and P22's tracker is
the one item here I would expect to overrun its estimate.

**One dependency worth respecting:** do P20 (colour management) before P21 (scopes), or
the scopes will measure the wrong thing and have to be redone.

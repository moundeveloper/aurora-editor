# Blender-inspired Edit Mode roadmap

Status: topology repair, initial bevel/bridge, subdivision, vertex paths, and initial edge construction implemented;
remaining roadmap proposed, 2026-09-19.

## Implemented first: topology repair

The recommended Merge/Dissolve/Fill slice is available in Edit Mode under **Repair
topology**, with a preview before committing, Escape/right-click cancellation,
single-step undo/redo, project persistence, and the shared MCP operation schema.

- Merge by distance, center, first, or last. First/last use Vertex-mode selection
  order. Distance welding only considers selected vertices and leaves the surviving
  vertex at its existing position. Collapsed faces and duplicate faces are removed;
  pinched, non-manifold, or otherwise invalid results are rejected atomically.
- Dissolve interior edges or adjacent face regions into a convex planar polygon.
  Vertex dissolve removes collinear degree-two points. Folded regions, branches,
  holes, and unsupported concave results are rejected rather than changing surfaces.
- Fill selected boundary edges/vertices with a polygon, triangle fan, or quad grid.
  Grid fill uses four equally sampled sides (4, 8, 12… boundary vertices), with a
  Coons patch for interior vertices. Triangle fan fill requires a convex planar loop.
- Fill all holes, select open boundaries, and remove loose vertices. The current
  source model has face-owned edges, so independent loose edges do not exist.
- `M` opens merge options, `F` previews fill, and `Alt+X` previews dissolve.
- Authored-edge and face-corner adjacency uses deterministic endpoint/face-vertex
  identities. Operation results expose created/deleted IDs, selection candidates,
  diagnostics, and a source snapshot for undo. Surviving IDs remain stable; changed
  endpoints invalidate edge references explicitly. Render triangles remain derived.

The broader milestone is still open: general degenerate cleanup, arbitrary concave
hole triangulation, configurable grid spans, and junction-vertex dissolve remain
future work.

## Implemented next: Bevel and Bridge Edge Loops

Edit Mode's **Construct topology** panel provides both operations through cancellable
previews, with new faces selected on commit and a single undo step. Their shared
operation schemas are also available through MCP.

- Edge bevel: width in meters (offset within each incident face), 1–16 segments,
  and a 0.1–0.9 convex profile control; 0.5 gives a circular cross-section on a right
  angle. `Ctrl+B` previews using the panel parameters. Connected edge selections are
  supported. Bevel planes intersect at corners; custom corner patches are not yet
  supported. Subdivided straight corners must have all their segments selected.
- Vertex bevel: one-segment chamfers, exposed by `Ctrl+Shift+B` or the vertex button.
  Width limits the distance along incident edges; unequal corner angles may yield
  unequal edge offsets. The segments/profile fields apply only to edge bevels.
- Bevel currently requires closed convex components, planar faces, and outward
  normals. It leaves unrelated disconnected components untouched. Coplanar edges,
  open boundaries, concave components, and invalid results report errors atomically.
- Overlap clamping conservatively limits width using neighboring edge/face spacing.
  Turning it off rejects widths above that limit. Further unsupported overlaps are
  rejected rather than removing existing source faces.
- Bridge accepts exactly two complete open boundary loops with equal vertex counts.
  `Shift+B` previews the bridge using the panel parameters.
  It automatically chooses the closest correspondence, supports signed twist in
  vertex steps, and creates 0–32 intermediate rows using linear interpolation.
  Branches, partial loops, unequal counts, existing matching walls, and invalid
  output are rejected.
- Bevel preserves original face IDs; new strips/chamfers and bridge quads receive
  fresh IDs. Generated geometry is authored topology, not render triangles.
- The timeline's Split shortcut is disabled in Modeling so it does not intercept
  `Ctrl+B` while the modeling viewport is focused.

General concave/open-surface bevel, multi-segment vertex bevel, bridge merge,
multi-loop bridging, and smooth interpolation remain future work.

## Implemented next: subdivision and vertex paths

The **Construct topology** panel and viewport toolbar now provide:

- **Subdivide**: 1–15 cuts on selected faces or edges. Fully selected triangles and
  quads become regular grids; partial edge selections insert evenly spaced points.
  Vertex mode uses edges whose endpoints are both selected. Every incident face
  reuses the same edge samples, including unselected neighbors, preventing cracks.
  Quad interiors use bilinear interpolation and triangles use barycentric
  interpolation. Original corners and one child face retain their original IDs.
- **Un-Subdivide**: 1–4 iterations of geometric coarsening over selected faces.
  It recognizes complete regular 2×2 quad blocks using adjacency and midpoint/
  center positions, independently of operation history or generated ID names.
  Original corner positions are preserved. Partial-region coarsening retains
  necessary transition vertices beside finer neighbors. A transition face may be
  an n-gon, which cannot be coarsened again with this initial implementation.
- **Connect Vertex Path (`J`)**: Ctrl-click distinct vertices in order, then preview
  straight connections between consecutive vertices. Paths can cross multiple
  convex coplanar faces and pass through existing vertices. Crossed edges receive
  one shared intersection vertex, and crossed faces split into authored polygons.
  Existing edges can form part of a path. The completed path edges are selected.
- All three operations use the shared kernel and MCP schemas, provide cancellable
  previews and one-step undo/redo, and persist their authored source topology.
  Subdivide selects all child faces, including the child that reuses its parent ID;
  Un-Subdivide selects the surviving coarse faces.

Limits: face subdivision requires triangles/quads; expanded neighboring polygons
must satisfy the existing convexity, planarity, and 128-corner limits. Un-Subdivide
rejects odd-sized/incomplete grids, irregular midpoint or center positions, and
excessive iterations atomically. It is geometric coarsening, not general mesh
decimation. Connect Path requires continuous, topologically connected coplanar
surfaces; it cannot bridge gaps, connect loose vertices, or cross bent faces.

## Implemented next: edge rotation, region split/rip, and poke

The viewport toolbar and **Construct topology** panel provide cancellable previews,
Enter/click confirmation, single-step undo/redo, persistence, and MCP operations:

- **Rotate edge** flips an interior diagonal between two coplanar triangles while
  retaining face IDs and winding. Multiple selected edges must not share faces.
  Boundaries, quad pairs, folded pairs, and existing/outside diagonals reject.
- **Split region** detaches selected faces by duplicating only vertices shared with
  unselected faces. Selected faces stay connected to each other and keep their
  positions and IDs. Already disconnected selections reject as no-ops.
- **Rip region** performs the same detachment and moves the entire selected region
  by explicit X/Y/Z offsets in meters. The offset must be nonzero. This initial
  version uses face selection to specify the detached side; vertex/edge seam rip,
  interactive rip dragging, and rip-fill remain future work.
- **Poke faces** creates an authored center and triangle fan per selected planar
  face, with an optional signed height along each face normal. One triangle retains
  the original face ID. Bent faces reject atomically.

The new diagonal is selected after rotation; split/rip preserve region selection,
and poke selects all resulting triangles. Unsupported geometry and stale IDs leave
source topology unchanged. These tools validate local topology, not intersections
between otherwise valid disconnected surfaces.

Broader edge tools such as quad-edge rotation, offset-slide, and general seam rip
remain open.

## Implemented next: connected selection and selection rings

Edit Mode now offers **Selection** controls and viewport toolbar entries for linked,
shortest-path, and grow/shrink selection in vertex, edge, and face modes:

- **Linked (`L`)** expands from the current selection to its connected components.
  It includes hidden geometry regardless of X-Ray state. This initial version does
  not use hover picking or delimit by normals, seams, materials, or UVs.
- **Path Select** joins exactly two selected endpoints using the fewest adjacency
  connections. Ctrl-click still toggles individual elements. Vertex paths follow
  authored edges; edge paths share endpoints; face paths cross shared edges.
  Equal-length paths resolve deterministically in topology order. Geometric length
  weighting and path delimiters remain future work.
- **Grow (`]`)** adds one ring of adjacent elements. **Shrink (`[`)** removes the
  selection border, elements on open mesh boundaries, and isolated elements.
- **Invert** selects all currently unselected elements in the active mode.

These tools only change transient selection; they do not modify geometry, consume
mesh revisions, or create project undo entries. Invalid or disconnected path
requests retain the previous selection and show an error. During an edit preview
the selection controls are disabled. The shared read-only MCP selection query
returns the same results and rejects stale draft revisions.

## Implemented next: Select Similar and selection by trait

The **Selection** panel now includes mode-aware custom dropdowns and actions:

- **Select Similar (`Shift+G`)** adds elements matching any selected reference.
  Vertices compare connected-edge or incident-face counts; edges compare length,
  unsigned angle between incident face normals, or incident-face count; faces
  compare area, oriented normal direction, or corner count. Face areas use a fan
  triangulation, including bent quads. Boundary edges have no face angle and cannot
  be angle references. Matches do not become new references during the query.
- Tolerance is absolute: meters for length, square meters for area, degrees for
  normal/angle, and counts for connectivity. It defaults to zero (with numerical
  epsilon), is limited to 0–180, and resets when selection mode changes.
- **Select by trait** replaces the current selection and needs no reference.
  Open boundaries and non-manifold selection work in all three modes; face results
  include faces touching matching vertices. Non-manifold includes open edges,
  inconsistent winding/overused edges, isolated vertices, and disconnected face
  fans at a shared vertex. It is a topology query, not an intersection detector.
- Vertex mode additionally offers **Loose vertices** and **Interior poles**.
  A pole here has positive edge degree other than four and is not on a boundary;
  this is a quad-topology aid, not a mesh validity failure. Loose edges are not
  representable in the current face-owned edge model.

Queries include hidden geometry, preserve mesh revision and undo history, and use
the same read-only MCP query. Unsupported properties and stale references fail
without replacing the selection. Material, seam, crease and UV comparisons await
mesh attribute support.

## Implemented next: checker deselection and named selection sets

Edit Mode's **Selection patterns and sets** panel provides:

- **Checker deselect** with keep/skip counts (1–100) and pattern offset (0–199).
  It filters the existing vertex, edge, or face selection by shortest adjacency
  rings within selected geometry. Each disconnected selection component restarts
  at its first selected element. Results retain input order. Odd cycles, branches,
  and face/edge adjacency graphs need not produce a strict alternating checkerboard.
- **Named selection sets** save up to 64 sets per model with distinct names of
  1–64 characters, selection mode, and ordered IDs. Save New rejects duplicate
  names; Update explicitly replaces the chosen set with the current selection.
  Recall replaces selection and switches mode; Delete removes the saved set.
- Set writes use revision-checked atomic model operations, project persistence,
  and undo/redo. Recall and checker deselection are transient selection changes.
  Topology edits prune deleted references, preserve surviving IDs, and retain empty
  sets with an explanatory recall message. Generated elements are not added to sets
  automatically. Undoing the topology edit restores the earlier set membership.
- Sets are optional draft metadata, so existing projects remain compatible; model
  publication and copies retain their snapshot's sets. MCP can save/update/delete
  through operations, list summaries, and page a named set's members through Get.

The initial selection-productivity milestone is now implemented. Normal/material/
seam delimiters and richer mesh-attribute comparisons remain future extensions.
## Implemented next: normal offsets, radial offsets, and flattening

Edit Mode's **Shape tools** panel provides cancellable previews with Enter/click
confirmation, one-step undo/redo, persistence, and shared MCP operations. Vertex,
edge, and face selections resolve to their vertices; topology and saved IDs remain
unchanged.

- **Shrink/Fatten (`Alt+S`)** offsets each selected vertex by a signed distance in
  meters along its normalized, area-weighted incident surface normal. All incident
  faces contribute, including unselected faces. Loose vertices and cancelling
  normals reject. This is vertex-normal displacement, not even-thickness shelling.
- **Push/Pull** offsets each vertex by a fixed signed radial distance from the
  selected vertices' arithmetic center. Vertices at the pivot and distances that
  reach or cross it reject. This differs from proportional scaling.
- **Flatten** projects at least three selected vertices toward a plane through
  their center with strength 0.001–1. Choose X/Y/Z as the plane normal or Average.
  Average sums oriented area vectors from fully selected faces, falling back to
  incident faces if none are fully selected; closed/opposing selections can cancel.
  It is an average surface plane, not a least-squares fit. Strength 1 fully flattens.
- Zero/no-op edits, local face/edge reversals, collapsed geometry, and results that
  violate existing convexity/planarity limits reject atomically. These checks do not
  detect global surface intersections; adjacent unselected polygons may limit edits.

**Vertex slide and smoothing are next** in shape control. Proportional editing,
symmetry, bisect, and normal recalculation remain open.

Aurora already has the first modeling slice: Object/Edit Mode, vertex/edge/face
selection, shared viewport navigation, X-Ray selection, multi-select, loop selection
and sliding, loop cuts, Knife, extrusion, inset, region extrusion/inset, component
transforms, axis constraints, deletion, and asset publishing. This document records
the next features to consider after that foundation.

Blender's Edit Mode is organized around selection, topology construction, transforms,
cleanup, normals, mesh attributes, and UV editing. The official mesh-editing index is
the broad reference for this roadmap:

- [Blender mesh editing reference](https://docs.blender.org/manual/en/4.0/modeling/meshes/editing/index.html)
- [Linked and shortest-path selection](https://docs.blender.org/manual/en/5.2/modeling/meshes/selecting/linked.html)
- [Select Similar](https://docs.blender.org/manual/en/latest/modeling/meshes/selecting/similar.html)
- [Mesh cleanup](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/mesh/cleanup.html)
- [Editing normals](https://docs.blender.org/manual/en/5.3/modeling/meshes/editing/mesh/normals.html)
- [Bridge Edge Loops](https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/edge/bridge_edge_loops.html)
- [Shrink/Fatten](https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/mesh/transform/shrink-fatten.html)

## Proposed feature order

| Priority | Feature | Purpose | Blender-style interaction |
| --- | --- | --- | --- |
| P0 | Linked selection | Select all connected geometry, or stop at a normal, material, seam, sharp, or UV boundary. | `L`, `Shift+L`, `Ctrl+L` |
| P0 | Shortest-path selection | Select a continuous vertex, edge, or face path between two elements. | Dedicated Path Select tool; see shortcut conflict below |
| P0 | Grow/Shrink selection | Expand or contract a selection through adjacent topology. | Selection menu and shortcuts |
| P0 | Select by trait | Select boundaries, non-manifold geometry, loose geometry, poles, or checker patterns. | Selection menu |
| P0 | Select Similar | Select elements with similar area, length, angle, normal, material, crease, sharpness, or topology. | `Shift+G` |
| P0 | Merge and Dissolve | Merge by distance, merge at center/first/last, and dissolve vertices, edges, or faces while retaining surrounding surfaces. | `M` merge menu; dissolve actions |
| P0 | Fill tools | Fill a boundary, triangle-fill, grid-fill, or fill holes after deleting geometry. | `F` and fill menu |
| P1 | Bevel | Chamfer selected edges or vertices with width, segments, profile, and overlap handling. | `Ctrl+B`, `Ctrl+Shift+B` |
| P1 | Bridge Edge Loops | Connect two or more loops with cuts, twist, merge, interpolation, and smoothness controls. | Bridge tool |
| P1 | Subdivide and Un-Subdivide | Add evenly spaced topology or remove unnecessary subdivision. | Subdivide menu |
| P1 | Connect Vertex Path | Create edges between selected vertices, including multiple paths and optional faces. | Connect tool |
| P1 | Edge topology tools | Rotate an edge, subdivide an edge ring, offset-slide, split, rip, and poke faces. | Edge/Faces menus |
| P2 | Extrusion variants | Extrude vertices, edges, individual faces, along normals, to the cursor, or along an averaged region normal. | Extrude menu |
| P2 | Proportional Editing | Move, rotate, or scale nearby unselected geometry with adjustable falloff. | `O`, radius wheel control |
| P2 | Mirror and Symmetry | Mirror while modeling, symmetrize an existing mesh, and snap mismatched halves together. | Mirror/Symmetry tools |
| P2 | Bisect | Cut the entire mesh with a plane, optionally fill the cut and remove one side. | Bisect tool |
| P2 | Shrink/Fatten and Push/Pull | Move selected geometry along normals or toward/away from the pivot. | `Alt+S`; Push/Pull tool |
| P2 | Vertex Slide and Smooth | Slide vertices along connected edges and smooth selected positions. | `G` then `G`; Smooth tools |
| P3 | Normals | Recalculate outside/inside, flip normals, set normals from faces, and show face orientation. | `Shift+N`, `Shift+Ctrl+N`, `Alt+N` |
| P3 | Cleanup | Delete loose geometry, remove degenerates, make faces planar, split non-planar/concave faces, and perform limited dissolve. | Cleanup menu |
| P3 | Triangle/quad conversion | Triangulate, convert triangles to quads, and provide controlled quad-flow cleanup. | Faces menu |
| P3 | Mesh attributes | Mark seams, sharp edges, creases, bevel weights, material assignments, and vertex groups. | Edge/Face/Attribute menus |
| P4 | UV editing | Unwrap, mark seams, select UV islands, pin, pack, and edit UVs beside the 3D viewport. | UV workspace |
| P4 | Sculpt-like editing | Grab, smooth, inflate, flatten, crease, and pinch for fast shape iteration. | Brush tools |

## Recommended implementation milestones

### Milestone 1: topology safety

Implement merge by distance, dissolve, boundary fill, grid fill, fill holes, delete
loose geometry, and basic cleanup. These operations make deletion and Knife workflows
recoverable instead of leaving users to rebuild missing surfaces manually.

### Milestone 2: hard-surface construction

Add edge and vertex bevel, subdivide/un-subdivide, bridge edge loops, connect vertex
paths, rotate edge, and poke. This is the most valuable set for building environment
pieces, architectural forms, and props.

### Milestone 3: selection productivity

Add linked selection, shortest-path selection, Select Similar, Grow/Shrink, checker
deselection, boundary/non-manifold selection, and selection sets. Selection tools
should work consistently in vertex, edge, face, and X-Ray modes.

### Milestone 4: shape control and validation

Add proportional editing, mirror/symmetry, bisect, Shrink/Fatten, vertex slide, smooth,
normal recalculation, face orientation display, and planar cleanup.

### Milestone 5: authoring data

Extend the mesh model with seams, sharp edges, creases, bevel weights, material slots,
vertex groups, UVs, and named selections. Follow this with a UV editor and material
assignment tools.

## Interaction decisions

- Preserve the current pan, orbit, zoom, axis views, X-Ray, and transform behavior from
  3D Scene.
- Keep every operation available from both the viewport and a visible tool/menu entry.
- Make topology operations previewable, cancellable, undoable, and atomic.
- Keep the existing Ctrl+click multi-select behavior. Blender uses Ctrl+click for
  shortest-path selection, so Aurora should expose Path Select as an explicit tool or
  use a separate modifier rather than silently changing the current gesture.
- Keep Escape behavior consistent: cancel a transform preview, but preserve topology
  that was already created when the operation follows the existing extrusion rule.
- Reuse the same operation kernel for human editing, undo/redo, persistence, and MCP.

## Mesh-kernel prerequisites

Before bevel, bridge, dissolve, seams, creases, or UVs, the mesh kernel should gain
stable vertex, edge, face, and face-corner IDs with explicit adjacency. A half-edge or
equivalent structure is appropriate. Render triangles should remain a derived cache;
authored edges must not be confused with internal triangulation diagonals.

Each operation should return created and deleted IDs, selection results, diagnostics,
and an undo record. When an operation invalidates downstream element references, the
editor should report that clearly and reselection should be intentional.

## Recommended next slice

Start with **Merge/Dissolve/Fill**, then add **Bevel** and **Bridge Edge Loops**. Together
they provide the biggest improvement to everyday modeling while exercising the
adjacency and undo infrastructure required by the rest of the roadmap.

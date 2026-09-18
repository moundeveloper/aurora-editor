# Blender-inspired Edit Mode roadmap

Status: proposed follow-up roadmap, 2026-09-18.

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

# Modeling extra improvements

Status: proposed follow-up improvements, 2026-09-18.

This document complements the [Blender-inspired Edit Mode roadmap](./blender-edit-mode-roadmap.md).
It covers improvements that make Aurora a complete asset-production tool around the
modeling viewport: faster interaction, non-destructive workflows, image-based
reconstruction, production handoff, and MCP automation.

## Immediate viewport and workflow improvements

### Last-operation panel

After a modeling operation, show an adjustable panel for its parameters. Examples
include bevel width and segments, inset thickness, loop-cut position, extrusion
distance, subdivision levels, and bridge-loop twist. Changing a value should update
the operation without requiring a destructive undo-and-rebuild cycle.

### Pivot and transform orientation

Add Median Point, Active Element, Individual Origins, 3D Cursor, and View pivots. Add
Global, Local, Normal, and View orientations. Show the active pivot and orientation in
the viewport so component transforms remain predictable.

### Snapping

Support grid, increment, vertex, edge, face, perpendicular, and surface snapping.
Provide magnet, snap target, absolute-grid-snap, and snapping-to-selected controls.
Snapping should work for transforms, Knife, loop sliding, placement, and 3D cursor use.

### Selection and visibility tools

Add named selection sets, selection history, hide/reveal selected, isolate selected,
local view, invert selection, select boundary, select non-manifold, and quick
visibility filters. Selection sets should be stored with the model and available to
MCP operations.

### Transform precision

Support typed expressions, numeric duplication, snapping increments, transform
orientation switching during a modal action, repeat-last-operation, and a compact
transform history. Numeric fields should remain editable after confirmation.

### Reference and measurement tools

Add image reference planes, reference opacity and locking, rulers, dimensions, angle
measurement, unit display, editable guides, and vanishing-point helpers. These tools
are important for rebuilding architecture and environments from a single image.

### Viewport layouts

Allow synchronized Perspective, Front, Right, Top, Wireframe, and UV views. Add local
view, clipping planes, section/cutaway mode, camera lock, ghosted references, and
configurable overlay density for dense meshes.

### Topology diagnostics

Provide overlays and a report for non-manifold edges, loose geometry, flipped normals,
duplicate vertices, overlapping faces, ngons, concave faces, self-intersections,
unexpected poles, and invalid scale or units. Diagnostics should identify the
affected elements and offer safe fixes where possible.

## Non-destructive and procedural modeling

### Modifier stack

Add an ordered, previewable, undoable modifier stack with enable, disable, reorder,
duplicate, apply, and edit-cage controls. The first modifiers should be Mirror, Array,
Bevel, Boolean, Solidify, Subdivision Surface, Shrinkwrap, Decimate, Weighted Normal,
and Lattice.

Modifiers must preserve source topology until explicitly applied. The editor should
show when a modifier invalidates element IDs and should provide a clear evaluated-versus-
source selection mode.

### Procedural modeling

Add a Geometry Nodes-style graph for repeaters, instancing, scattering, profiles,
curves, transforms, and attribute fields. Provide reusable generators for buildings,
bridges, corridors, platforms, pipes, cables, stairs, panels, and modular kits.

Procedural results should be publishable as editable assets or retained as linked
procedural definitions with exposed controls.

### Advanced topology workflows

Add Spin, Screw, Knife Project, Convex Hull, voxel remesh, surface slide, automatic
retopology, and Quad Draw-style surface snapping. Include loop relaxation and tools for
repairing uneven topology after large edits.

## Sculpting, painting, and UV production

### Sculpting and mesh painting

Add sculpt brushes for grab, smooth, inflate, flatten, crease, pinch, scrape, and
clay. Support masks, face sets, multiresolution, dynamic topology, vertex paint,
weight paint, and texture painting.

### UV and baking pipeline

Add seam marking, unwrap, island selection, pinning, packing, UV layouts, UDIM support,
and a synchronized UV editor. Follow with normal, ambient-occlusion, curvature, and
thickness baking, texture atlasing, and material preview validation.

## Image-to-3D reconstruction

Create a guided workflow for rebuilding a reference image:

1. Import the image as a locked reference.
2. Estimate or manually set camera perspective and vanishing lines.
3. Place blocking planes and primitives against the reference.
4. Estimate depth from image regions and generate a coarse blockout.
5. Refine structures with editable topology and modular generators.
6. Project or assign materials while preserving the original image as a guide.
7. Save the reconstruction as a native asset with camera and reference metadata.

The system should clearly label estimated geometry and let the user replace every
automatic result with normal editable modeling operations.

## Asset production and interoperability

Add automatic LOD generation, collision-mesh generation, pivot/origin helpers, scale
and unit validation, naming validation, dependency reports, material-slot inspection,
and GLB/OBJ export presets. Include an asset preview scene and a before/after revision
comparison.

Asset publishing should support variants, immutable revisions, tags, thumbnails,
linked instances, Make Unique, dependency copying, and safe replacement previews.

## MCP and reusable automation

Every modeling operation should expose the same behavior to the UI and MCP. MCP
operations should support:

- dry-run and preview output;
- expected-revision checks;
- atomic transactions with rollback;
- deterministic operation IDs;
- named selection references instead of fragile array indices;
- progress and diagnostics;
- model snapshots and structural diffs;
- human approval checkpoints for destructive or large operations;
- reusable operation batches and saved modeling recipes.

Add a macro recorder so a user can record actions such as “select face, inset,
extrude, bevel” and save the result as a project tool, shortcut, or MCP recipe.

## Collaboration and quality infrastructure

Add model comments, visual revision diffs, asset locks, branchable model drafts, and
merge conflict reporting for concurrent editing. Keep published assets immutable and
make draft changes recoverable through autosave.

Maintain a modeling regression library containing representative cubes, ngons, open
surfaces, high-poly meshes, concave faces, modifier stacks, and corrupted inputs.
Run topology-operation fuzz tests, golden-mesh comparisons, undo/redo tests, MCP/UI
parity tests, and performance budgets for selection and overlay rendering.

## Suggested delivery order

1. Last-operation panel, pivot/orientation controls, snapping, and transform precision.
2. Selection sets, visibility tools, reference images, measurements, and diagnostics.
3. Modifier stack with Mirror, Bevel, Solidify, Boolean, and Subdivision.
4. Asset validation, LODs, collision meshes, GLB export, and baking.
5. Image-to-3D camera matching and guided blockout.
6. Procedural modeling and reusable environment generators.
7. Sculpting, retopology, UV painting, and advanced texture workflows.
8. MCP recipes, macro recording, collaboration, and large-project performance work.

The highest-value near-term combination is the last-operation panel, transform and
snapping controls, topology diagnostics, reference-image alignment, and a small
non-destructive modifier stack. Together they make the existing editor faster and
more reliable before expanding into procedural and sculpting systems.

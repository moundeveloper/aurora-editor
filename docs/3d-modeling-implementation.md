# Native modeling: first implementation



Implemented: a usable first modeling slice, not the full roadmap in `3d-modeling-workspace-plan.md`.



## Human workflow



1. Open a project and choose **Modeling** in the workspace switcher.

2. Create a **Cube** or **Plane**.

3. Enter **Edit Mode**. Use **1 / 2 / 3** for vertex, edge, or face selection. Left-click selects; Shift-click adds/removes elements; A selects all and Alt+A clears the selection.

4. Choose the Move/Rotate/Scale toolbar tool and drag its gizmo, or press **G / R / S**, move the pointer, optionally constrain with **X / Y / Z**, type a numeric value, and confirm with Enter or left-click. Escape/right-click cancels the preview. **E / I** starts interactive single-face extrusion/inset. Sidebar fields remain available for exact edits. Inset currently scales the polygon toward its centroid by a fraction; it is not an equal-distance edge offset.

5. **Save as Asset** publishes the draft and a viewport thumbnail.

6. **Place in 3D Scene** places the latest published revision. A scene is created if the project has none.

7. In the 3D Inspector use **Edit Model**, **Update to latest published**, or **Make Unique**.



Drafts participate in existing project autosave and undo/redo. Double-click a native model in the normal asset browser to reopen its source. Placed copies remain pinned when drafts change or newer revisions are published. Source deletion is refused while scene instances or saved scene templates still reference it.



Viewport navigation matches 3D Scene through a shared configuration: left-drag orbits, middle/right-drag pans, and the wheel zooms. Stationary left-click selects; gizmo drags transform the selection. Tab switches Object/Edit Mode. Z toggles quad wire display; Alt+Z toggles X-Ray selection. Period frames the model. Front/Top/Right reposition the perspective editor camera; orthographic projection is not implemented in this workspace yet.



Source primitives, extrusion caps, and side walls are quad polygons. Rendering still uses GPU triangles internally; selection, outlines, and wire mode use source polygons and show no triangulation diagonals. Vertex edits can bend quads without replacing their topology. Concave/self-intersecting projected polygons are still rejected.



Selections can contain multiple vertices/edges/faces. Transforms use the selected vertices' median as pivot. Extrude and inset support one or more selected faces as a joined region. Cancel rolls back the entire pending extrusion, including new topology. The current editor supports axis constraints in global coordinates; Shift+axis plane constraints are supported for Move/Scale; local/normal transform orientations remain future work.



## MCP



Restart the STDIO MCP server after updating the code. It now exposes:



- `aurora_model_create`: create a cube/plane native draft.

- `aurora_model_get`: read revision, color, topology counts, published revisions, and paginated vertex/face IDs.

- `aurora_model_operations_apply`: apply an atomic batch of typed operations against an expected draft revision.

- `aurora_model_publish`: publish a revision.

- Existing `aurora_scene_model_add`: place either an imported glTF model or a published native model.



Example operation payload after reading the generated asset ID:



```json

{

  "projectId": "your-project-id",

  "assetId": "your-model-asset-id",

  "expectedRevision": 1,

  "operations": [

    { "type": "inset", "faceId": "f5", "fraction": 0.2 },

    { "type": "extrude", "faceId": "f5", "distance": 4 }

  ]

}

```



The original cube's `f5` is its upward-facing polygon. The cap keeps its ID through inset and extrusion. This batch ends at revision 3. UI and MCP execute `shared/modeling.ts`; invalid batches never save partially modified source.



## Persistence and concurrent saves



This first slice stores bounded native drafts/revisions inside existing project asset records, so both IndexedDB and vault project files preserve them. The larger content-addressed mesh-blob design remains future work. Limits are 12,000 vertices/faces and 50 published revisions per model. Existing project snapshot history remains in use; this is intended for small hard-surface assets, not dense production meshes.



The repository now serializes writes with an atomic filesystem lock. HTTP clients receive ETags and the editor sends `If-Match`. MCP repository reads retain their source ETag. Stale saves return a conflict instead of overwriting newer data; the browser creates a separate named Local recovery project in IndexedDB and displays the error, so reopening the remote original cannot erase unsynchronized local work.



This is conflict detection, not live collaborative synchronization. Browser and MCP edits are not yet pushed into one shared live history. Save/close the project before substantial MCP work and reopen it afterward. Reconcile conflicting edits explicitly; do not expect automatic merge. Legacy callers that deliberately save a new snapshot without a read token retain their explicit replacement behavior.



If a process is forcibly terminated while holding a project lock, later writes report a busy writer. Recovery currently requires verifying no writer is active before removing that project's empty `.aurora.json.lock` directory. Automatic stale-lock recovery is not implemented.



## Geometry scope and remaining work



- Stable vertex/face IDs, polygon adjacency validation, atomic source edits, and deterministic render-triangle-to-face mapping are implemented.

- Triangles and convex quads, including bent quads, are accepted. Larger n-gons must remain planar. Degenerate, inconsistent-winding, and non-manifold edges are rejected. Validation does not detect every inter-face self-intersection.

- Rendering uses generated per-face projected UVs and flat normals. Authored UV seams, material slots, full topology attributes, general edge bevel remain future work.

- Native scene geometry uses the existing runtime and can receive scene influences. Modeling has a basic studio viewport, not yet the complete shared scene shading UI.

- No worker evaluation, compact mesh history, lossless native blob library, GLB conversion/export UI, capture MCP tools, live event service, or atmosphere reconstruction is included yet.

- No reference-image scene was generated by this implementation.



## Verification



Tests cover extrusion/inset topology and winding, immutable publication, stale revisions, invalid-edit rollback, source serialization, IndexedDB reopen, selective instance updates, Make Unique, undo/redo, runtime cache invalidation, source-deletion protection, MCP authoring through the protocol, failed-batch rollback, and concurrent HTTP/MCP stale-write rejection.



Automated selection tests now exercise screen-space vertex/edge picking, quad-face picking, occlusion/X-Ray, selection conversion, and quad-preserving transformations. Windows Computer Use attempted visual verification but stopped because it could not confidently determine the current browser URL; interactive visual QA remains outstanding. The production build and automated suite are the completed checks; they do not substitute for that visual review.





## Blender interaction references



The viewport revision follows Blender's selection modes, default navigation, and transform confirmation workflow, with the explicit implementation limits above:



- [Selection modes](https://docs.blender.org/manual/en/5.1/modeling/meshes/selecting/introduction.html)

- [Default keymap](https://docs.blender.org/manual/id/5.1/interface/keymap/blender_default.html)

- [Axis locking](https://docs.blender.org/manual/id/5.1/scene_layout/object/editing/transform/control/axis_locking.html)

- [Extrude region](https://docs.blender.org/UATEST/manual/en/dev/modeling/meshes/tools/extrude_region.html) — reference for boundary-only side walls around multi-face regions.





## Quad loop cuts



In Edit Mode, choose **Loop Cut** or press **Ctrl+R** with the viewport focused. Hover an edge to preview the connected quad strip in magenta. Wheel adjusts 1–16 cuts. Click to place; for a single cut, move horizontally to slide (or use the Position field), then click/Enter to commit. Escape/right-click cancels the entire preview. Multiple cuts are evenly spaced and commit on the first click. The new loop edges become selected; the edit is one undo step.



MCP `aurora_model_operations_apply` accepts `{ "type": "loop-cut", "edge": ["v0", "v1"], "cuts": 1, "position": 0.5 }` through the same validated operation kernel. Position is measured from the first seed endpoint and propagated consistently around the strip. Source remains quads, with shared cut vertices. Strips reaching non-quads, non-manifold edges, or unsupported twisted/self-crossing topology are rejected atomically. Loop selection and constrained edge slide are described below.



Interaction reference: [Blender Loop Cut](https://docs.blender.org/manual/en/latest/modeling/meshes/tools/loop.html). Navigation deliberately follows Aurora 3D Scene.



## Loop selection and edge slide

- **Alt+left-click an edge** selects the connected edge loop in Edge/Vertex mode. Regular quad loops continue through vertices with four incident edges; poles stop the selection. Boundary seeds follow unambiguous boundary loops. In Face mode, Alt-click selects the perpendicular row of quad faces.
- **Shift+Alt+click** adds a loop; clicking a fully selected loop removes it. The seed respects visible-surface picking unless X-Ray is enabled; traversal selects the whole loop including its hidden side.
- In Edge or Vertex mode, **G, G** switches a move preview into Edge Slide without committing the move. The **Slide** button starts it directly. Move horizontally or type a signed factor; Shift gives finer pointer movement. Enter/left-click confirms; Escape/right-click cancels. One confirmed slide is one undo step.
- Slide follows the existing adjacent edges on either side, using their connectivity to keep direction consistent. It preserves vertex/face IDs and quad topology. It is not a shape-preservation modifier: curved, bent, or uneven surfaces can change silhouette as vertices slide.
- Supported selections are unbranched edge chains or loops with two neighboring quad faces per edge and unambiguous rails outside the selection. Boundary slides, branches, adjacent selected loops sharing a face, non-quads, and twisted rails are rejected. Factors clamp to ±0.99 to avoid collapsing faces. Blender's Even, Flipped, unclamped slide and UV correction options are not yet implemented.

MCP `aurora_model_operations_apply` also accepts `{"type":"edge-slide","edgeIds":["[\"v20\",\"v21\"]"],"factor":0.25}`. Edge IDs are JSON-encoded sorted endpoint pairs from the current mesh. The same validation and atomic rollback apply to UI and MCP operations.

References: [Blender Select Loops](https://docs.blender.org/manual/en/5.2/modeling/meshes/selecting/loops.html), [Blender Edge Slide](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/edge_slide.html).


## Region extrusion and selection gizmos

Select faces (Shift-click to add), then press **E** or **Extrude**. The entire selected cap moves along its area-weighted average normal; **X/Y/Z** overrides the direction. Enter/click commits and Escape/right-click cancels all preview geometry. Side quads are created only on region boundaries, shared cap vertices stay shared, cap face IDs stay selected, and unused original interior vertices are removed. Holes and separate boundary loops are retained. Pinched boundaries are rejected. A selection with cancelling normals requires an explicit axis; this is region extrusion, not individual-face extrusion or per-vertex normal offset. Inset also supports regions, as described below.

MCP operation: `{"type":"extrude-region","faceIds":["f1","f5"],"distance":0.5}` with optional `direction:[0,1,0]`. One operation increments the revision once and uses the same validation as the viewport. General surface self-intersection detection is not implemented.

**Move** is active by default, so selecting a vertex, edge or face displays its transform handles. The top viewport toolbar exposes **Move / Rotate / Scale**, with the gizmo centered on the selected vertices' median. Gizmo edits affect only selected vertices and commit as one undo step. Select-only mode in the tool shelf hides handles explicitly.


## Region inset and axis exclusion

Select faces and press **I**, or use **Inset region** in the inspector. Pointer movement or numeric input sets border thickness in meters. The shared inner faces remain connected; border quads are added only along the selection boundary. Interior vertices remain in place; boundary vertices get shared offset copies. Face IDs remain selected for repeated inset/extrusion. Supports planar faces, compatible folded face patches (including cube corners), holes, and disconnected patches. Open mesh boundaries are included. Incompatible offsets, pinched boundaries, bent quads, closed regions without a boundary, and widths producing invalid faces are rejected atomically. This does not implement Blender's Depth, Individual, Outset, relative offset, edge-rail or UV interpolation options, nor automatic collision resolution between distant borders.

MCP `aurora_model_operations_apply` accepts `{"type":"inset-region","faceIds":["f1","f5"],"thickness":0.1}`. The older single-face `inset` operation with a fraction remains available for compatibility.

In Modeling Object/Edit modes: **G, Shift+Y** moves on XZ; **G, Z** moves only on Z (equivalent to excluding X and Y). **S, Shift+Y** scales X and Z while preserving Y. Shift+X excludes X; Shift+Z excludes Z. Pressing the same constraint again clears it; selecting a different constraint replaces it. These constraints use world axes. Typed plane translation applies the value to both allowed coordinates; typed plane scaling applies the factor to both allowed axes. Rotation uses a single rotation axis, including when Shift is held. Inset thickness and edge slide have their own constraints and ignore axis keys. Undo/cancel restore all affected vertices.

References: [Blender Inset Faces](https://docs.blender.org/manual/en/5.2/modeling/meshes/editing/face/inset_faces.html), [Blender axis and plane locking](https://docs.blender.org/manual/en/5.2/scene_layout/object/editing/transform/control/axis_locking.html).

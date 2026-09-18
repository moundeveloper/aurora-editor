# 3D paths and camera path constraints

## Path entity

A path is a first-class 3D scene entity stored in `Aurora3DScene.paths`. It owns an animatable
`Transform3D` like any other entity, so it can be moved, rotated, scaled, keyframed, and persisted
independently of the geometry that follows it.

Each path is a list of `Aurora3DPathPoint` anchors with an incoming and an outgoing Bézier handle,
expressed in the local space of the path. A `smooth` point mirrors its handles when either one is
dragged; a `corner` point collapses both handles onto the anchor, which yields the straight
segments used for Blender-style polyline paths. `closed` turns the point list into a loop.

Curve evaluation lives in `src/engine/scene3d/pathEvaluation.ts` and builds a `THREE.CurvePath` of
cubic Bézier segments. `evaluate3DPath` returns the world-space position and tangent at a
normalized progress value, after applying the path transform evaluated at the current time.

Editing rules live in `src/engine/scene3d/pathEditing.ts`. Inserting a point splits the segment with
de Casteljau at `t = 0.5`, so adding a vertex never changes the shape of the curve.

## Camera constraint

A camera can declare an `AuroraCameraPathConstraint`. When present, `ThreeSceneRuntime` overrides the
camera's own position and orientation on every update:

- `progress` (animatable, 0–1) selects the point on the curve.
- `orientation: 'tangent'` aims the camera down the direction of travel.
- `orientation: 'look-at'` keeps the camera locked on `lookAtEntityId` — any object, light, or other
  camera in the scene — while it still travels along the curve.
- `bank` (animatable, degrees) rolls the camera around its own view axis after aiming.
- `offset` (animatable X/Y/Z, default 0) displaces the camera from the curve in the travel frame:
  X is right of the direction of travel, Y is up, Z pulls back along the tangent. It is applied
  *before* aiming, so a look-at target stays dead centre however far the camera is pushed off the
  curve, and it rides along with the camera instead of being fixed in world space.

Because the constraint is evaluated rather than baked, no rotation keyframes are produced; only
`progress` and `bank` are keyframeable channels, and they appear in the 3D timeline whenever a
constrained camera is selected.

## Editing in the viewport

Path geometry is an editor-only helper: it is built in `ThreeDWorkspace.vue`, tagged with
`userData.editorOnly`, and therefore excluded from the camera preview and from renders. Anchors and
handles are pickable meshes; selecting one attaches the transform gizmo to it in translate mode.
While a drag is in flight the curve previews the edit from the gizmo position, applying the same
`movePathPoint` / `movePathHandle` rules that are committed on release.

Two things make those controls actually clickable, both of which had to be solved explicitly:

- **Depth.** Path controls render with `depthTest: false`, so they are always drawn on top. A single
  depth-sorted raycast would still hand the click to whatever solid geometry the ray crosses first,
  so path controls get their own hit pass that runs before the scene pass. Handles beat anchors,
  anchors beat the curve, and the curve selects the path entity without selecting a point.
- **The gizmo.** `TransformControls` covers a wide area around the entity origin with invisible
  pickers and claims the pointer before the press can reach the canvas handler. Pressing a control
  therefore bypasses it entirely: the press selects the control and immediately starts moving it on
  a plane facing the camera, with the gizmo and the orbit controls standing down until release.
  Grabbing a gizmo *axis* still works, because the arrows sit away from the control itself.

## Keyframe controls

`components/common/KeyframeControl.vue` is the single affordance for every animatable numeric
channel in both the Motion and 3D inspectors. It has two variants:

- `full` — previous / diamond / next, used in row-based property lists (2D transform, PBR material,
  field of view, light intensity, path progress and bank).
- `inline` — diamond only, used inside the compact axis fields of the 3D transform grid, where
  there is no room for the navigation chevrons.

Properties that are not backed by an `AnimatableProperty` no longer display a keyframe affordance.

## Persistence

`paths` is backfilled to an empty array for projects saved before this feature, and camera
constraints that reference a deleted path — or a missing `bank` channel — are repaired on load.
Project version is now `4`.

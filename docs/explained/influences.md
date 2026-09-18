# Influences

Influences are Aurora's take on Blender's modifier stack: an ordered list of non-destructive geometry
operations evaluated on top of an object's primitive. The object's own geometry is never edited, so
removing an influence always restores exactly what was there before.

## Model

Each `Aurora3DObject` owns `influences: AuroraInfluence[]`. An influence is a type, a name, an enabled
flag, and a record of `AnimatableProperty<number>` parameters — which means every parameter is
keyframeable through the same control used everywhere else in the inspector, and every parameter
appears as its own channel in the 3D timeline.

`src/engine/scene3d/influences.ts` holds the registry. `INFLUENCE_DEFINITIONS` describes each type's
parameters (label, default, range, step) and drives both the inspector UI and the timeline rows, so
adding a new influence type means adding one registry entry and one apply function.

## Types

| Type | What it does | Parameters |
|---|---|---|
| Array | Repeats the geometry along a relative offset | count, offset X/Y/Z, rotation step, scale step |
| Mirror | Mirrors across the object origin, fixing the flipped winding | mirror X, mirror Y, mirror Z |
| Subdivide | Splits every triangle into four | level (0–3) |
| Displace | Pushes vertices along their normals with value noise | amount, noise scale, seed |
| Twist | Rotates vertices around Y in proportion to their height | angle, height |

The noise is a deterministic hash-based value noise, so the same parameters always give the same
geometry — no hidden random state, and the result is reproducible across reloads and exports.

## Evaluation

`applyInfluences(geometry, influences, time)` runs the enabled entries in stack order, each one
consuming the previous result. Order matters: an Array followed by a Mirror is not the same shape as
a Mirror followed by an Array, which is why the inspector lets you move entries up and down.

Rebuilding geometry every frame would be wasteful, so `ThreeSceneRuntime` keeps the untouched
primitive on the mesh as `userData.baseGeometry` and only re-evaluates when `influenceSignature`
changes — that signature is built from the *evaluated* parameter values at the current time, so an
animated parameter rebuilds exactly on the frames where it actually moves.

A `MAX_VERTICES` ceiling stops an animated array count or subdivision level from locking the viewport
up; growth beyond it is skipped rather than attempted.

## Persistence

`influences` is backfilled to an empty array for objects saved before the feature existed, and
entries missing a type or parameter record are dropped on load.

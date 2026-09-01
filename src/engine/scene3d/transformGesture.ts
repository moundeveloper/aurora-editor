/**
 * The modal transform gesture, modelled the way Blender's operators behave.
 *
 * Pressing G, R, or S starts a gesture that follows the pointer until it is confirmed or cancelled.
 * While it runs, typing an axis constrains it, typing digits replaces the pointer with an exact
 * value, and holding the snap modifier quantises the result.
 *
 * All of it is pure: the caller supplies the camera basis and the pointer travel, and gets a delta
 * back. That keeps the interaction testable without a viewport, which matters because this is the
 * part users notice immediately when it is subtly wrong.
 */

export type GestureMode = 'translate' | 'rotate' | 'scale'
export type AxisKey = 'x' | 'y' | 'z'

/** Free follows the pointer, an axis pins to one direction, a plane pins to the other two. */
export type GestureConstraint =
  | { kind: 'free' }
  | { kind: 'axis'; axis: AxisKey }
  | { kind: 'plane'; normal: AxisKey }

export interface GestureState {
  mode: GestureMode
  constraint: GestureConstraint
  /** Digits typed so far, including a leading minus and one decimal point. */
  numeric: string
  snap: boolean
  /** Pointer travel in CSS pixels since the gesture began. */
  screen: { x: number; y: number }
}

/** Screen basis for the gesture, in world space, plus how many world units a pixel covers. */
export interface GestureBasis {
  right: readonly [number, number, number]
  up: readonly [number, number, number]
  unitsPerPixel: number
}

export interface GestureDelta {
  translate: [number, number, number]
  /** Euler degrees. */
  rotate: [number, number, number]
  /** Multipliers, so an untouched axis stays at 1. */
  scale: [number, number, number]
}

export interface GestureKeyResult {
  state: GestureState
  handled: boolean
  outcome?: 'confirm' | 'cancel'
}

const AXES: readonly AxisKey[] = ['x', 'y', 'z']

/** Snap increments per mode: a quarter unit, fifteen degrees, and a tenth of a multiplier. */
const SNAP_STEP = { translate: .25, rotate: 15, scale: .1 } as const

/** Pointer sensitivity per mode. Translation is handled by the basis, so it needs no factor. */
const SENSITIVITY = { rotate: .5, scale: .01 } as const

export function beginGesture(mode: GestureMode, snap = false): GestureState {
  return { mode, constraint: { kind: 'free' }, numeric: '', snap, screen: { x: 0, y: 0 } }
}

export function gestureIsNumeric(state: GestureState) {
  return state.numeric !== '' && state.numeric !== '-' && state.numeric !== '.' && state.numeric !== '-.'
}

function numericValue(state: GestureState) {
  const parsed = Number.parseFloat(state.numeric)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Folds a keystroke into the gesture.
 *
 * An axis key sets that axis; the same key again clears back to free, which is how a mistyped
 * constraint is undone without leaving the gesture. Holding shift with an axis pins the other two
 * instead, so `shift+Z` slides across the ground plane.
 */
export function applyGestureKey(state: GestureState, key: string, shift = false): GestureKeyResult {
  const lower = key.toLowerCase()
  if (lower === 'escape') return { state, handled: true, outcome: 'cancel' }
  if (lower === 'enter' || lower === 'numpadenter') return { state, handled: true, outcome: 'confirm' }

  if ((AXES as readonly string[]).includes(lower)) {
    const axis = lower as AxisKey
    const wanted: GestureConstraint = shift ? { kind: 'plane', normal: axis } : { kind: 'axis', axis }
    const same = state.constraint.kind === wanted.kind
      && (state.constraint.kind === 'axis' ? state.constraint.axis === axis : true)
      && (state.constraint.kind === 'plane' ? state.constraint.normal === axis : true)
    return { state: { ...state, constraint: same ? { kind: 'free' } : wanted }, handled: true }
  }

  if (lower === 'backspace') {
    return { state: { ...state, numeric: state.numeric.slice(0, -1) }, handled: true }
  }
  if (lower === '-') {
    const numeric = state.numeric.startsWith('-') ? state.numeric.slice(1) : `-${state.numeric}`
    return { state: { ...state, numeric }, handled: true }
  }
  if (lower === '.' && !state.numeric.includes('.')) {
    return { state: { ...state, numeric: `${state.numeric}.` }, handled: true }
  }
  if (/^[0-9]$/.test(lower)) {
    return { state: { ...state, numeric: `${state.numeric}${lower}` }, handled: true }
  }
  return { state, handled: false }
}

function snapped(value: number, mode: GestureMode, snap: boolean) {
  if (!snap) return value
  const step = SNAP_STEP[mode]
  return Math.round(value / step) * step
}

/** Which axes a constraint lets through. */
function axisMask(constraint: GestureConstraint): [boolean, boolean, boolean] {
  if (constraint.kind === 'axis') return AXES.map((axis) => axis === constraint.axis) as [boolean, boolean, boolean]
  if (constraint.kind === 'plane') return AXES.map((axis) => axis !== constraint.normal) as [boolean, boolean, boolean]
  return [true, true, true]
}

/**
 * The transform the gesture currently describes.
 *
 * Pointer travel is projected onto the camera's screen basis for translation, so dragging right
 * moves right whatever direction the view faces. Rotation and scale read the horizontal travel
 * alone, which is what makes them predictable to nudge.
 */
export function gestureDelta(state: GestureState, basis: GestureBasis): GestureDelta {
  const mask = axisMask(state.constraint)
  const delta: GestureDelta = { translate: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] }
  const typed = gestureIsNumeric(state)

  if (state.mode === 'translate') {
    if (typed) {
      // A typed distance is meaningless without a direction, so it needs an axis.
      if (state.constraint.kind === 'axis') {
        const index = AXES.indexOf(state.constraint.axis)
        delta.translate[index] = numericValue(state)
      }
      return delta
    }
    const world = AXES.map((_, index) => (
      basis.right[index]! * state.screen.x - basis.up[index]! * state.screen.y
    ) * basis.unitsPerPixel)
    delta.translate = world.map((value, index) => mask[index] ? snapped(value, 'translate', state.snap) : 0) as [number, number, number]
    return delta
  }

  if (state.mode === 'rotate') {
    const amount = typed
      ? numericValue(state)
      : snapped(state.screen.x * SENSITIVITY.rotate, 'rotate', state.snap)
    // With no axis chosen, rotation runs about the world up axis: the turntable a viewport implies.
    const target = state.constraint.kind === 'axis' ? AXES.indexOf(state.constraint.axis) : 1
    delta.rotate[target] = amount
    return delta
  }

  const factor = typed
    ? numericValue(state)
    : snapped(1 + state.screen.x * SENSITIVITY.scale, 'scale', state.snap)
  // A scale of zero collapses geometry irrecoverably, so the gesture floors it.
  const safe = Math.abs(factor) < .001 ? .001 : factor
  delta.scale = mask.map((allowed) => allowed ? safe : 1) as [number, number, number]
  return delta
}

/** The line a viewport shows while a gesture runs, so the pending value is never invisible. */
export function gestureLabel(state: GestureState, basis: GestureBasis) {
  const delta = gestureDelta(state, basis)
  const constraint = state.constraint.kind === 'axis'
    ? state.constraint.axis.toUpperCase()
    : state.constraint.kind === 'plane'
      ? AXES.filter((axis) => axis !== (state.constraint as { normal: AxisKey }).normal).join('').toUpperCase()
      : 'view'
  const numeric = gestureIsNumeric(state) ? ` typed ${state.numeric}` : state.numeric ? ` ${state.numeric}` : ''
  const snap = state.snap ? ' · snap' : ''
  if (state.mode === 'translate') {
    return `Move ${constraint}${numeric}${snap} · ${delta.translate.map((value) => value.toFixed(2)).join(', ')}`
  }
  if (state.mode === 'rotate') {
    const amount = delta.rotate.find((value) => value !== 0) ?? 0
    return `Rotate ${constraint}${numeric}${snap} · ${amount.toFixed(1)}°`
  }
  return `Scale ${constraint}${numeric}${snap} · ${delta.scale.map((value) => value.toFixed(3)).join(', ')}`
}

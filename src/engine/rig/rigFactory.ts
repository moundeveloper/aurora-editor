import type { AnimatableProperty, AuroraRig, AuroraRigBone } from '@/models/editor'

const property = (id: string, value: number): AnimatableProperty<number> => ({ id, value, animated: false, keyframes: [] })

export const DEFAULT_RIG_COLUMNS = 12
export const DEFAULT_RIG_ROWS = 12

export function createRig(name: string): AuroraRig {
  return { id: crypto.randomUUID(), name, columns: DEFAULT_RIG_COLUMNS, rows: DEFAULT_RIG_ROWS, bones: [] }
}

export interface RigBoneSeed {
  name?: string
  parentId?: string
  x?: number
  y?: number
  angle?: number
  length?: number
  falloff?: number
}

/** A seed arrives from pointer arithmetic, so anything that is not a real number falls back. */
const finite = (value: number | undefined, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/**
 * A fresh bone rests where it is dropped and poses to nothing, so attaching a rig never moves the
 * image on its own — the first visible change is always something the user asked for.
 */
export function createRigBone(index: number, seed: RigBoneSeed = {}): AuroraRigBone {
  const id = crypto.randomUUID()
  const length = Math.max(0, finite(seed.length, .5))
  return {
    id,
    name: seed.name ?? `Bone ${index}`,
    ...(seed.parentId ? { parentId: seed.parentId } : {}),
    x: finite(seed.x, 0),
    y: finite(seed.y, 0),
    angle: finite(seed.angle, 90),
    length,
    // Reaching a little past the bone itself is what makes a two-bone limb bend instead of shear.
    falloff: Math.max(0, finite(seed.falloff, Math.max(.25, length * 1.6))),
    rotation: property(`${id}-rotation`, 0),
    offsetX: property(`${id}-offset-x`, 0),
    offsetY: property(`${id}-offset-y`, 0),
    stretch: property(`${id}-stretch`, 1),
  }
}

/** Pose channels in the order the inspector, timeline and curve editor all list them. */
export function rigBoneChannels(bone: AuroraRigBone) {
  return [
    { key: 'rotation' as const, label: 'Rotation', suffix: '°', step: 1, property: bone.rotation },
    { key: 'offsetX' as const, label: 'Offset X', suffix: '', step: .01, property: bone.offsetX },
    { key: 'offsetY' as const, label: 'Offset Y', suffix: '', step: .01, property: bone.offsetY },
    { key: 'stretch' as const, label: 'Stretch', suffix: '×', step: .05, property: bone.stretch },
  ]
}

export type RigBoneChannelKey = ReturnType<typeof rigBoneChannels>[number]['key']

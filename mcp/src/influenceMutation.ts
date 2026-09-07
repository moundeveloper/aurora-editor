import { randomUUID } from 'node:crypto'
import type { AuroraInfluence, AuroraInfluenceType, SerializedEditorState } from '../../src/models/editor.ts'

export const MCP_INFLUENCE_TYPES = ['array', 'radial-array', 'mirror', 'subdivide', 'displace', 'twist', 'solidify', 'screw', 'bevel', 'boolean'] as const satisfies readonly AuroraInfluenceType[]

const DEFAULTS: Record<AuroraInfluenceType, Record<string, number>> = {
  bevel:{width:.1},boolean:{operation:0},
  solidify: {thickness:.1}, screw: {angle:360,pitch:0,steps:32},
  array: { count: 3, offsetX: 2.4, offsetY: 0, offsetZ: 0, rotationStep: 0, scaleStep: 1 },
  'radial-array': { count: 6, centerX: 0, centerY: 0, centerZ: 2.5, axis: 1, angle: 360, orient: 1 },
  mirror: { axisX: 1, axisY: 0, axisZ: 0 },
  subdivide: { level: 1 },
  displace: { amount: .18, scale: 2.2, seed: 0 },
  twist: { angle: 45, height: 2 },
}

const LABELS: Record<AuroraInfluenceType, string> = {
  bevel:'Bevel',boolean:'Boolean',
  solidify:'Solidify',screw:'Screw',
  array: 'Array', 'radial-array': 'Radial Array', mirror: 'Mirror', subdivide: 'Subdivide', displace: 'Displace', twist: 'Twist',
}

export interface InfluenceMutation {
  projectId: string
  sceneId: string
  objectId: string
  type: AuroraInfluenceType
  influenceId?: string
  name?: string
  enabled?: boolean
  targetId?: string
  parameters?: Record<string, number>
}

/** Applies the same editable influence shape the UI writes, without bypassing project validation. */
export function upsertProjectInfluence(snapshot: SerializedEditorState, mutation: InfluenceMutation) {
  const scene = snapshot.scenes3D.find((item) => item.id === mutation.sceneId)
  if (!scene) throw new Error(`Unknown 3D scene: ${mutation.sceneId}`)
  const object = scene.objects.find((item) => item.id === mutation.objectId)
  if (!object) throw new Error(`Unknown 3D object: ${mutation.objectId}`)
  object.influences ??= []
  const existing = mutation.influenceId ? object.influences.find((item) => item.id === mutation.influenceId) : undefined
  const targetId = mutation.type === 'boolean' ? mutation.targetId ?? (existing?.type === 'boolean' ? existing.targetId : undefined) : undefined
  if (targetId && (targetId === object.id || !scene.objects.some(item => item.id === targetId && item.type === 'mesh'))) {
    throw new Error('Boolean target must be another mesh in the same scene')
  }
  const influenceId = existing?.id ?? mutation.influenceId ?? randomUUID()
  const values = { ...DEFAULTS[mutation.type], ...(mutation.parameters ?? {}) }
  const parameters = Object.fromEntries(Object.entries(values).map(([key, value]) => {
    if (!Number.isFinite(value)) throw new Error(`Influence parameter ${key} must be finite`)
    const previous = existing?.type === mutation.type ? existing.parameters[key] : undefined
    return [key, previous ? { ...previous, value } : { id: `${influenceId}-${key}`, value, animated: false, keyframes: [] }]
  }))
  const influence: AuroraInfluence = {
    id: influenceId,
    type: mutation.type,
    name: mutation.name?.trim() || existing?.name || LABELS[mutation.type],
    enabled: mutation.enabled ?? existing?.enabled ?? true,
    parameters,
    ...(targetId ? { targetId } : {}),
  }
  if (existing) object.influences.splice(object.influences.indexOf(existing), 1, influence)
  else object.influences.push(influence)
  scene.revision += 1
  snapshot.project.updatedAt = Date.now()
  return { scene, object, influence }
}

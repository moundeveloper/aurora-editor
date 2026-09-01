import { randomUUID } from 'node:crypto'
import type {
  AnimatableProperty, Aurora3DObject, Aurora3DScene, AuroraCamera, AuroraLight, SerializedEditorState,
} from '../../src/models/editor.ts'

export const MCP_LIGHT_TYPES = ['ambient', 'directional', 'point', 'spot'] as const satisfies readonly AuroraLight['type'][]

/** A value, a keyframed curve, or both. Omitting everything leaves an existing channel untouched. */
export interface AnimatableInput {
  value?: number
  keyframes?: Array<{ time: number; value: number }>
}

/** A fixed triple, or a per-axis curve for anything that has to travel. */
export type Vector3Input = [number, number, number] | { x?: AnimatableInput; y?: AnimatableInput; z?: AnimatableInput }

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

/**
 * Writes an animatable channel the way the editor does, so a curve authored here is editable by hand
 * afterwards. Keyframes are sorted and given stable ids; an empty list clears the animation.
 */
function writeProperty(id: string, input: AnimatableInput | undefined, existing?: AnimatableProperty<number>, fallback = 0): AnimatableProperty<number> {
  const property: AnimatableProperty<number> = existing ?? { id, value: fallback, animated: false, keyframes: [] }
  if (!input) return property
  if (input.value !== undefined) property.value = finite(input.value, `${id} value`)
  if (!input.keyframes) return property
  const sorted = [...input.keyframes].sort((left, right) => left.time - right.time)
  property.keyframes = sorted.map((keyframe, index) => ({
    id: `${property.id}-key-${index}`,
    time: Math.max(0, finite(keyframe.time, `${id} keyframe time`)),
    value: finite(keyframe.value, `${id} keyframe value`),
    interpolation: 'bezier' as const,
  }))
  property.animated = property.keyframes.length > 1
  if (property.keyframes.length) property.value = property.keyframes[0]!.value
  return property
}

function requireScene(snapshot: SerializedEditorState, sceneId: string): Aurora3DScene {
  const scene = snapshot.scenes3D.find((item) => item.id === sceneId)
  if (!scene) throw new Error(`Unknown 3D scene: ${sceneId}`)
  return scene
}

function commit(snapshot: SerializedEditorState, scene: Aurora3DScene) {
  scene.revision += 1
  snapshot.project.updatedAt = Date.now()
}

export interface CameraLensMutation {
  projectId: string
  sceneId: string
  cameraId: string
  depthOfField?: boolean
  focusDistance?: AnimatableInput
  fStop?: AnimatableInput
}

/**
 * Switches a camera's lens blur on and sets its focus and f-number.
 *
 * Both channels accept keyframes, which is what makes a focus pull authorable from here: hold focus
 * on a foreground subject, then rack it back as the shot travels.
 */
export function setProjectCameraLens(snapshot: SerializedEditorState, mutation: CameraLensMutation) {
  const scene = requireScene(snapshot, mutation.sceneId)
  const camera: AuroraCamera | undefined = scene.cameras.find((item) => item.id === mutation.cameraId)
  if (!camera) throw new Error(`Unknown camera: ${mutation.cameraId}`)
  if (camera.projection !== 'perspective' && mutation.depthOfField) {
    throw new Error(`Camera ${camera.id} is orthographic, which has no lens to defocus`)
  }
  if (mutation.depthOfField !== undefined) camera.depthOfField = mutation.depthOfField
  camera.focusDistance = writeProperty(`${camera.id}-focus-distance`, mutation.focusDistance, camera.focusDistance, 8)
  camera.fStop = writeProperty(`${camera.id}-f-stop`, mutation.fStop, camera.fStop, 2.8)
  commit(snapshot, scene)
  return { scene, camera }
}

export interface LightMutation {
  projectId: string
  sceneId: string
  lightId?: string
  type: AuroraLight['type']
  name?: string
  color?: string
  visible?: boolean
  castShadow?: boolean
  intensity?: AnimatableInput
  position?: Vector3Input
  /** Euler degrees. Local -Z is the beam, so this is what aims a directional or spot light. */
  rotation?: Vector3Input
  /** Spot only: cone half-angle in degrees. */
  angle?: AnimatableInput
  /** Spot only: range in scene units. Zero lights to infinity; any other value hard-stops the beam. */
  distance?: AnimatableInput
  /** Spot only: softness of the cone edge, 0 to 1. */
  penumbra?: AnimatableInput
}

const LIGHT_INTENSITY_DEFAULTS: Record<AuroraLight['type'], number> = {
  ambient: 1.5, directional: 1.5, point: 18, spot: 80,
}

function vectorProperties(id: string, values: Vector3Input | undefined, existing: AuroraLight['transform']['position'] | undefined, fallback: [number, number, number]) {
  const axes = ['x', 'y', 'z'] as const
  return Object.fromEntries(axes.map((axis, index) => {
    const existingAxis = existing?.[axis]
    const input = Array.isArray(values) ? { value: values[index] } : values?.[axis]
    return [axis, writeProperty(`${id}-${axis}`, input, existingAxis, fallback[index]!)]
  })) as unknown as AuroraLight['transform']['position']
}

/** Adds or updates a light, including a spot's cone. Absent fields keep whatever the light already had. */
export function upsertProjectLight(snapshot: SerializedEditorState, mutation: LightMutation) {
  const scene = requireScene(snapshot, mutation.sceneId)
  const existing = mutation.lightId ? scene.lights.find((item) => item.id === mutation.lightId) : undefined
  const id = existing?.id ?? mutation.lightId ?? randomUUID()
  const type = mutation.type
  const light: AuroraLight = {
    id,
    name: mutation.name?.trim() || existing?.name || `${type[0]!.toUpperCase()}${type.slice(1)} Light`,
    type,
    color: mutation.color ?? existing?.color ?? (type === 'ambient' ? '#c5ccff' : '#ffffff'),
    visible: mutation.visible ?? existing?.visible ?? true,
    castShadow: mutation.castShadow ?? existing?.castShadow ?? type !== 'ambient',
    intensity: writeProperty(`${id}-intensity`, mutation.intensity, existing?.intensity, LIGHT_INTENSITY_DEFAULTS[type]),
    transform: {
      position: vectorProperties(`${id}-position`, mutation.position, existing?.transform.position, [0, 4, 0]),
      rotation: vectorProperties(`${id}-rotation`, mutation.rotation, existing?.transform.rotation, [0, 0, 0]),
      scale: vectorProperties(`${id}-scale`, undefined, existing?.transform.scale, [1, 1, 1]),
    },
  }
  if (type === 'spot') {
    light.angle = writeProperty(`${id}-angle`, mutation.angle, existing?.angle, 32)
    // Zero is unbounded. A finite range shorter than the throw kills the light outright, however
    // bright it is, so it stays opt-in rather than a default.
    light.distance = writeProperty(`${id}-distance`, mutation.distance, existing?.distance, 0)
    light.penumbra = writeProperty(`${id}-penumbra`, mutation.penumbra, existing?.penumbra, .25)
  }
  if (existing) scene.lights.splice(scene.lights.indexOf(existing), 1, light)
  else scene.lights.push(light)
  commit(snapshot, scene)
  return { scene, light }
}

export interface EnvironmentMutation {
  projectId: string
  sceneId: string
  /** Id of an imported hdr asset, or null to drop back to the flat background colour. */
  assetId: string | null
  background?: boolean
  intensity?: number
}

/** Points a scene at a radiance map, which lights every material and can also become the backdrop. */
export function setProjectEnvironment(snapshot: SerializedEditorState, mutation: EnvironmentMutation) {
  const scene = requireScene(snapshot, mutation.sceneId)
  if (mutation.assetId) {
    const asset = snapshot.assets.find((item) => item.id === mutation.assetId)
    if (!asset) throw new Error(`Unknown asset: ${mutation.assetId}`)
    if (asset.kind !== 'hdr') throw new Error(`Asset ${asset.name} is ${asset.kind}, not an hdr radiance map`)
    scene.environmentAssetId = asset.id
    scene.environmentBackground = mutation.background ?? scene.environmentBackground ?? false
  } else {
    delete scene.environmentAssetId
    scene.environmentBackground = false
  }
  if (mutation.intensity !== undefined) scene.environmentIntensity = Math.max(0, finite(mutation.intensity, 'intensity'))
  commit(snapshot, scene)
  return { scene }
}

export interface ModelMutation {
  projectId: string
  sceneId: string
  assetId: string
  objectId?: string
  name?: string
  parentId?: string
  position?: Vector3Input
  rotation?: Vector3Input
  scale?: Vector3Input
  castShadow?: boolean
  receiveShadow?: boolean
}

/**
 * Places an imported mesh in a scene.
 *
 * The file keeps its own materials and node hierarchy, so the PBR material below is inert for this
 * object; it exists only so old project readers and shared animation tooling see a complete record.
 */
export function addProjectModel(snapshot: SerializedEditorState, mutation: ModelMutation) {
  const scene = requireScene(snapshot, mutation.sceneId)
  const asset = snapshot.assets.find((item) => item.id === mutation.assetId)
  if (!asset) throw new Error(`Unknown asset: ${mutation.assetId}`)
  if (asset.kind !== 'model3d') throw new Error(`Asset ${asset.name} is ${asset.kind}, not a glTF mesh`)
  if (mutation.parentId) {
    const parent = scene.objects.find((item) => item.id === mutation.parentId)
    if (!parent || parent.type !== 'group') throw new Error(`Parent ${mutation.parentId} is not a group in this scene`)
  }
  const id = mutation.objectId ?? randomUUID()
  const numeric = (suffix: string, value: number) => ({ id: `${id}-${suffix}`, value, animated: false, keyframes: [] })
  const object: Aurora3DObject = {
    id,
    name: mutation.name?.trim() || asset.name.replace(/\.[^.]+$/, ''),
    type: 'mesh',
    primitive: 'model',
    assetId: asset.id,
    ...(mutation.parentId ? { parentId: mutation.parentId } : {}),
    visible: true,
    locked: false,
    castShadow: mutation.castShadow ?? true,
    receiveShadow: mutation.receiveShadow ?? true,
    transform: {
      position: vectorProperties(`${id}-position`, mutation.position, undefined, [0, 0, 0]),
      rotation: vectorProperties(`${id}-rotation`, mutation.rotation, undefined, [0, 0, 0]),
      scale: vectorProperties(`${id}-scale`, mutation.scale, undefined, [1, 1, 1]),
    },
    material: {
      baseColor: '#8c94a8',
      emissive: '#000000',
      metalness: numeric('metalness', .1),
      roughness: numeric('roughness', .6),
      opacity: numeric('opacity', 1),
      emissiveIntensity: numeric('emissive-intensity', 0),
    },
    influences: [],
  }
  scene.objects.push(object)
  commit(snapshot, scene)
  return { scene, object }
}

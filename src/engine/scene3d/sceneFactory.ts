import type {
  AnimatableProperty, AnimatableVector3, Aurora3DObject, Aurora3DPath, Aurora3DScene, AuroraCamera,
  Aurora3DPrimitive, AuroraCameraObjectConstraint, AuroraCameraPathConstraint, AuroraLight, AuroraPBRMaterial, Transform3D,
} from '@/models/editor'

export function numericProperty(id: string, value: number): AnimatableProperty<number> {
  return { id, value, animated: false, keyframes: [] }
}

export function makeTransform3D(prefix: string, position: [number, number, number] = [0, 0, 0]): Transform3D {
  return {
    position: {
      x: numericProperty(`${prefix}-position-x`, position[0]),
      y: numericProperty(`${prefix}-position-y`, position[1]),
      z: numericProperty(`${prefix}-position-z`, position[2]),
    },
    rotation: {
      x: numericProperty(`${prefix}-rotation-x`, 0),
      y: numericProperty(`${prefix}-rotation-y`, 0),
      z: numericProperty(`${prefix}-rotation-z`, 0),
    },
    scale: {
      x: numericProperty(`${prefix}-scale-x`, 1),
      y: numericProperty(`${prefix}-scale-y`, 1),
      z: numericProperty(`${prefix}-scale-z`, 1),
    },
  }
}

export function makePBRMaterial(prefix: string, baseColor = '#8c9bff'): AuroraPBRMaterial {
  return {
    baseColor,
    opacity: numericProperty(`${prefix}-opacity`, 1),
    metalness: numericProperty(`${prefix}-metalness`, .35),
    roughness: numericProperty(`${prefix}-roughness`, .28),
    emissive: '#111529',
    emissiveIntensity: numericProperty(`${prefix}-emissive-intensity`, .18),
  }
}

export function createDemo3DScene(): Aurora3DScene {
  const cube: Aurora3DObject = {
    id: 'object-aurora-cube',
    name: 'Aurora Cube',
    type: 'mesh',
    primitive: 'box',
    visible: true,
    locked: false,
    castShadow: true,
    receiveShadow: true,
    transform: makeTransform3D('aurora-cube', [0, .35, 0]),
    material: makePBRMaterial('aurora-cube-material'),
    influences: [],
  }
  cube.transform.rotation.y.animated = true
  cube.transform.rotation.y.keyframes = [
    { id: 'cube-rotation-start', time: 0, value: 0, interpolation: 'linear' },
    { id: 'cube-rotation-end', time: 18, value: 360, interpolation: 'linear' },
  ]
  cube.transform.rotation.x.value = 18

  const floor: Aurora3DObject = {
    id: 'object-floor',
    name: 'Ground',
    type: 'mesh',
    primitive: 'plane',
    visible: true,
    locked: true,
    castShadow: false,
    receiveShadow: true,
    transform: makeTransform3D('ground', [0, -1.2, 0]),
    material: makePBRMaterial('ground-material', '#151a2a'),
    influences: [],
  }
  floor.transform.rotation.x.value = -90
  floor.transform.scale.x.value = 8
  floor.transform.scale.y.value = 8
  floor.material.metalness.value = .05
  floor.material.roughness.value = .72

  const camera: AuroraCamera = {
    id: 'camera-main',
    name: 'Camera Main',
    visible: true,
    projection: 'perspective',
    transform: makeTransform3D('camera-main', [0, 2.4, 7]),
    fov: numericProperty('camera-main-fov', 42),
    near: .1,
    far: 1000,
  }
  camera.transform.rotation.x.value = -18.924644416051237

  const ambient: AuroraLight = {
    id: 'light-ambient',
    name: 'Ambient Fill',
    visible: true,
    type: 'ambient',
    color: '#b8c1ff',
    intensity: numericProperty('light-ambient-intensity', .7),
    transform: makeTransform3D('light-ambient'),
    castShadow: false,
  }
  const key: AuroraLight = {
    id: 'light-key',
    name: 'Key Light',
    visible: true,
    type: 'directional',
    color: '#fff0d2',
    intensity: numericProperty('light-key-intensity', 3.2),
    transform: makeTransform3D('light-key', [4, 7, 5]),
    castShadow: true,
  }
  key.transform.rotation.x.value = -54.46232220802562
  key.transform.rotation.y.value = 24.937982703241797
  const rim: AuroraLight = {
    id: 'light-rim',
    name: 'Rim Light',
    visible: true,
    type: 'point',
    color: '#718cff',
    intensity: numericProperty('light-rim-intensity', 28),
    transform: makeTransform3D('light-rim', [-4, 2, -2]),
    castShadow: false,
  }

  return {
    id: 'scene-aurora-3d',
    name: 'Aurora 3D Study',
    objects: [cube, floor],
    cameras: [camera],
    cameraCuts: [{ id: 'camera-cut-main-0', cameraId: camera.id, time: 0 }],
    lights: [ambient, key, rim],
    paths: [],
    activeCameraId: camera.id,
    environmentIntensity: 1,
    settings: {
      shadows: true,
      shadowMapSize: 1024,
      ambientOcclusion: true,
      ambientOcclusionIntensity: 1,
      ambientOcclusionRadius: .35,
      motionBlur: false,
      motionBlurShutter: 180,
      motionBlurSamples: 8,
      quality: 'preview',
      backgroundColor: null,
    },
    revision: 1,
  }
}

export function createEmpty3DScene(name = '3D Scene'): Aurora3DScene {
  const sceneId = crypto.randomUUID()
  const cameraId = crypto.randomUUID()
  const lightId = crypto.randomUUID()
  const camera: AuroraCamera = {
    id: cameraId,
    name: 'Camera 1',
    visible: true,
    projection: 'perspective',
    transform: makeTransform3D(cameraId, [0, 2.4, 7]),
    fov: numericProperty(`${cameraId}-fov`, 42),
    near: .1,
    far: 1000,
  }
  camera.transform.rotation.x.value = -18.924644416051237

  return {
    id: sceneId,
    name,
    objects: [],
    cameras: [camera],
    cameraCuts: [{ id: crypto.randomUUID(), cameraId, time: 0 }],
    lights: [{
      id: lightId,
      name: 'Ambient Fill',
      visible: true,
      type: 'ambient',
      color: '#b8c1ff',
      intensity: numericProperty(`${lightId}-intensity`, .7),
      transform: makeTransform3D(lightId),
      castShadow: false,
    }],
    paths: [],
    activeCameraId: cameraId,
    environmentIntensity: 1,
    settings: {
      shadows: true,
      shadowMapSize: 1024,
      ambientOcclusion: true,
      ambientOcclusionIntensity: 1,
      ambientOcclusionRadius: .35,
      motionBlur: false,
      motionBlurShutter: 180,
      motionBlurSamples: 8,
      quality: 'preview',
      backgroundColor: null,
    },
    revision: 1,
  }
}

/**
 * A 3D Scene layer has to show something the moment it lands on the timeline. The Motion viewport
 * composites scene geometry only — no grid, no gizmos — so a camera-and-fill scene renders an empty
 * frame and reads as a broken layer. Starter geometry plus a key light make the layer visible on
 * creation; the 3D workspace still authors from there.
 */
export function createStarter3DScene(name = '3D Scene'): Aurora3DScene {
  const scene = createEmpty3DScene(name)

  const cube = createPrimitiveObject('box', 1)
  cube.transform.position.y.value = .35
  cube.transform.rotation.x.value = 18

  const ground = createPrimitiveObject('plane', 1)
  ground.name = 'Ground'
  ground.transform.position.y.value = -1.2
  ground.transform.rotation.x.value = -90
  ground.transform.scale.x.value = 8
  ground.transform.scale.y.value = 8
  ground.material.baseColor = '#151a2a'
  ground.material.metalness.value = .05
  ground.material.roughness.value = .72

  const keyId = crypto.randomUUID()
  const keyPosition: [number, number, number] = [4, 7, 5]
  const [keyPitch, keyYaw] = aimRotationDegrees(keyPosition)
  const key: AuroraLight = {
    id: keyId,
    name: 'Key Light',
    visible: true,
    type: 'directional',
    color: '#fff0d2',
    intensity: numericProperty(`${keyId}-intensity`, 3.2),
    transform: makeTransform3D(keyId, keyPosition),
    castShadow: true,
  }
  key.transform.rotation.x.value = keyPitch
  key.transform.rotation.y.value = keyYaw

  scene.objects = [cube, ground]
  scene.lights = [...scene.lights, key]
  return scene
}

export function create3DPath(index: number): Aurora3DPath {
  const id = crypto.randomUUID()
  return {
    id,
    name: `Path ${index}`,
    visible: true,
    color: '#7ee0c0',
    transform: makeTransform3D(id),
    closed: false,
    locked: false,
    points: [
      { id: crypto.randomUUID(), position: [-3, 1, 2], handleIn: [-3, 1, 2], handleOut: [-1.6, 1.8, 1.5], mode: 'smooth' },
      { id: crypto.randomUUID(), position: [0, 2, 0], handleIn: [-1.2, 2.2, .8], handleOut: [1.2, 1.8, -.8], mode: 'smooth' },
      { id: crypto.randomUUID(), position: [3, 1, -2], handleIn: [1.6, 1.4, -1.5], handleOut: [3, 1, -2], mode: 'smooth' },
    ],
  }
}

export function makePathOffset(cameraId: string): AnimatableVector3 {
  return {
    x: numericProperty(`${cameraId}-path-offset-x`, 0),
    y: numericProperty(`${cameraId}-path-offset-y`, 0),
    z: numericProperty(`${cameraId}-path-offset-z`, 0),
  }
}

export function createCameraPathConstraint(cameraId: string, pathId: string): AuroraCameraPathConstraint {
  return {
    pathId,
    progress: numericProperty(`${cameraId}-path-progress`, 0),
    bank: numericProperty(`${cameraId}-path-bank`, 0),
    offset: makePathOffset(cameraId),
    orientation: 'tangent',
  }
}

function makeObjectFollowVector(cameraId: string, group: 'position' | 'rotation', values: [number, number, number]): AnimatableVector3 {
  return {
    x: numericProperty(`${cameraId}-object-${group}-offset-x`, values[0]),
    y: numericProperty(`${cameraId}-object-${group}-offset-y`, values[1]),
    z: numericProperty(`${cameraId}-object-${group}-offset-z`, values[2]),
  }
}

export function createCameraObjectConstraint(cameraId: string, objectId: string): AuroraCameraObjectConstraint {
  return {
    objectId,
    positionOffset: makeObjectFollowVector(cameraId, 'position', [0, 2, 5]),
    rotationOffset: makeObjectFollowVector(cameraId, 'rotation', [0, 0, 0]),
    orientation: 'target',
  }
}

export function createPrimitiveObject(primitive: Aurora3DPrimitive, index: number): Aurora3DObject {
  const id = crypto.randomUUID()
  const label = primitive === 'box' ? 'Cube' : primitive === 'sphere' ? 'Sphere' : primitive === 'model' ? 'Model' : 'Plane'
  return {
    id,
    name: `${label} ${index}`,
    type: 'mesh',
    primitive,
    visible: true,
    locked: false,
    castShadow: primitive !== 'plane',
    receiveShadow: true,
    transform: makeTransform3D(id, [0, 0, 0]),
    material: makePBRMaterial(`${id}-material`, primitive === 'box' ? '#8c9bff' : primitive === 'sphere' ? '#6f9fcb' : '#ffffff'),
    influences: [],
  }
}

/** A transform-only scene node. Children retain their local transforms and inherit this one. */
export function createGroupObject(index: number): Aurora3DObject {
  const id = crypto.randomUUID()
  return {
    id,
    name: `Group ${index}`,
    type: 'group',
    // Groups do not build geometry, but keeping a complete object record makes old project readers
    // and shared animation tooling treat their transform exactly like any other scene object.
    primitive: 'box',
    visible: true,
    locked: false,
    castShadow: false,
    receiveShadow: false,
    transform: makeTransform3D(id),
    material: makePBRMaterial(`${id}-material`, '#8c94a8'),
    influences: [],
  }
}

/**
 * Euler degrees for a transform whose local -Z axis points at `target`.
 *
 * Directional and spot lights are aimed by their transform rotation: the renderer derives the beam
 * from local -Z, so a light authored with a bare identity rotation shines sideways past the scene.
 *
 * The renderer composes rotations in Three's default XYZ order, which makes the beam
 * `(-sin ry, cos ry · sin rx, -cos ry · cos rx)`. Solving that for a unit aim direction with the
 * roll left at zero keeps the inspector readable: a light needs no roll about its own beam.
 */
export function aimRotationDegrees(position: readonly [number, number, number], target: readonly [number, number, number] = [0, 0, 0]) {
  const toTarget = [target[0] - position[0], target[1] - position[1], target[2] - position[2]] as const
  const length = Math.hypot(...toTarget)
  if (length < 1e-4) return [0, 0, 0] as [number, number, number]
  const [x, y, z] = toTarget.map((axis) => axis / length) as [number, number, number]
  // Keeping the pitch within a quarter turn fixes the sign of cos(ry) against the aim's own Z.
  const cosRotationY = (z === 0 ? 1 : -Math.sign(z)) * Math.sqrt(Math.max(0, 1 - x * x))
  const rotationY = Math.atan2(-x, cosRotationY)
  const rotationX = Math.abs(cosRotationY) < 1e-6
    ? 0
    : Math.asin(Math.max(-1, Math.min(1, y / cosRotationY)))
  return [rotationX * 180 / Math.PI, rotationY * 180 / Math.PI, 0] as [number, number, number]
}

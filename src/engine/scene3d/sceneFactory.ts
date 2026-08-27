import type {
  AnimatableProperty, AnimatableVector3, Aurora3DObject, Aurora3DPath, Aurora3DScene, AuroraCamera,
  AuroraCameraPathConstraint, AuroraLight, AuroraPBRMaterial, Transform3D,
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
    type: 'ambient',
    color: '#b8c1ff',
    intensity: numericProperty('light-ambient-intensity', .7),
    transform: makeTransform3D('light-ambient'),
    castShadow: false,
  }
  const key: AuroraLight = {
    id: 'light-key',
    name: 'Key Light',
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
      quality: 'preview',
      backgroundColor: null,
    },
    revision: 1,
  }
}

export function create3DPath(index: number): Aurora3DPath {
  const id = crypto.randomUUID()
  return {
    id,
    name: `Path ${index}`,
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

export function createPrimitiveObject(primitive: 'box' | 'sphere', index: number): Aurora3DObject {
  const id = crypto.randomUUID()
  return {
    id,
    name: `${primitive === 'box' ? 'Cube' : 'Sphere'} ${index}`,
    type: 'mesh',
    primitive,
    visible: true,
    locked: false,
    castShadow: true,
    receiveShadow: true,
    transform: makeTransform3D(id, [0, 0, 0]),
    material: makePBRMaterial(`${id}-material`, primitive === 'box' ? '#8c9bff' : '#6f9fcb'),
    influences: [],
  }
}

import type {
  AnimatableProperty, Aurora3DObject, Aurora3DScene, AuroraCamera, AuroraLight,
  AuroraPBRMaterial, Transform3D,
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
    transform: makeTransform3D('camera-main', [4.8, 3.2, 6.2]),
    fov: numericProperty('camera-main-fov', 42),
    near: .1,
    far: 1000,
  }
  camera.transform.rotation.x.value = -22.4
  camera.transform.rotation.y.value = 37.8

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
    lights: [ambient, key, rim],
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
  }
}

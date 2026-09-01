import { randomUUID } from 'node:crypto'
import type {
  AnimatableProperty,
  Aurora3DObject,
  Aurora3DScene,
  AuroraCamera,
  AuroraInfluence,
  AuroraLight,
  AuroraPBRMaterial,
  EditorLayer,
  EditorNode,
  EditorNodeConnection,
  EditorNodeKind,
  EditorNodeSocket,
  SerializedEditorState,
  Transform3D,
} from '../../src/models/editor.ts'

const DURATION = 12

function key(time: number, value: number, id: string) {
  return { id, time, value, interpolation: 'bezier' as const, easing: { inX: .42, inY: 0, outX: .58, outY: 1 } }
}

function numeric(id: string, value: number, keys: Array<[number, number]> = []): AnimatableProperty<number> {
  return {
    id,
    value,
    animated: keys.length > 0,
    keyframes: keys.map(([time, keyValue], index) => key(time, keyValue, `${id}-key-${index}`)),
  }
}

function transform2D(prefix: string, x: number, y: number, options: {
  scale?: Array<[number, number]>
  rotation?: Array<[number, number]>
  opacity?: Array<[number, number]>
  x?: Array<[number, number]>
  y?: Array<[number, number]>
} = {}) {
  return {
    x: numeric(`${prefix}-x`, x, options.x),
    y: numeric(`${prefix}-y`, y, options.y),
    scaleX: numeric(`${prefix}-scale-x`, 100, options.scale),
    scaleY: numeric(`${prefix}-scale-y`, 100, options.scale),
    rotation: numeric(`${prefix}-rotation`, 0, options.rotation),
    opacity: numeric(`${prefix}-opacity`, 100, options.opacity),
  }
}

function transform3D(prefix: string, position: [number, number, number]): Transform3D {
  return {
    position: {
      x: numeric(`${prefix}-position-x`, position[0]),
      y: numeric(`${prefix}-position-y`, position[1]),
      z: numeric(`${prefix}-position-z`, position[2]),
    },
    rotation: {
      x: numeric(`${prefix}-rotation-x`, 0),
      y: numeric(`${prefix}-rotation-y`, 0),
      z: numeric(`${prefix}-rotation-z`, 0),
    },
    scale: {
      x: numeric(`${prefix}-scale-x`, 1),
      y: numeric(`${prefix}-scale-y`, 1),
      z: numeric(`${prefix}-scale-z`, 1),
    },
  }
}

function material(prefix: string, baseColor: string, emissive: string, intensity = 1): AuroraPBRMaterial {
  return {
    baseColor,
    opacity: numeric(`${prefix}-opacity`, 1),
    metalness: numeric(`${prefix}-metalness`, .62),
    roughness: numeric(`${prefix}-roughness`, .18),
    emissive,
    emissiveIntensity: numeric(`${prefix}-emissive`, intensity, [[0, intensity * .45], [3, intensity * 1.5], [6, intensity * .7], [9, intensity * 1.7], [12, intensity * .45]]),
  }
}

function mesh(id: string, name: string, primitive: 'box' | 'sphere' | 'plane', position: [number, number, number], surface: AuroraPBRMaterial): Aurora3DObject {
  return {
    id, name, type: 'mesh', primitive, visible: true, locked: false,
    castShadow: true, receiveShadow: primitive === 'plane', transform: transform3D(id, position),
    material: surface, influences: [],
  }
}

function radialInfluence(id: string, count: number, radius: number): AuroraInfluence {
  return {
    id,
    type: 'radial-array',
    name: `${count}-fold Orbital Array`,
    enabled: true,
    parameters: {
      count: numeric(`${id}-count`, count),
      centerX: numeric(`${id}-center-x`, radius),
      centerY: numeric(`${id}-center-y`, 0),
      centerZ: numeric(`${id}-center-z`, 0),
      axis: numeric(`${id}-axis`, 2),
      angle: numeric(`${id}-angle`, 360),
      orient: numeric(`${id}-orient`, 1),
    },
  }
}

function layer(id: string, name: string, type: EditorLayer['type'], transform: EditorLayer['transform'], extra: Partial<EditorLayer> = {}): EditorLayer {
  return {
    id, name, type, start: 0, duration: DURATION, color: '#ffffff', visible: true, locked: false,
    muted: false, expanded: false, transform, effects: [], ...extra,
  }
}

function nodeSocket(id: string, label: string, type: 'image' | 'value', value?: number): EditorNodeSocket {
  return { id, label, type, ...(value === undefined ? {} : { value }) }
}

function sourceNode(id: string, title: string, kind: 'image' | 'text' | 'scene3d', sourceId: string, y: number): EditorNode {
  return {
    id, kind, title, sourceId, x: 20, y, muted: false, properties: {}, inputs: [],
    outputs: [nodeSocket(`${id}-out-image-0`, 'Image', 'image')],
  }
}

function effectNode(id: string, kind: EditorNodeKind, title: string, x: number, y: number, values: Array<[string, number]>): EditorNode {
  return {
    id, kind, title, x, y, muted: false, properties: {},
    inputs: [nodeSocket(`${id}-in-image-0`, 'Image', 'image'), ...values.map(([label, value], index) => nodeSocket(`${id}-in-value-${index + 1}`, label, 'value', value))],
    outputs: [nodeSocket(`${id}-out-image-0`, 'Image', 'image')],
  }
}

function createGraph(layers: EditorLayer[]) {
  // Aurora layers are stored top-first, while Stack renders its first socket first (the back).
  const visibleLayers = [...layers.filter((item) => item.type !== 'adjustment')].reverse()
  const sources = visibleLayers.map((item, index) => sourceNode(
    `node-source-${item.id}`,
    item.name,
    item.type === '3d-scene' ? 'scene3d' : item.type === 'text' ? 'text' : 'image',
    item.id,
    30 + index * 105,
  ))
  const flareSource = sources.find((item) => item.sourceId === 'layer-core-flare')!
  const flareGlow = effectNode('node-flare-glow', 'glow', 'Core Flare Bloom', 215, flareSource.y, [['Threshold', 62], ['Radius', 24], ['Intensity', 1.15]])
  const stack: EditorNode = {
    id: 'node-showcase-stack', kind: 'stack', title: 'Neon Layer Stack', x: 430, y: 155,
    muted: false, properties: {},
    inputs: [...sources.map((_, index) => nodeSocket(`node-showcase-stack-in-${index}`, `Input ${index + 1}`, 'image')), nodeSocket('node-showcase-stack-spare', `Input ${sources.length + 1}`, 'image')],
    outputs: [nodeSocket('node-showcase-stack-out', 'Image', 'image')],
  }
  const grade = effectNode('node-master-grade', 'colorMatrix', 'Cyan / Magenta Grade', 625, 155, [['Temperature', -12], ['Contrast', 1.2]])
  const vignette = effectNode('node-master-vignette', 'vignette', 'Cinematic Focus', 820, 155, [['Amount', 28], ['Softness', 78]])
  const output: EditorNode = {
    id: 'node-output', kind: 'output', title: 'Composite', x: 1015, y: 155, muted: false, properties: {},
    inputs: [nodeSocket('node-output-in', 'Image', 'image')], outputs: [],
  }
  const connections: EditorNodeConnection[] = sources.flatMap((source, index) => source === flareSource ? [
    {
      id: 'link-flare-source-glow', fromNodeId: source.id, fromPortId: source.outputs[0]!.id,
      toNodeId: flareGlow.id, toPortId: flareGlow.inputs[0]!.id,
    },
    {
      id: 'link-flare-glow-stack', fromNodeId: flareGlow.id, fromPortId: flareGlow.outputs[0]!.id,
      toNodeId: stack.id, toPortId: stack.inputs[index]!.id,
    },
  ] : [{
    id: `link-${source.id}-stack`, fromNodeId: source.id, fromPortId: source.outputs[0]!.id,
    toNodeId: stack.id, toPortId: stack.inputs[index]!.id,
  }])
  const connect = (from: EditorNode, to: EditorNode, id: string): EditorNodeConnection => ({
    id, fromNodeId: from.id, fromPortId: from.outputs[0]!.id, toNodeId: to.id, toPortId: to.inputs[0]!.id,
  })
  connections.push(
    connect(stack, grade, 'link-stack-grade'),
    connect(grade, vignette, 'link-grade-vignette'),
    connect(vignette, output, 'link-vignette-output'),
  )
  return { nodes: [...sources, flareGlow, stack, grade, vignette, output], nodeConnections: connections }
}

function createScene(): Aurora3DScene {
  const core = mesh('singularity-core', 'Pulsing Singularity', 'sphere', [0, .15, 0], material('core', '#652cff', '#18e6ff', 2.4))
  core.transform.scale.x = numeric('core-scale-x', .85, [[0, .55], [1.5, 1.05], [3, .72], [4.5, 1.18], [6, .78], [7.5, 1.12], [9, .68], [10.5, 1.04], [12, .55]])
  core.transform.scale.y = numeric('core-scale-y', .85, [[0, .55], [1.5, 1.05], [3, .72], [4.5, 1.18], [6, .78], [7.5, 1.12], [9, .68], [10.5, 1.04], [12, .55]])
  core.transform.scale.z = numeric('core-scale-z', .85, [[0, .55], [1.5, 1.05], [3, .72], [4.5, 1.18], [6, .78], [7.5, 1.12], [9, .68], [10.5, 1.04], [12, .55]])
  core.influences.push({
    id: 'core-displace', type: 'displace', name: 'Living Surface', enabled: true,
    parameters: {
      // Animated influence parameters rebuild geometry every frame. A static deformation keeps the
      // organic silhouette while the transform and emissive animation provide the visible pulse.
      amount: numeric('core-displace-amount', .14),
      scale: numeric('core-displace-scale', 3.5), seed: numeric('core-displace-seed', 17),
    },
  })

  const fins = mesh('orbital-fins', 'Twelve Orbit Blades', 'box', [-3.2, .15, 0], material('fins', '#101a3c', '#00eaff', 2.1))
  fins.transform.scale.x.value = .16
  fins.transform.scale.y.value = .82
  fins.transform.scale.z.value = .08
  fins.transform.rotation.z = numeric('fins-rotation-z', 0, [[0, 0], [12, 360]])
  fins.influences.push(radialInfluence('fins-radial', 12, 3.2))
  fins.castShadow = false

  const satellites = mesh('orbital-satellites', 'Satellite Crown', 'sphere', [-4.4, .15, 0], material('satellites', '#ff3ee7', '#ff2bd6', 2.7))
  satellites.transform.scale.x.value = .17
  satellites.transform.scale.y.value = .17
  satellites.transform.scale.z.value = .17
  satellites.transform.rotation.z = numeric('satellites-rotation-z', 0, [[0, 360], [12, 0]])
  satellites.influences.push(radialInfluence('satellites-radial', 18, 4.4))
  satellites.castShadow = false

  const floor = mesh('mirror-floor', 'Obsidian Mirror', 'plane', [0, -2.2, 0], material('floor', '#050716', '#071a35', .2))
  floor.transform.rotation.x.value = -90
  floor.transform.scale.x.value = 12
  floor.transform.scale.y.value = 12
  floor.material.metalness.value = .9
  floor.material.roughness.value = .16
  floor.castShadow = false

  const camera: AuroraCamera = {
    id: 'camera-orbit', name: 'Orbital Camera', visible: true, projection: 'perspective',
    transform: transform3D('camera-orbit', [0, 2.2, 8]), fov: numeric('camera-fov', 45, [[0, 52], [3, 38], [6, 46], [9, 36], [12, 52]]),
    near: .1, far: 1000,
    pathConstraint: {
      pathId: 'camera-orbit-path', progress: numeric('camera-progress', 0, [[0, 0], [12, 1]]),
      bank: numeric('camera-bank', 0, [[0, -3], [6, 4], [12, -3]]),
      offset: { x: numeric('camera-offset-x', 0), y: numeric('camera-offset-y', 0), z: numeric('camera-offset-z', 0) },
      orientation: 'look-at', lookAtEntityId: core.id,
    },
  }
  const light = (id: string, name: string, type: AuroraLight['type'], color: string, intensity: number, position: [number, number, number]): AuroraLight => ({
    id, name, type, color, visible: true, intensity: numeric(`${id}-intensity`, intensity, type === 'ambient' ? [] : [[0, intensity * .5], [4, intensity * 1.25], [8, intensity * .7], [12, intensity * .5]]),
    transform: transform3D(id, position), castShadow: type === 'directional',
  })
  const ambient = light('ambient-violet', 'Violet Atmosphere', 'ambient', '#4b42a8', .65, [0, 0, 0])
  const keyLight = light('key-cyan', 'Cyan Key', 'directional', '#4cf7ff', 4.8, [5, 7, 6])
  keyLight.transform.rotation.x.value = -50
  keyLight.transform.rotation.y.value = 34
  const rim = light('rim-magenta', 'Magenta Rim', 'point', '#ff2bd6', 34, [-4, 2, 2])

  return {
    id: 'scene-neon-singularity', name: 'Neon Singularity Stage', objects: [core, fins, satellites, floor],
    cameras: [camera], cameraCuts: [{ id: 'camera-cut-opening', cameraId: camera.id, time: 0 }],
    lights: [ambient, keyLight, rim],
    paths: [{
      id: 'camera-orbit-path', name: 'Hero Orbit', visible: true, color: '#52f5ff',
      transform: transform3D('camera-path', [0, 0, 0]), closed: true, locked: false,
      points: [
        { id: 'path-north', position: [0, 2.7, 8], handleIn: [-2.2, 2.7, 8], handleOut: [2.2, 2.7, 8], mode: 'smooth' },
        { id: 'path-east', position: [7, 1.8, 0], handleIn: [7, 1.8, 2.2], handleOut: [7, 1.8, -2.2], mode: 'smooth' },
        { id: 'path-south', position: [0, 3.2, -8], handleIn: [2.2, 3.2, -8], handleOut: [-2.2, 3.2, -8], mode: 'smooth' },
        { id: 'path-west', position: [-7, 1.5, 0], handleIn: [-7, 1.5, -2.2], handleOut: [-7, 1.5, 2.2], mode: 'smooth' },
      ],
    }],
    activeCameraId: camera.id, environmentIntensity: 1.15,
    settings: {
      shadows: true, shadowMapSize: 2048, ambientOcclusion: true,
      ambientOcclusionIntensity: 1.15, ambientOcclusionRadius: .42, quality: 'preview', backgroundColor: '#02030d',
    }, revision: 2,
  }
}

export function createNeonSingularityProject(name = 'Neon Singularity', projectId: string = randomUUID()): SerializedEditorState {
  const backdrop = layer('layer-cosmic-backdrop', 'Deep Space Backdrop', 'shape', transform2D('backdrop', 960, 540), {
    shapeKind: 'rectangle', shapeWidth: 1920, shapeHeight: 1080, color: '#02030d', locked: true,
  })
  const sceneLayer = layer('layer-neon-scene', 'Neon Singularity · 3D', '3d-scene', transform2D('scene', 960, 540, {
    scale: [[0, 92], [2, 100], [10, 103], [12, 92]], opacity: [[0, 0], [.8, 100], [11.3, 100], [12, 0]],
  }), { sceneId: 'scene-neon-singularity' })

  const ring = (id: string, size: number, color: string, rotation: Array<[number, number]>) => layer(
    id, `HUD Ring ${size}`, 'shape', transform2D(id, 960, 540, { rotation, scale: [[0, 65], [1.5, 100], [10.5, 100], [12, 65]], opacity: [[0, 0], [1, 72], [11, 72], [12, 0]] }),
    { shapeKind: 'ellipse', shapeWidth: size, shapeHeight: size, color },
  )
  const hudChildren = [
    ring('hud-ring-outer', 760, '#07132b', [[0, 0], [12, 180]]),
    ring('hud-ring-mid', 610, '#100a2b', [[0, 0], [12, -270]]),
    ring('hud-ring-inner', 470, '#061a22', [[0, 0], [12, 360]]),
  ]
  const hud = layer('layer-orbital-hud', 'Orbital HUD · Reusable Cluster', 'cluster', transform2D('hud', 960, 540), {
    assetId: 'asset-orbital-hud', libraryPublished: true, width: 1920, height: 1080, children: hudChildren,
  })
  const title = layer('layer-hero-title', 'NEON SINGULARITY', 'text', transform2D('title', 960, 790, {
    y: [[0, 860], [1.2, 790], [9.8, 790], [12, 700]], scale: [[0, 72], [1.3, 115], [2, 100], [10.2, 100], [12, 125]],
    opacity: [[0, 0], [.7, 0], [1.4, 100], [10.5, 100], [12, 0]],
  }), { start: .4, duration: 11.6, textContent: 'NEON SINGULARITY', effects: ['Glow'] })
  const subtitle = layer('layer-subtitle', 'AURORA // MACHINE DREAM 01', 'text', transform2D('subtitle', 960, 865, {
    x: [[0, 720], [2.2, 960], [9.8, 960], [12, 1200]], opacity: [[0, 0], [1.8, 0], [2.6, 82], [9.8, 82], [11.2, 0]],
  }), { start: 1.2, duration: 10, textContent: 'AURORA // MACHINE DREAM 01' })
  const flare = layer('layer-core-flare', 'Core Energy Flare', 'shape', transform2D('flare', 960, 540, {
    scale: [[0, 20], [1.5, 135], [3, 55], [4.5, 155], [6, 65], [7.5, 145], [9, 50], [10.5, 125], [12, 20]],
    rotation: [[0, 0], [12, 540]], opacity: [[0, 0], [.8, 38], [11.2, 38], [12, 0]],
  }), { shapeKind: 'ellipse', shapeWidth: 280, shapeHeight: 280, color: '#4326b8', effects: ['Glow'] })
  const layers = [title, subtitle, flare, hud, sceneLayer, backdrop]
  const graph = createGraph(layers)
  return {
    project: {
      id: projectId, name, width: 1920, height: 1080, frameRate: 30, duration: DURATION,
      backgroundColor: '#02030d', updatedAt: Date.now(), version: 12,
    },
    layers,
    scenes3D: [createScene()],
    assets: [{
      id: 'asset-orbital-hud', name: 'Orbital HUD', kind: 'composition', duration: DURATION,
      dimensions: '1920 × 1080', layerTemplate: hud,
    }],
    ...graph,
    rigs: [],
  }
}

/** A dense but preview-friendly environment authored entirely through Aurora's editable primitives. */
export function createPillarRunProject(name = 'Pillar Run // Drone-07', projectId: string = randomUUID()): SerializedEditorState {
  const snapshot = createNeonSingularityProject(name, projectId)

  const droneMaterial = material('drone-shell', '#16233b', '#20e9ff', 1.8)
  droneMaterial.metalness.value = .88
  droneMaterial.roughness.value = .16
  const droneRoot: Aurora3DObject = {
    id: 'drone-root', name: 'DRONE-07 Flight Rig', type: 'group', primitive: 'box', visible: true,
    locked: false, castShadow: false, receiveShadow: false, transform: transform3D('drone-root', [0, 2.2, 10]),
    material: droneMaterial, influences: [],
  }
  const flightKeys: Array<[number, [number, number, number]]> = [
    [0, [0, 2.2, 10]], [2.4, [-2.45, 2.85, 4]], [4.8, [2.55, 1.9, -2]],
    [7.2, [-2.35, 3.05, -8]], [9.6, [2.25, 2.15, -14]], [12, [0, 3.25, -22]],
  ]
  droneRoot.transform.position.x = numeric('drone-flight-x', 0, flightKeys.map(([time, value]) => [time, value[0]]))
  droneRoot.transform.position.y = numeric('drone-flight-y', 2.2, flightKeys.map(([time, value]) => [time, value[1]]))
  droneRoot.transform.position.z = numeric('drone-flight-z', 10, flightKeys.map(([time, value]) => [time, value[2]]))
  droneRoot.transform.rotation.z = numeric('drone-flight-bank', 0, [[0, 0], [2.4, 12], [4.8, -14], [7.2, 13], [9.6, -11], [12, 0]])
  droneRoot.transform.rotation.y = numeric('drone-flight-yaw', 0, [[0, 0], [2.4, -8], [4.8, 10], [7.2, -9], [9.6, 8], [12, 0]])

  const child = (id: string, label: string, primitive: 'box' | 'sphere', position: [number, number, number], surface: AuroraPBRMaterial) => {
    const object = mesh(id, label, primitive, position, surface)
    object.parentId = droneRoot.id
    return object
  }
  const body = child('drone-body', 'Aerodynamic Carbon Body', 'sphere', [0, 0, 0], droneMaterial)
  body.transform.scale.x.value = 1.15
  body.transform.scale.y.value = .34
  body.transform.scale.z.value = .82
  const core = child('drone-core', 'Cyan Reactor Core', 'sphere', [0, -.28, .05], material('drone-core', '#42f5ff', '#20efff', 4.5))
  core.transform.scale.x = numeric('drone-core-scale-x', .32, [[0, .24], [1.2, .38], [2.4, .24], [3.6, .38], [4.8, .24], [6, .38], [7.2, .24], [8.4, .38], [9.6, .24], [10.8, .38], [12, .24]])
  core.transform.scale.y = core.transform.scale.x
  core.transform.scale.z = core.transform.scale.x
  core.castShadow = false

  const armMaterial = material('drone-arms', '#0a1020', '#9b4dff', .7)
  armMaterial.metalness.value = .92
  const armA = child('drone-arm-a', 'Rotor Arm A', 'box', [0, 0, 0], armMaterial)
  armA.transform.scale.x.value = 1.55
  armA.transform.scale.y.value = .07
  armA.transform.scale.z.value = .09
  armA.transform.rotation.y.value = 28
  const armB = child('drone-arm-b', 'Rotor Arm B', 'box', [0, 0, 0], armMaterial)
  armB.transform.scale.x.value = 1.55
  armB.transform.scale.y.value = .07
  armB.transform.scale.z.value = .09
  armB.transform.rotation.y.value = -28

  const rotorPositions: Array<[number, number, number]> = [[-1.35, .05, -.72], [1.35, .05, -.72], [-1.35, .05, .72], [1.35, .05, .72]]
  const rotors = rotorPositions.flatMap((position, index) => {
    const hub = child(`drone-rotor-hub-${index + 1}`, `Rotor ${index + 1} Hub`, 'sphere', position, material(`hub-${index}`, '#222a44', '#ff3fe6', 1.6))
    hub.transform.scale.x.value = .24
    hub.transform.scale.y.value = .12
    hub.transform.scale.z.value = .24
    hub.castShadow = false
    const blade = child(`drone-rotor-blade-${index + 1}`, `Rotor ${index + 1} Blade`, 'box', [position[0], position[1] + .08, position[2]], material(`blade-${index}`, '#38435f', '#29eaff', .8))
    blade.transform.scale.x.value = .58
    blade.transform.scale.y.value = .025
    blade.transform.scale.z.value = .07
    blade.transform.rotation.y = numeric(`blade-${index}-spin`, 0, [[0, index * 45], [12, 2160 + index * 45]])
    blade.castShadow = false
    return [hub, blade]
  })

  const environment: Aurora3DObject[] = []
  const floor = mesh('runway-floor', 'Wet Obsidian Runway', 'box', [0, -.35, -6], material('runway', '#040713', '#071a31', .16))
  floor.transform.scale.x.value = 8
  floor.transform.scale.y.value = .16
  floor.transform.scale.z.value = 18
  floor.material.metalness.value = .78
  floor.material.roughness.value = .22
  floor.castShadow = false
  environment.push(floor)

  const wall = (id: string, x: number) => {
    const object = mesh(id, x < 0 ? 'Left Canyon Wall' : 'Right Canyon Wall', 'box', [x, 3.4, -6], material(id, '#080d1c', x < 0 ? '#17104a' : '#073f4e', .4))
    object.transform.scale.x.value = .18
    object.transform.scale.y.value = 3.8
    object.transform.scale.z.value = 18
    return object
  }
  environment.push(wall('wall-left', -8.2), wall('wall-right', 8.2))

  const gateDepths = [7, 2, -3, -8, -13, -18]
  gateDepths.forEach((z, gateIndex) => {
    const accent = gateIndex % 2 ? '#a83cff' : '#17e9ff'
    ;[-4.15, 4.15].forEach((x, sideIndex) => {
      const pillar = mesh(`pillar-${gateIndex}-${sideIndex}`, `Gate ${gateIndex + 1} ${sideIndex ? 'Right' : 'Left'} Pillar`, 'box', [x, 3.7, z], material(`pillar-${gateIndex}-${sideIndex}`, '#11182b', accent, 1.25))
      pillar.transform.scale.x.value = .68
      pillar.transform.scale.y.value = 3.85
      pillar.transform.scale.z.value = .68
      pillar.material.metalness.value = .76
      pillar.material.roughness.value = .2
      environment.push(pillar)
    })
    const beam = mesh(`gate-beam-${gateIndex}`, `Gate ${gateIndex + 1} Crown`, 'box', [0, 7.45, z], material(`beam-${gateIndex}`, '#0b1020', accent, 1.8))
    beam.transform.scale.x.value = 4.8
    beam.transform.scale.y.value = .18
    beam.transform.scale.z.value = .5
    beam.castShadow = false
    environment.push(beam)
    const beacon = mesh(`gate-beacon-${gateIndex}`, `Gate ${gateIndex + 1} Beacon`, 'sphere', [0, 7.25, z], material(`beacon-${gateIndex}`, accent, accent, 3.8))
    beacon.transform.scale.x.value = .16
    beacon.transform.scale.y.value = .16
    beacon.transform.scale.z.value = .16
    beacon.castShadow = false
    environment.push(beacon)
  })

  const camera: AuroraCamera = {
    id: 'camera-drone-chase', name: 'Drone Chase Camera', visible: true, projection: 'perspective',
    transform: transform3D('camera-drone-chase', [0, 3.1, 16]),
    fov: numeric('drone-camera-fov', 48, [[0, 54], [2.4, 43], [4.8, 50], [7.2, 42], [9.6, 48], [12, 38]]),
    near: .08, far: 160,
    pathConstraint: {
      pathId: 'path-drone-chase', progress: numeric('drone-camera-progress', 0, [[0, 0], [12, 1]]),
      bank: numeric('drone-camera-bank', 0, [[0, 0], [2.4, 7], [4.8, -9], [7.2, 8], [9.6, -7], [12, 0]]),
      offset: { x: numeric('drone-camera-offset-x', 0), y: numeric('drone-camera-offset-y', .35), z: numeric('drone-camera-offset-z', 0) },
      orientation: 'look-at', lookAtEntityId: droneRoot.id,
    },
  }
  const cameraPathPoints: Array<[string, [number, number, number]]> = [
    ['launch', [0, 3.2, 16]], ['gate-a', [-2.8, 3.7, 8]], ['gate-b', [2.9, 2.7, 1]],
    ['gate-c', [-2.7, 3.9, -7]], ['gate-d', [2.7, 3, -15]], ['finish', [0, 4.1, -26]],
  ]

  const light = (id: string, label: string, type: AuroraLight['type'], color: string, intensity: number, position: [number, number, number]): AuroraLight => ({
    id, name: label, type, color, visible: true, intensity: numeric(`${id}-intensity`, intensity),
    transform: transform3D(id, position), castShadow: type === 'directional',
  })
  const droneLight = light('drone-follow-light', 'Drone Cyan Underglow', 'point', '#2cecff', 24, [0, 2, 10])
  droneLight.transform.position.x = numeric('drone-light-x', 0, flightKeys.map(([time, value]) => [time, value[0]]))
  droneLight.transform.position.y = numeric('drone-light-y', 1.5, flightKeys.map(([time, value]) => [time, value[1] - .7]))
  droneLight.transform.position.z = numeric('drone-light-z', 10, flightKeys.map(([time, value]) => [time, value[2]]))
  const ambient = light('pillar-ambient', 'Midnight Atmosphere', 'ambient', '#374070', .52, [0, 0, 0])
  const moon = light('pillar-moon', 'Cold Moon Key', 'directional', '#b9d9ff', 2.6, [5, 11, 8])
  moon.transform.rotation.x.value = -54
  moon.transform.rotation.y.value = 28
  const tunnelFill = light('pillar-magenta', 'Magenta Tunnel Fill', 'point', '#d23cff', 31, [-4, 4, -8])

  const scene: Aurora3DScene = {
    id: 'scene-pillar-run', name: 'Neon Canyon Pillar Run',
    objects: [...environment, droneRoot, body, core, armA, armB, ...rotors],
    cameras: [camera], cameraCuts: [{ id: 'cut-drone-launch', cameraId: camera.id, time: 0 }],
    lights: [ambient, moon, tunnelFill, droneLight],
    paths: [{
      id: 'path-drone-chase', name: 'Six-Gate Chase Line', visible: true, color: '#35edff',
      transform: transform3D('path-drone-chase', [0, 0, 0]), closed: false, locked: false,
      points: cameraPathPoints.map(([id, position], index) => ({
        id: `chase-${id}`, position,
        handleIn: [position[0], position[1], position[2] + (index ? 2.2 : 0)],
        handleOut: [position[0], position[1], position[2] - (index === cameraPathPoints.length - 1 ? 0 : 2.2)],
        mode: 'smooth' as const,
      })),
    }],
    activeCameraId: camera.id, environmentIntensity: 1.1,
    settings: {
      shadows: true, shadowMapSize: 2048, ambientOcclusion: true,
      ambientOcclusionIntensity: 1.35, ambientOcclusionRadius: .55, quality: 'preview', backgroundColor: '#02040d',
    }, revision: 1,
  }

  snapshot.scenes3D = [scene]
  snapshot.project.name = name
  snapshot.project.backgroundColor = '#02040d'
  const sceneLayer = snapshot.layers.find((item) => item.id === 'layer-neon-scene')
  if (sceneLayer) {
    sceneLayer.name = 'DRONE-07 // Neon Canyon 3D'
    sceneLayer.sceneId = scene.id
  }
  const title = snapshot.layers.find((item) => item.id === 'layer-hero-title')
  if (title) {
    title.name = 'PILLAR RUN // DRONE-07'
    title.textContent = 'PILLAR RUN // DRONE-07'
  }
  const subtitle = snapshot.layers.find((item) => item.id === 'layer-subtitle')
  if (subtitle) {
    subtitle.name = 'AUTONOMOUS FLIGHT TEST · SECTOR 9'
    subtitle.textContent = 'AUTONOMOUS FLIGHT TEST · SECTOR 9'
  }
  const flare = snapshot.layers.find((item) => item.id === 'layer-core-flare')
  if (flare) flare.name = 'Drone Telemetry Pulse'
  return snapshot
}

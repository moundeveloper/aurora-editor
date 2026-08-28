export type WorkspaceId = 'Motion' | 'Nodes' | '3D' | 'Audio' | 'Export'

export type LayerType = 'video' | 'image' | 'text' | 'shape' | 'audio' | 'adjustment' | 'cluster' | '3d-scene'

export interface Keyframe<T> {
  id: string
  time: number
  value: T
  interpolation: 'hold' | 'linear' | 'bezier'
  easing?: {
    inX: number
    inY: number
    outX: number
    outY: number
  }
}

export interface AnimatableProperty<T> {
  id: string
  value: T
  animated: boolean
  keyframes: Keyframe<T>[]
}

export interface LayerTransform {
  x: AnimatableProperty<number>
  y: AnimatableProperty<number>
  scaleX: AnimatableProperty<number>
  scaleY: AnimatableProperty<number>
  rotation: AnimatableProperty<number>
  opacity: AnimatableProperty<number>
}

export interface AnimatableVector3 {
  x: AnimatableProperty<number>
  y: AnimatableProperty<number>
  z: AnimatableProperty<number>
}

export interface Transform3D {
  position: AnimatableVector3
  rotation: AnimatableVector3
  scale: AnimatableVector3
}

export interface AuroraPBRMaterial {
  baseColor: string
  opacity: AnimatableProperty<number>
  metalness: AnimatableProperty<number>
  roughness: AnimatableProperty<number>
  emissive: string
  emissiveIntensity: AnimatableProperty<number>
}

export type Aurora3DPrimitive = 'box' | 'sphere' | 'plane' | 'model'

export type AuroraInfluenceType = 'array' | 'mirror' | 'subdivide' | 'displace' | 'twist'

/** A non-destructive geometry operation, evaluated in stack order on top of the primitive. */
export interface AuroraInfluence {
  id: string
  type: AuroraInfluenceType
  name: string
  enabled: boolean
  parameters: Record<string, AnimatableProperty<number>>
}

export interface Aurora3DObject {
  id: string
  name: string
  type: 'mesh' | 'group' | 'null'
  primitive: Aurora3DPrimitive
  assetId?: string
  parentId?: string
  visible: boolean
  locked: boolean
  castShadow: boolean
  receiveShadow: boolean
  transform: Transform3D
  material: AuroraPBRMaterial
  influences: AuroraInfluence[]
}

export interface AuroraCamera {
  id: string
  name: string
  visible: boolean
  projection: 'perspective' | 'orthographic'
  transform: Transform3D
  fov: AnimatableProperty<number>
  near: number
  far: number
  pathConstraint?: AuroraCameraPathConstraint
}

/** A camera edit; it remains active until the next cut marker. */
export interface AuroraCameraCut {
  id: string
  cameraId: string
  time: number
}

export type AuroraPathPointMode = 'corner' | 'smooth'

export interface Aurora3DPathPoint {
  id: string
  position: [number, number, number]
  handleIn: [number, number, number]
  handleOut: [number, number, number]
  mode: AuroraPathPointMode
}

export interface Aurora3DPath {
  id: string
  name: string
  visible: boolean
  color: string
  transform: Transform3D
  points: Aurora3DPathPoint[]
  closed: boolean
  locked: boolean
}

export type AuroraPathOrientation = 'tangent' | 'look-at'

export interface AuroraCameraPathConstraint {
  pathId: string
  progress: AnimatableProperty<number>
  bank: AnimatableProperty<number>
  /** Displacement from the curve in the travel frame: X right, Y up, Z backwards along the tangent. */
  offset: AnimatableVector3
  orientation: AuroraPathOrientation
  lookAtEntityId?: string
}

export interface AuroraLight {
  id: string
  name: string
  visible: boolean
  type: 'ambient' | 'directional' | 'point'
  color: string
  intensity: AnimatableProperty<number>
  transform: Transform3D
  castShadow: boolean
}

export interface Scene3DSettings {
  shadows: boolean
  shadowMapSize: number
  quality: 'draft' | 'preview' | 'full'
  backgroundColor: string | null
}

export interface Aurora3DScene {
  id: string
  name: string
  objects: Aurora3DObject[]
  cameras: AuroraCamera[]
  cameraCuts: AuroraCameraCut[]
  lights: AuroraLight[]
  paths: Aurora3DPath[]
  activeCameraId: string | null
  environmentAssetId?: string
  environmentIntensity: number
  settings: Scene3DSettings
  revision: number
}

export interface ShapePathPoint {
  id: string
  position: [number, number]
  handleIn: [number, number]
  handleOut: [number, number]
}

export interface ShapePath {
  closed: boolean
  points: ShapePathPoint[]
}

export interface EditorLayer {
  id: string
  trackId?: string
  name: string
  type: LayerType
  start: number
  duration: number
  sourceOffset?: number
  shapeKind?: 'rectangle' | 'ellipse' | 'path'
  shapeWidth?: number
  shapeHeight?: number
  shapePath?: ShapePath
  textContent?: string
  sceneId?: string
  /** Library entry this cluster publishes itself to, kept in step as the cluster is edited. */
  assetId?: string
  children?: EditorLayer[]
  isPlaceholder?: boolean
  color: string
  visible: boolean
  locked: boolean
  muted: boolean
  expanded: boolean
  transform: LayerTransform
  effects: string[]
}

export interface MediaAsset {
  id: string
  name: string
  kind: 'video' | 'image' | 'audio' | 'composition' | 'model3d' | 'hdr' | 'texture'
  /** Reusable timeline composition, captured when a cluster is created. */
  layerTemplate?: EditorLayer
  duration?: number
  dimensions?: string
  thumbnail?: string
  sizeLabel?: string
}

export type EditorNodeKind =
  | 'image' | 'text' | 'scene3d'
  | 'translate' | 'rotate' | 'scale'
  | 'blur' | 'glow' | 'vignette'
  | 'invert' | 'brightnessContrast' | 'colorMatrix' | 'hueSaturation' | 'rgbToBw'
  | 'mix' | 'stack' | 'mask' | 'math'
  | 'output' | 'viewer'

/** Sockets are typed like Blender's: an image stream, or a single number. */
export type EditorNodeSocketType = 'image' | 'value'

export interface EditorNodeSocket {
  id: string
  label: string
  type: EditorNodeSocketType
  /** Inline default used while nothing is linked. Image sockets carry no value of their own. */
  value?: number
}

export interface EditorNode {
  id: string
  kind: EditorNodeKind
  title: string
  /** Graph-space position of the node's top-left corner, independent of pan and zoom. */
  x: number
  y: number
  /** A muted node passes its first image input straight through. */
  muted: boolean
  /** Layer a source node reads from. Unbound source nodes contribute nothing to the render. */
  sourceId?: string
  /** Enum choices shown as dropdowns on the node body, such as a blend mode. */
  properties: Record<string, string>
  /**
   * Feather width in project pixels, one entry per segment of the connected mask shape. Zero is a
   * hard cut; a positive value fades the alpha from the edge inward over that many pixels. Segments
   * are addressed by index, so this survives a segment later becoming a Bézier span.
   */
  maskSegmentFeather?: number[]
  inputs: EditorNodeSocket[]
  outputs: EditorNodeSocket[]
}

export interface EditorNodeConnection {
  id: string
  fromNodeId: string
  fromPortId: string
  toNodeId: string
  toPortId: string
}

export interface EditorProject {
  id: string
  name: string
  width: number
  height: number
  frameRate: number
  duration: number
  backgroundColor: string
  updatedAt: number
  version: number
}

export interface SerializedEditorState {
  project: EditorProject
  layers: EditorLayer[]
  scenes3D: Aurora3DScene[]
  assets: MediaAsset[]
  nodes: EditorNode[]
  nodeConnections: EditorNodeConnection[]
}

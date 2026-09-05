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

export type AuroraInfluenceType = 'array' | 'radial-array' | 'mirror' | 'subdivide' | 'displace' | 'twist'

/** A non-destructive geometry operation, evaluated in stack order on top of the primitive. */
export interface AuroraInfluence {
  id: string
  type: AuroraInfluenceType
  name: string
  enabled: boolean
  parameters: Record<string, AnimatableProperty<number>>
}

/**
 * A bone of a 2D deformation rig.
 *
 * Rest pose is absolute in rig space — a square running from -1 to 1 on both axes, centred on the
 * image, with Y pointing up — so the same skeleton fits a timeline image layer and a 3D image plane
 * without either of them having to know the other's units. Parenting only chains the *pose*: a bone
 * inherits what its parent was posed into, never where its parent rests.
 */
export interface AuroraRigBone {
  id: string
  name: string
  parentId?: string
  /** Rest pivot in rig space. */
  x: number
  y: number
  /** Rest direction in degrees, counter-clockwise from +X, and the bone's length in rig units. */
  angle: number
  length: number
  /** How far past its own segment the bone still moves the image, in rig units. */
  falloff: number
  /** Pose, layered on the rest pose. Rotation is in degrees, offsets in rig units. */
  rotation: AnimatableProperty<number>
  offsetX: AnimatableProperty<number>
  offsetY: AnimatableProperty<number>
  /** Stretch along the bone; 1 leaves its length alone. */
  stretch: AnimatableProperty<number>
}

/** A skeleton that bends whatever it is attached to. Rigs are project-wide and can be shared. */
export interface AuroraRig {
  id: string
  name: string
  /** Deformation mesh density. More cells bend more smoothly and cost more per frame. */
  columns: number
  rows: number
  bones: AuroraRigBone[]
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
  /** Deformation rig bending this object's surface. Only image planes are rigged today. */
  rigId?: string
}

export interface AuroraCamera {
  id: string
  name: string
  visible: boolean
  projection: 'perspective' | 'orthographic'
  transform: Transform3D
  fov: AnimatableProperty<number>
  /** Renders a lens blur outside the focus plane. Off keeps every depth pin-sharp. */
  depthOfField?: boolean
  /** Distance to the sharp plane, in scene units. */
  focusDistance?: AnimatableProperty<number>
  /** Lens f-number. Lower opens the aperture, shrinking the sharp range and growing the bokeh. */
  fStop?: AnimatableProperty<number>
  near: number
  far: number
  pathConstraint?: AuroraCameraPathConstraint
  objectConstraint?: AuroraCameraObjectConstraint
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

export type AuroraObjectFollowOrientation = 'target' | 'look-at'

export interface AuroraCameraObjectConstraint {
  objectId: string
  /** Position displacement in the followed object's local axes. */
  positionOffset: AnimatableVector3
  /** Euler displacement, in degrees, applied after the inherited or look-at orientation. */
  rotationOffset: AnimatableVector3
  orientation: AuroraObjectFollowOrientation
  /** Defaults to the followed object when omitted in look-at mode. */
  lookAtEntityId?: string
}

export interface AuroraLight {
  id: string
  name: string
  visible: boolean
  type: 'ambient' | 'directional' | 'point' | 'spot' | 'area'
  color: string
  intensity: AnimatableProperty<number>
  /** Spot cone half-angle in degrees. Optional so projects authored before spot lights remain valid. */
  angle?: AnimatableProperty<number>
  /** Maximum illuminated distance. Zero means unbounded in Three, but authored spots use a finite range. */
  distance?: AnimatableProperty<number>
  /** Fraction of the cone edge blended from full intensity to darkness. */
  penumbra?: AnimatableProperty<number>
  /** Rect area-light emitter width in scene units. Optional so pre-area-light projects stay valid. */
  width?: AnimatableProperty<number>
  /** Rect area-light emitter height in scene units. */
  height?: AnimatableProperty<number>
  transform: Transform3D
  castShadow: boolean
}

export interface Scene3DSettings {
  shadows: boolean
  shadowMapSize: number
  ambientOcclusion: boolean
  ambientOcclusionIntensity: number
  ambientOcclusionRadius: number
  /** Accumulates deterministic subframes around the playhead for animated 3D motion. */
  motionBlur: boolean
  /** Exposure duration expressed like a physical camera shutter, from 0 to 360 degrees. */
  motionBlurShutter: number
  /** Authored full-quality sample count. Preview quality caps this to keep the editor responsive. */
  motionBlurSamples: number
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
  /** Draws the environment map behind the scene instead of the flat background colour. */
  environmentBackground?: boolean
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

/** Single-input node operators that can also be applied directly to a timeline layer. */
export type LayerEffectKind =
  | 'translate' | 'rotate' | 'scale'
  | 'blur' | 'glow' | 'vignette'
  | 'invert' | 'brightnessContrast' | 'colorMatrix' | 'hueSaturation' | 'rgbToBw'

/**
 * An ordered, independently switchable instance of a node-graph operator.
 * Parameter keys are the matching node input keys (`radius`, `temperature`, and so on).
 */
export interface LayerEffect {
  id: string
  kind: LayerEffectKind
  enabled: boolean
  values: Record<string, number>
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
  /** A 3D scene can opt this layer out of its scene-level motion-blur pass. Defaults to true. */
  motionBlur?: boolean
  /** Library entry this cluster publishes itself to, kept in step as the cluster is edited. */
  assetId?: string
  /** False after the user explicitly removes this reusable item from the Library. */
  libraryPublished?: boolean
  /** Independent canvas size for cluster compositions. */
  width?: number
  height?: number
  children?: EditorLayer[]
  isPlaceholder?: boolean
  /** Deformation rig bending this layer. Only image layers are rigged today. */
  rigId?: string
  color: string
  visible: boolean
  locked: boolean
  muted: boolean
  expanded: boolean
  transform: LayerTransform
  effects: LayerEffect[]
}

export interface MediaAsset {
  id: string
  name: string
  kind: 'video' | 'image' | 'audio' | 'composition' | 'scene3d' | 'model3d' | 'hdr' | 'texture'
  /**
   * Content address of the bytes in the media vault. Absent for assets that have none — a saved
   * composition, or an import made while the media server was unreachable.
   */
  hash?: string
  mimeType?: string
  sizeBytes?: number
  /** Reusable timeline composition, captured when a cluster is created. */
  layerTemplate?: EditorLayer
  /** Timeline wrapper for a reusable 3D scene. Kept separate from cluster compositions. */
  sceneLayerTemplate?: EditorLayer
  /** Reusable 3D scene definition paired with a 3D timeline-layer template. */
  sceneTemplate?: Aurora3DScene
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
  /** Named composition cues shared by every timeline view. */
  markers?: TimelineMarker[]
}

export interface TimelineMarker {
  id: string
  name: string
  time: number
  color: string
}

export interface SerializedEditorState {
  project: EditorProject
  layers: EditorLayer[]
  scenes3D: Aurora3DScene[]
  assets: MediaAsset[]
  nodes: EditorNode[]
  nodeConnections: EditorNodeConnection[]
  rigs: AuroraRig[]
}

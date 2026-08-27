export type WorkspaceId = 'Edit' | 'Motion' | 'Nodes' | 'Audio' | 'Export'

export type LayerType = 'video' | 'image' | 'text' | 'shape' | 'audio' | 'adjustment' | 'cluster'

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

export interface EditorLayer {
  id: string
  trackId?: string
  name: string
  type: LayerType
  start: number
  duration: number
  sourceOffset?: number
  shapeKind?: 'rectangle' | 'ellipse'
  textContent?: string
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
  kind: 'video' | 'image' | 'audio' | 'composition'
  duration?: number
  dimensions?: string
  thumbnail?: string
  sizeLabel?: string
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

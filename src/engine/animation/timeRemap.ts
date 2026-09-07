import type { EditorLayer } from '@/models/editor'
import { evaluateNumericProperty } from './evaluateProperty'
export function layerSampleTime(layer: EditorLayer, projectTime: number) {
  return layer.timeRemap ? layer.start + evaluateNumericProperty(layer.timeRemap, projectTime) : projectTime
}
export function sourceTime(layer: EditorLayer, projectTime: number) {
  return layerSampleTime(layer, projectTime) - layer.start + (layer.sourceOffset ?? 0)
}
export function enableTimeRemap(layer: EditorLayer) {
  layer.timeRemap = { id: `${layer.id}-time-remap`, value: 0, animated: true, keyframes: [
    { id: crypto.randomUUID(), time: layer.start, value: 0, interpolation: 'linear' },
    { id: crypto.randomUUID(), time: layer.start + layer.duration, value: layer.duration, interpolation: 'linear' },
  ] }
}

import * as THREE from 'three'
import type { Scene3DSettings } from '@/models/editor'
export const VIEW_TRANSFORMS = {aces:THREE.ACESFilmicToneMapping,agx:THREE.AgXToneMapping,neutral:THREE.NeutralToneMapping,standard:THREE.LinearToneMapping} as const
export function configureSceneColor(renderer:THREE.WebGLRenderer,settings:Scene3DSettings) {
  renderer.outputColorSpace=THREE.SRGBColorSpace
  renderer.toneMapping=VIEW_TRANSFORMS[settings.viewTransform ?? 'aces'] ?? THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure=2**Math.max(-10,Math.min(10,Number.isFinite(settings.exposureStops)?settings.exposureStops!:0))
}

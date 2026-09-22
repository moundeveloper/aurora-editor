import { z } from 'zod'
import type { Aurora3DScene, Scene3DSettings } from '../src/models/editor.ts'

export const colorGradePatchSchema = z.object({
  enabled:z.boolean().optional(),
  temperature:z.number().finite().min(-100).max(100).optional(),
  tint:z.number().finite().min(-100).max(100).optional(),
  contrast:z.number().finite().min(0).max(2).optional(),
  saturation:z.number().finite().min(0).max(2).optional(),
}).strict()
export const sceneLookPatchSchema = z.object({
  colorGrade:colorGradePatchSchema.optional(),
  exposureStops:z.number().finite().min(-10).max(10).optional(),
  viewTransform:z.enum(['aces','agx','neutral','standard']).optional(),
  ambientOcclusion:z.boolean().optional(),
  ambientOcclusionIntensity:z.number().finite().min(0).max(3).optional(),
  ambientOcclusionRadius:z.number().finite().min(.01).max(5).optional(),
  quality:z.enum(['draft','preview','full']).optional(),
}).strict()
export type SceneLookPatch = z.infer<typeof sceneLookPatchSchema>
export const DEFAULT_COLOR_GRADE = {enabled:false,temperature:0,tint:0,contrast:1,saturation:1}

export function sceneColorGrade(settings: Pick<Scene3DSettings,'colorGrade'>) {
  const parsed=colorGradePatchSchema.safeParse(settings.colorGrade??{})
  return {...DEFAULT_COLOR_GRADE,...(parsed.success?parsed.data:{})}
}

/** Shared UI/MCP validation. Validate the entire patch before touching scene state. */
export function applySceneLook(scene: Aurora3DScene, input: SceneLookPatch) {
  const patch=sceneLookPatchSchema.parse(input)
  const {colorGrade,...settings}=patch
  Object.assign(scene.settings,settings)
  if(colorGrade)scene.settings.colorGrade={...sceneColorGrade(scene.settings),...colorGrade}
}

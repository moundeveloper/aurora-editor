import * as THREE from 'three'
import { sceneColorGrade } from '../../../shared/sceneLook'
import type { Scene3DSettings } from '@/models/editor'

/** Applied after tone mapping in display-referred sRGB; preserves alpha and neutral/bypass exactly. */
export const COLOR_GRADE_GLSL = `
uniform vec4 auroraGrade;
uniform float auroraGradeEnabled;
vec3 auroraColorGrade(vec3 linearColor) {
  if (auroraGradeEnabled < 0.5) return linearColor;
  vec3 color = sRGBTransferOETF(vec4(max(linearColor, vec3(0.0)), 1.0)).rgb;
  color *= exp2(vec3(auroraGrade.x + auroraGrade.y * 0.5, -auroraGrade.y * 0.5, -auroraGrade.x + auroraGrade.y * 0.5));
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, auroraGrade.w);
  color = clamp((color - 0.5) * auroraGrade.z + 0.5, 0.0, 1.0);
  return sRGBTransferEOTF(vec4(color, 1.0)).rgb;
}
`

export function colorGradeUniforms(settings: Scene3DSettings) {
  const grade=sceneColorGrade(settings)
  // Neutral enabled settings take the exact same shader path as bypass.
  const enabled=grade.enabled && (grade.temperature!==0 || grade.tint!==0 || grade.contrast!==1 || grade.saturation!==1)
  return {enabled:enabled?1:0,values:new THREE.Vector4(grade.temperature/200,grade.tint/200,grade.contrast,grade.saturation)}
}

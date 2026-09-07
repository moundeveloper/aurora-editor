import * as THREE from 'three'
import type { Aurora3DObject } from '@/models/editor'

const groups = [
  {type:'PointLight',name:'auroraPointMask',count:'NUM_POINT_LIGHTS',statement:'getPointLightInfo( pointLight, geometryPosition, directLight );'},
  {type:'SpotLight',name:'auroraSpotMask',count:'NUM_SPOT_LIGHTS',statement:'getSpotLightInfo( spotLight, geometryPosition, directLight );'},
  {type:'DirectionalLight',name:'auroraDirectionalMask',count:'NUM_DIR_LIGHTS',statement:'getDirectionalLightInfo( directionalLight, directLight );'},
  {type:'RectAreaLight',name:'auroraAreaMask',count:'NUM_RECT_AREA_LIGHTS',statement:'rectAreaLight = rectAreaLights[ i ];'},
] as const
interface LinkUniforms { [key:string]: THREE.IUniform }

export function lightLinkWeights(definition: Aurora3DObject, lights: THREE.Light[]) {
  const link=definition.lightLink
  const includes=(light:THREE.Light)=>!link || link.mode==='all' || (link.mode==='include' ? link.ids.includes(light.userData.auroraId) : !link.ids.includes(light.userData.auroraId))
  // Match WebGLLights' stable shadow/map ordering. Authored lights use the default camera layer.
  const ordered=lights.filter(light=>light.visible).sort((a,b)=>(b.castShadow?2:0)-(a.castShadow?2:0)+('map' in b && b.map?1:0)-('map' in a && a.map?1:0))
  const result:Record<string,number[]|THREE.Color>={}
  for(const group of groups)result[group.name]=ordered.filter(light=>light.type===group.type).map(light=>includes(light)?1:0)
  const ambient=new THREE.Color(0)
  for(const light of ordered)if(light instanceof THREE.AmbientLight && includes(light))ambient.add(light.color.clone().multiplyScalar(light.intensity))
  result.auroraAmbient=ambient
  return result
}

export function linkedLightFragment() {
  let source=THREE.ShaderChunk.lights_fragment_begin
  for(const group of groups)source=source.replace(group.statement,`${group.statement}\n${group.type==='RectAreaLight'?'rectAreaLight':'directLight'}.color *= ${group.name}[ i ];`)
  return source.replace('getAmbientLightIrradiance( ambientLightColor )','getAmbientLightIrradiance( auroraAmbient )')
}

/** Filter illumination per material; retain the scene's normal depth/shadow passes. */
export function syncLightLinking(material:THREE.MeshStandardMaterial,definition:Aurora3DObject,lights:THREE.Light[]) {
  let uniforms=material.userData.auroraLinkUniforms as LinkUniforms|undefined
  if(!uniforms && (!definition.lightLink || definition.lightLink.mode==='all'))return
  if(!uniforms) {
    uniforms={};material.userData.auroraLinkUniforms=uniforms
    const values=uniforms
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,values)
      const declarations=groups.map(group=>`#if ${group.count} > 0\nuniform float ${group.name}[ ${group.count} ];\n#endif`).join('\n')
      shader.fragmentShader=`${declarations}\nuniform vec3 auroraAmbient;\n${shader.fragmentShader}`.replace(/#include\s+<lights_fragment_begin>/,linkedLightFragment())
    }
    material.customProgramCacheKey=()=> 'aurora-light-links-1'
    material.needsUpdate=true
  }
  for(const [key,value] of Object.entries(lightLinkWeights(definition,lights))) {
    if(uniforms[key])uniforms[key]!.value=value
    else uniforms[key]={value}
  }
}

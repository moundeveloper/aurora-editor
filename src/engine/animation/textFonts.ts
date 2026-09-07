import type {EditorLayer} from '@/models/editor'
const fonts=new Map<string,Promise<void>>()
const familyNames=new Map<string,string>()
export function textFontFamily(layer:EditorLayer) {
  if(!layer.textFontSource)return layer.textFont || 'Inter, system-ui, sans-serif'
  const cached=familyNames.get(layer.textFontSource)
  if(cached)return cached
  let hash=2166136261
  for(let i=0;i<layer.textFontSource.length;i++)hash=Math.imul(hash^layer.textFontSource.charCodeAt(i),16777619)
  const family=`AuroraEmbedded${hash>>>0}`
  if(familyNames.size>=64)familyNames.delete(familyNames.keys().next().value!)
  familyNames.set(layer.textFontSource,family)
  return family
}
/** Wait for metrics before both interactive rendering and export, avoiding fallback-font frames. */
export async function prepareTextFont(layer:EditorLayer) {
  if(typeof document==='undefined' || !document.fonts)return
  const family=textFontFamily(layer)
  if(layer.textFontSource) {
    let pending=fonts.get(family)
    if(!pending){const source=layer.textFontSource;pending=(async()=>{const face=new FontFace(family,`url("${source}")`,{weight:'600'});await face.load();document.fonts.add(face)})().catch(error=>{fonts.delete(family);throw error});fonts.set(family,pending)}
    await pending
  }
  await document.fonts.load(`600 ${Math.max(1,layer.textSize ?? 42)}px ${family}`,layer.textContent ?? layer.name)
}

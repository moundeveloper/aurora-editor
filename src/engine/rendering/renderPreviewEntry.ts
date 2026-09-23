import * as THREE from 'three'
import { ThreeSceneRuntimeRegistry } from '../scene3d/ThreeSceneRuntime'
import { cameraIdAtTime } from '../scene3d/cameraCuts'
import { cameraLensAtTime } from '../scene3d/cameraLens'
import { bindNumericScope } from '../animation/propertyScope'
import { AuroraSceneRenderPipeline } from './AuroraSceneRenderPipeline'
import type { RenderPreviewRequest, RenderPreviewResult } from '../../../shared/renderPreview'

async function render() {
  const input = await (await fetch('/__aurora_preview__/document')).json() as RenderPreviewRequest
  const { snapshot, width, height, time } = input
  const definition = input.sceneId ? snapshot.scenes3D.find(s => s.id === input.sceneId) : snapshot.scenes3D[0]
  if (!definition) throw new Error('No matching 3D scene')
  if (input.quality) definition.settings.quality = input.quality
  const cameraId = input.cameraId ?? cameraIdAtTime(definition,time)
  const cameraDefinition = definition.cameras.find(c => c.id === cameraId)
  if (!cameraDefinition) throw new Error('No matching camera')
  bindNumericScope(snapshot)
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(1)
  renderer.setSize(width,height)
  renderer.shadowMap.enabled = definition.settings.shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.info.autoReset = false
  const registry = new ThreeSceneRuntimeRegistry(), pipeline = new AuroraSceneRenderPipeline(renderer)
  try {
    await registry.prepareAssets([definition],snapshot.assets)
    const first = performance.now()
    let runtime = registry.get(definition,width,height,time,snapshot.assets,snapshot.rigs)
    // Runtime creation initiates imported models/environment loading; wait for every pending resource.
    await registry.whenAssetsReady()
    runtime = registry.get(definition,width,height,time,snapshot.assets,snapshot.rigs)
    const firstSyncMs = performance.now()-first
    let sampleTime=time
    const draw = () => {
      renderer.info.reset()
      const id=input.cameraId??cameraIdAtTime(definition,sampleTime)
      const camera=runtime.cameras.get(id!)!,lens=definition.cameras.find(c=>c.id===id)!
      pipeline.render(runtime.scene,camera,definition.settings,width,height,'screen',cameraLensAtTime(lens,sampleTime))
      renderer.getContext().finish() // Include GPU completion, rather than just command submission.
    }
    draw()
    let sources = runtime.root.children.filter((o):o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)
    const versions=new Map(sources.map(o=>[o,o.instanceMatrix.version]))
    let uploads=0
    const sync:number[]=[], frames:number[]=[]
    for(let i=0;i<input.benchmarkFrames;i++) {
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
      const start = performance.now()
      sampleTime=Math.min(snapshot.project.duration,time+(input.duration??0)*i/Math.max(1,input.benchmarkFrames-1))
      runtime = registry.get(definition,width,height,sampleTime,snapshot.assets,snapshot.rigs)
      sources=runtime.root.children.filter((o):o is THREE.InstancedMesh=>o instanceof THREE.InstancedMesh)
      for(const source of sources){uploads+=Math.max(0,source.instanceMatrix.version-(versions.get(source)??0));versions.set(source,source.instanceMatrix.version)}
      sync.push(performance.now()-start)
      draw();frames.push(performance.now()-start)
    }
    const percentile=(values:number[],p:number)=>{const sorted=[...values].sort((a,b)=>a-b);return Math.round((sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0)*100)/100}
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info')
    window.auroraPreviewResult = {
      png: canvas.toDataURL('image/png'),projectId:snapshot.project.id,sceneId:definition.id,cameraId:(input.cameraId??cameraIdAtTime(definition,sampleTime))!,width,height,quality:definition.settings.quality,sampleStart:time,sampleEnd:sampleTime,sampleCount:input.benchmarkFrames,
      metrics:{firstSyncMs:Math.round(firstSyncMs*100)/100,syncMedianMs:percentile(sync,.5),syncP95Ms:percentile(sync,.95),frameMedianMs:percentile(frames,.5),frameP95Ms:percentile(frames,.95),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,instances:sources.reduce((n,o)=>n+o.count,0),instanceUploadsDuringBenchmark:uploads,renderer:debug?String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)):String(gl.getParameter(gl.RENDERER))},
    }
  } finally { pipeline.dispose();registry.dispose();renderer.dispose() }
}
void render().catch(error=>{window.auroraPreviewError=error instanceof Error?error.stack??error.message:String(error)})

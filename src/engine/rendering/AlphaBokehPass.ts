import * as THREE from 'three'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { BokehShader } from 'three/addons/shaders/BokehShader.js'

// Gather using the contributing surface's blur radius. A sharp glyph must not be
// repeated across a far-background pixel's much larger circle of confusion.
const fragmentShader = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tColor, tDepth;
  uniform float focus, aperture, maxblur, aspect, nearClip, farClip;
  #include <packing>
  float distanceAt(vec2 uv) {
    float depth = unpackRGBAToDepth(texture2D(tDepth, uv));
    #if PERSPECTIVE_CAMERA == 1
      return -perspectiveDepthToViewZ(depth, nearClip, farClip);
    #else
      return -orthographicDepthToViewZ(depth, nearClip, farClip);
    #endif
  }
  float radiusAt(float distance) {
    return .4 * min(abs(focus-distance)*aperture, maxblur);
  }
  void main() {
    float centerDepth = distanceAt(vUv);
    float centerRadius = radiusAt(centerDepth);
    float limit = max(centerRadius, .000001);
    vec4 color = texture2D(tColor, vUv);
    float total = 1.;
    for (int i=0; i<48; i++) {
      float fraction = (float(i)+.5)/48.;
      float angle = float(i)*2.39996323;
      float offsetRadius = sqrt(fraction)*limit;
      vec2 uv = vUv + vec2(cos(angle),sin(angle)*aspect)*offsetRadius;
      float sampleDepth = distanceAt(uv);
      float sampleRadius = radiusAt(sampleDepth);
      // Background cannot wash over a focused foreground surface. Foreground
      // contributes only within its own blur radius, including alpha cutouts.
      float radius = sampleDepth < centerDepth ? sampleRadius : min(centerRadius,sampleRadius);
      float weight = 1.-smoothstep(radius*.65, max(radius,.000001), offsetRadius);
      color += texture2D(tColor,uv)*weight;
      total += weight;
    }
    gl_FragColor = vec4((color/total).rgb,1.);
  }
`

/** Bokeh with per-material depth: transparent holes no longer become solid focus rectangles. */
export class BokehPass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform>
  private target = new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter})
  private material: THREE.ShaderMaterial
  private quad: FullScreenQuad
  private depths=new Map<THREE.Material,THREE.MeshDepthMaterial>()
  constructor(public scene:THREE.Scene,public camera:THREE.Camera) {
    super()
    this.uniforms=THREE.UniformsUtils.clone(BokehShader.uniforms)
    this.uniforms.tDepth!.value=this.target.texture
    this.material=new THREE.ShaderMaterial({defines:{...BokehShader.defines},uniforms:this.uniforms,vertexShader:BokehShader.vertexShader,fragmentShader})
    this.quad=new FullScreenQuad(this.material)
  }
  private depth(source:THREE.Material) {
    const surface=source as THREE.MeshStandardMaterial
    let depth=this.depths.get(source)
    if(!depth){depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,blending:THREE.NoBlending});this.depths.set(source,depth)}
    if(depth.map!==(surface.map??null)||depth.alphaMap!==(surface.alphaMap??null)||depth.side!==source.side||depth.displacementMap!==(surface.displacementMap??null))depth.needsUpdate=true
    depth.map=surface.map??null;depth.alphaMap=surface.alphaMap??null;depth.side=source.side
    depth.displacementMap=surface.displacementMap??null
    depth.displacementScale=surface.displacementScale??1;depth.displacementBias=surface.displacementBias??0
    depth.opacity=source.opacity;depth.alphaTest=Math.max(source.alphaTest,.001)
    depth.visible=source.visible&&source.opacity>.001
    depth.clippingPlanes=source.clippingPlanes;depth.clipIntersection=source.clipIntersection
    depth.polygonOffset=source.polygonOffset;depth.polygonOffsetFactor=source.polygonOffsetFactor;depth.polygonOffsetUnits=source.polygonOffsetUnits
    return depth
  }
  override render(renderer:THREE.WebGLRenderer,write:THREE.WebGLRenderTarget,read:THREE.WebGLRenderTarget) {
    const materials=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>(),used=new Set<THREE.Material>()
    const override=this.scene.overrideMaterial,background=this.scene.background,clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),auto=renderer.autoClear,target=renderer.getRenderTarget()
    try {
      this.scene.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return
        materials.set(object,object.material)
        const convert=(source:THREE.Material)=>{used.add(source);return this.depth(source)}
        object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material)
      })
      this.scene.overrideMaterial=null;this.scene.background=null;renderer.autoClear=false
      renderer.setClearColor(0xffffff,1);renderer.setRenderTarget(this.target);renderer.clear();renderer.render(this.scene,this.camera)
      for(const [mesh,material] of materials)mesh.material=material
      this.scene.overrideMaterial=override;this.scene.background=background
      const camera=this.camera as THREE.PerspectiveCamera
      const perspective=camera.isPerspectiveCamera?1:0
      if(this.material.defines.PERSPECTIVE_CAMERA!==perspective){this.material.defines.PERSPECTIVE_CAMERA=perspective;this.material.needsUpdate=true}
      this.uniforms.tColor!.value=read.texture;this.uniforms.nearClip!.value=camera.near;this.uniforms.farClip!.value=camera.far
      renderer.setRenderTarget(this.renderToScreen?null:write);renderer.clear();this.quad.render(renderer)
    } finally {
      for(const [mesh,material] of materials)mesh.material=material
      this.scene.overrideMaterial=override;this.scene.background=background
      renderer.setClearColor(clear,alpha);renderer.autoClear=auto;renderer.setRenderTarget(target)
      for(const [source,depth] of this.depths)if(!used.has(source)){depth.dispose();this.depths.delete(source)}
    }
  }
  override setSize(width:number,height:number){this.target.setSize(width,height);this.uniforms.aspect!.value=width/height}
  override dispose(){this.target.dispose();this.material.dispose();this.quad.dispose();this.depths.forEach(m=>m.dispose());this.depths.clear()}
}

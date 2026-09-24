// Skylark Run — post-processing.
//
// The scene is rendered linear and high-dynamic-range into a half-float,
// multisampled target. Everything after that happens here, in one place:
//
//   bright pass  ->  a three-level blur pyramid (bloom)
//   bright pass  ->  a radial streak toward the sun (god rays)
//   composite    ->  bloom + rays, then the renderer's own tone mapping and
//                    output colour space, then vignette and dither
//
// Tone mapping and the sRGB conversion come from three's shader chunks, driven
// by renderer.toneMapping / toneMappingExposure, so the image is graded
// identically whether the post chain is on or off. Only light that is genuinely
// brighter than paper white blooms: the sun, its glare and the glows. A sunlit
// field or a white cloud does not, which is what keeps the frame crisp.
//
// Core three only — no EffectComposer — and cheap enough to leave on for a phone.
import * as THREE from 'three';
import { DPR, H, W, camera, renderer, scene } from './view.js';
import { Game, P } from './state.js';
import { SUNDIR, Sun } from './sun.js';
import { Quality } from './quality.js';

const postCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const postScene=new THREE.Scene();
const postQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),null);
postQuad.frustumCulled=false;
postScene.add(postQuad);

const PVS="varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}";
const pass=(uniforms,fs)=>new THREE.ShaderMaterial({
  uniforms, vertexShader:PVS, fragmentShader:fs, depthTest:false, depthWrite:false,
  toneMapped:false });

/** Soft-knee threshold on HDR luminance, taken at half resolution. */
const brightMat=pass({tex:{value:null},th:{value:1.25},knee:{value:0.9}},`
  varying vec2 vUv; uniform sampler2D tex; uniform float th,knee;
  void main(){
    vec3 c=texture2D(tex,vUv).rgb;
    float l=max(c.r,max(c.g,c.b));
    float s=clamp(l-th+knee,0.0,2.0*knee);
    s=s*s/(4.0*knee+1e-4);
    float w=max(s,l-th)/max(l,1e-4);
    gl_FragColor=vec4(min(c*w,vec3(24.0)),1.0);
  }`);

/** Separable 9-tap Gaussian using linear-sampling offsets. */
const blurMat=pass({tex:{value:null},dir:{value:new THREE.Vector2(1,0)},texel:{value:new THREE.Vector2()}},`
  varying vec2 vUv; uniform sampler2D tex; uniform vec2 dir,texel;
  void main(){
    vec2 o=dir*texel;
    vec3 c=texture2D(tex,vUv).rgb*0.227;
    c+=(texture2D(tex,vUv+o*1.384).rgb+texture2D(tex,vUv-o*1.384).rgb)*0.316;
    c+=(texture2D(tex,vUv+o*3.230).rgb+texture2D(tex,vUv-o*3.230).rgb)*0.070;
    gl_FragColor=vec4(c,1.0);
  }`);

/** A plain bilinear copy, for stepping down the pyramid. */
const copyMat=pass({tex:{value:null}},`
  varying vec2 vUv; uniform sampler2D tex;
  void main(){ gl_FragColor=vec4(texture2D(tex,vUv).rgb,1.0); }`);

/** Radial streak from the bright pass toward the sun's screen position. */
const raysMat=pass({tex:{value:null},sunUv:{value:new THREE.Vector2(0.5,0.5)},strength:{value:0}},`
  varying vec2 vUv; uniform sampler2D tex; uniform vec2 sunUv; uniform float strength;
  void main(){
    vec2 dv=(sunUv-vUv)*0.045;
    vec2 uv=vUv; vec3 acc=vec3(0.0); float w=1.0,tot=0.0;
    for(int i=0;i<16;i++){ uv+=dv; acc+=texture2D(tex,uv).rgb*w; tot+=w; w*=0.90; }
    gl_FragColor=vec4(acc/tot*strength,1.0);
  }`);

/** Bloom and rays over the scene, then three's tone mapping and output space. */
const compMat=new THREE.ShaderMaterial({
  uniforms:{base:{value:null},b1:{value:null},b2:{value:null},b3:{value:null},
    rays:{value:null},kBloom:{value:0.22},kRays:{value:0.55},time:{value:0},
    res:{value:new THREE.Vector2(1,1)}},
  vertexShader:PVS,
  fragmentShader:`
    #include <common>
    varying vec2 vUv;
    uniform sampler2D base,b1,b2,b3,rays;
    uniform float kBloom,kRays,time;
    uniform vec2 res;
    void main(){
      vec3 c=texture2D(base,vUv).rgb;
      vec3 bloom=texture2D(b1,vUv).rgb*0.50+texture2D(b2,vUv).rgb*0.32+texture2D(b3,vUv).rgb*0.18;
      c+=bloom*kBloom+texture2D(rays,vUv).rgb*kRays;
      gl_FragColor=vec4(c,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      vec2 cc=vUv-0.5;
      gl_FragColor.rgb*=1.0-dot(cc,cc)*0.32;                          // gentle vignette
      float n=fract(sin(dot(vUv*res+fract(time)*61.0,vec2(12.9898,78.233)))*43758.5453);
      gl_FragColor.rgb+=(n-0.5)/255.0;                                // dither away banding
    }`,
  depthTest:false, depthWrite:false
});

// ---------- render targets ----------
let rtScene=null;
const pyramid=[];                     // [{a,b}] at 1/2, 1/4, 1/8 of the frame
let rtRays=null;
function makeRTs(){
  if(rtScene){ rtScene.dispose(); rtRays.dispose(); for(const l of pyramid){l.a.dispose();l.b.dispose();} }
  pyramid.length=0;
  const w=Math.max(8,Math.floor(W*DPR)), h=Math.max(8,Math.floor(H*DPR));
  const hdr={type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
             depthBuffer:false};
  rtScene=new THREE.WebGLRenderTarget(w,h,Object.assign({},hdr,{depthBuffer:true,samples:Quality.spec.msaa,
    format:THREE.RGBFormat,type:THREE.UnsignedInt101111Type}));
  for(let i=1;i<=3;i++){
    const lw=Math.max(4,w>>i), lh=Math.max(4,h>>i);
    pyramid.push({a:new THREE.WebGLRenderTarget(lw,lh,hdr), b:new THREE.WebGLRenderTarget(lw,lh,hdr)});
  }
  // nothing reads the scene's depth afterwards, so do not pay to resolve it
  rtScene.resolveDepthBuffer=false;
  rtRays=new THREE.WebGLRenderTarget(Math.max(4,w>>2),Math.max(4,h>>2),hdr);
  compMat.uniforms.res.value.set(w,h);
}
window.addEventListener("resize",makeRTs);
Quality.onChange(makeRTs);           // builds them the first time, too

function quadPass(mat,target){
  postQuad.material=mat;
  renderer.setRenderTarget(target);
  renderer.render(postScene,postCam);
}
function blur(level){
  blurMat.uniforms.texel.value.set(1/level.a.width,1/level.a.height);
  blurMat.uniforms.tex.value=level.a.texture; blurMat.uniforms.dir.value.set(1,0); quadPass(blurMat,level.b);
  blurMat.uniforms.tex.value=level.b.texture; blurMat.uniforms.dir.value.set(0,1); quadPass(blurMat,level.a);
}

const _sunV=new THREE.Vector3();
/** Render the world and an optional near-field overlay, then post-process the lot. */
function renderPost(overlay){
  renderComposite(rtScene,overlay);

  // bright pass into the top of the pyramid
  brightMat.uniforms.tex.value=rtScene.texture;
  quadPass(brightMat,pyramid[0].a);

  // the rays read the unblurred bright pass, so take them before blurring it
  _sunV.set(P.x+SUNDIR.x*4000,SUNDIR.y*4000,P.z+SUNDIR.z*4000).project(camera);
  let sI=0,su=0.5,sv=0.5;
  if(_sunV.z<1){
    su=_sunV.x*0.5+0.5; sv=_sunV.y*0.5+0.5;
    const d=Math.hypot(su-0.5,sv-0.5);
    sI=Math.max(0,1-d*1.4)*(Game.weather===2?0.2:1)*Sun.ray;
  }
  raysMat.uniforms.tex.value=pyramid[0].a.texture;
  raysMat.uniforms.sunUv.value.set(su,sv);
  raysMat.uniforms.strength.value=sI;
  quadPass(raysMat,rtRays);

  // blur, then step down the pyramid
  blur(pyramid[0]);
  for(let i=1;i<pyramid.length;i++){
    copyMat.uniforms.tex.value=pyramid[i-1].a.texture;
    quadPass(copyMat,pyramid[i].a);
    blur(pyramid[i]);
  }

  const u=compMat.uniforms;
  u.base.value=rtScene.texture;
  u.b1.value=pyramid[0].a.texture; u.b2.value=pyramid[1].a.texture; u.b3.value=pyramid[2].a.texture;
  u.rays.value=rtRays.texture;
  u.time.value=performance.now()*0.001;
  quadPass(compMat,null);
}

// ---------- the world with a near-field overlay (the cockpit) ----------
// The overlay has its own camera and depth range — a strut 30 cm from the eye
// and a hill 3 km away cannot share one depth buffer's precision — so it is
// drawn after the world, over a cleared depth buffer, into the same colour.
// Each scene's shadow maps are drawn once, on its own pass.
function renderComposite(target,overlay){
  renderer.setRenderTarget(target);
  renderer.render(scene,camera);
  if(!overlay) return;
  const auto=renderer.autoClear;
  renderer.autoClear=false;
  renderer.clearDepth();
  renderer.render(overlay.scene,overlay.camera);
  renderer.autoClear=auto;
}

export { renderComposite, renderPost, rtScene };

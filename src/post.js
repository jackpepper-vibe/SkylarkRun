// Skylark Run — post-processing.
//
// Bloom and god rays built from core three only: no EffectComposer and no
// extra passes shipped. The bright pass, both blur directions and the radial
// streak all run through one full-screen quad, cheap enough to leave on for a
// phone — and the same rig Rotor Run uses.
/* global THREE */
import { DPR, H, W, camera, renderer, scene } from './view.js';
import { Game, P } from './state.js';
import { SUNDIR, Sun } from './sun.js';

// ---------- post-processing: hand-rolled bloom + god rays (core three only) ----------
const postCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const postScene=new THREE.Scene();
const postQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),null);
postScene.add(postQuad);
const PVS="varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}";
const brightMat=new THREE.ShaderMaterial({
  uniforms:{tex:{value:null},th:{value:0.72}},
  vertexShader:PVS,fragmentShader:[
    "varying vec2 vUv;uniform sampler2D tex;uniform float th;",
    "void main(){",
    "  vec3 c=texture2D(tex,vUv).rgb;",
    "  float l=dot(c,vec3(.299,.587,.114));",
    "  gl_FragColor=vec4(c*smoothstep(th,th+.30,l),1.);",
    "}"].join("\n"),depthTest:false,depthWrite:false});
const blurMat=new THREE.ShaderMaterial({
  uniforms:{tex:{value:null},dir:{value:new THREE.Vector2(1,0)},texel:{value:new THREE.Vector2()}},
  vertexShader:PVS,fragmentShader:[
    "varying vec2 vUv;uniform sampler2D tex;uniform vec2 dir,texel;",
    "void main(){",
    "  vec2 o=dir*texel;",
    "  vec3 c=texture2D(tex,vUv).rgb*.227;",
    "  c+=(texture2D(tex,vUv+o*1.384).rgb+texture2D(tex,vUv-o*1.384).rgb)*.316;",
    "  c+=(texture2D(tex,vUv+o*3.230).rgb+texture2D(tex,vUv-o*3.230).rgb)*.070;",
    "  gl_FragColor=vec4(c,1.);",
    "}"].join("\n"),depthTest:false,depthWrite:false});
const raysMat=new THREE.ShaderMaterial({
  uniforms:{tex:{value:null},sunUv:{value:new THREE.Vector2(0.5,0.5)},strength:{value:0}},
  vertexShader:PVS,fragmentShader:[
    "varying vec2 vUv;uniform sampler2D tex;uniform vec2 sunUv;uniform float strength;",
    "void main(){",
    "  vec2 dv=(sunUv-vUv)*0.050;",
    "  vec2 uv=vUv; vec3 acc=vec3(0.0); float w=1.0,tot=0.0;",
    "  for(int i=0;i<14;i++){uv+=dv;acc+=texture2D(tex,uv).rgb*w;tot+=w;w*=0.88;}",
    "  gl_FragColor=vec4(acc/tot*strength,1.0);",
    "}"].join("\n"),depthTest:false,depthWrite:false});
const compMat=new THREE.ShaderMaterial({
  uniforms:{base:{value:null},bloom:{value:null},rays:{value:null},
    k:{value:0.62},kr:{value:0.7},time:{value:0}},
  vertexShader:PVS,fragmentShader:[
    "varying vec2 vUv;",
    "uniform sampler2D base,bloom,rays;",
    "uniform float k,kr,time;",
    "void main(){",
    "  vec2 cc=vUv-0.5;",
    "  float edge=dot(cc,cc)*4.0;",
    "  vec2 off=cc*0.005*edge;",                        // chromatic aberration at the edges
    "  vec3 c;",
    "  c.r=texture2D(base,vUv-off).r;",
    "  c.g=texture2D(base,vUv).g;",
    "  c.b=texture2D(base,vUv+off).b;",
    "  c+=texture2D(bloom,vUv).rgb*k+texture2D(rays,vUv).rgb*kr;",
    "  float l=dot(c,vec3(.299,.587,.114));",           // warm daylight grade
    "  c=mix(c,c*vec3(0.94,1.00,1.06),(1.0-smoothstep(0.0,0.5,l))*0.28);",
    "  c=mix(c,c*vec3(1.07,1.01,0.90),smoothstep(0.50,1.0,l)*0.34);",
    "  c=(c-0.5)*1.05+0.505;",
    "  float g=fract(sin(dot(vUv+fract(time),vec2(12.9898,78.233)))*43758.5453);",
    "  c+=(g-0.5)*0.022;",                              // fine grain
    "  c*=1.0-edge*0.10;",                              // gentle vignette
    "  gl_FragColor=vec4(pow(max(c,vec3(0.0)),vec3(0.4545)),1.0);",
    "}"].join("\n"),depthTest:false,depthWrite:false});
let rtScene=null,rtB=null,rtP=null,rtQ=null,rtR=null;
function makeRTs(){
  if(rtScene){rtScene.dispose();rtB.dispose();rtP.dispose();rtQ.dispose();rtR.dispose();}
  const w=Math.max(4,Math.floor(W*DPR)),h=Math.max(4,Math.floor(H*DPR));
  const pars={minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat};
  rtScene=(renderer.capabilities.isWebGL2&&THREE.WebGLMultisampleRenderTarget)
    ? new THREE.WebGLMultisampleRenderTarget(w,h,pars)
    : new THREE.WebGLRenderTarget(w,h,pars);
  rtB=new THREE.WebGLRenderTarget(w>>1,h>>1,pars);
  rtP=new THREE.WebGLRenderTarget(w>>2,h>>2,pars);
  rtQ=new THREE.WebGLRenderTarget(w>>2,h>>2,pars);
  rtR=new THREE.WebGLRenderTarget(w>>2,h>>2,pars);
}
makeRTs();
window.addEventListener("resize",makeRTs);
function quadPass(mat,target){
  postQuad.material=mat;
  renderer.setRenderTarget(target);
  renderer.render(postScene,postCam);
}
const _sunV=new THREE.Vector3();
function renderPost(){
  renderer.setRenderTarget(rtScene);
  renderer.render(scene,camera);
  brightMat.uniforms.tex.value=rtScene.texture;
  quadPass(brightMat,rtB);
  _sunV.set(P.x+SUNDIR.x*4000,SUNDIR.y*4000,P.z+SUNDIR.z*4000).project(camera);
  let sI=0,su=0.5,sv=0.5;
  if(_sunV.z<1){
    su=_sunV.x*0.5+0.5; sv=_sunV.y*0.5+0.5;
    const d=Math.hypot(su-0.5,sv-0.5);
    sI=Math.max(0,1-d*1.5)*(Game.weather===2?0.2:1)*Sun.ray;
  }
  raysMat.uniforms.tex.value=rtB.texture;
  raysMat.uniforms.sunUv.value.set(su,sv);
  raysMat.uniforms.strength.value=sI;
  quadPass(raysMat,rtR);
  blurMat.uniforms.texel.value.set(1/rtP.width,1/rtP.height);
  blurMat.uniforms.tex.value=rtB.texture; blurMat.uniforms.dir.value.set(1,0); quadPass(blurMat,rtP);
  blurMat.uniforms.tex.value=rtP.texture; blurMat.uniforms.dir.value.set(0,1); quadPass(blurMat,rtQ);
  blurMat.uniforms.tex.value=rtQ.texture; blurMat.uniforms.dir.value.set(1,0); quadPass(blurMat,rtP);
  blurMat.uniforms.tex.value=rtP.texture; blurMat.uniforms.dir.value.set(0,1); quadPass(blurMat,rtQ);
  compMat.uniforms.base.value=rtScene.texture;
  compMat.uniforms.bloom.value=rtQ.texture;
  compMat.uniforms.rays.value=rtR.texture;
  compMat.uniforms.time.value=performance.now()*0.001;
  quadPass(compMat,null);
}

export { renderPost, rtScene };

// Skylark Run — renderer, scene, camera and the two canvases.
//
// W, H and DPR are written only by resize(), which lives here, so every other
// module reads them as live bindings and sees the current size without a
// setter or a rename. The HUD is a plain 2D canvas laid over the GL one.
import * as THREE from 'three';
import './atmosphere.js';


// ---------- canvases / three ----------
const glc=document.getElementById("gl"), hudc=document.getElementById("hud");
const hctx=hudc.getContext("2d");
let W=0,H=0,DPR=1;
const renderer=new THREE.WebGLRenderer({canvas:glc,antialias:true});
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.0;
renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();
// The Fog object only switches the fog chunks on for every material; what they
// compute is the height haze in atmosphere.js, which ignores near and far.
scene.fog=new THREE.Fog(0xbcd8ee,1,2);
const camera=new THREE.PerspectiveCamera(72,1,0.5,9000);
camera.rotation.order="YXZ";
function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);
  W=window.innerWidth;H=window.innerHeight;
  renderer.setPixelRatio(DPR); renderer.setSize(W,H);
  camera.aspect=W/H; camera.updateProjectionMatrix();
  hudc.width=W*DPR; hudc.height=H*DPR;
  hudc.style.width=W+"px"; hudc.style.height=H+"px";
  hctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener("resize",resize); resize();

export { DPR, H, W, camera, hctx, renderer, scene };

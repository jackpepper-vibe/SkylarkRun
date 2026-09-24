// Skylark Run — small pure helpers.
//
// Nothing in here reads or writes game state, which is what makes it safe to
// share between the engine, the craft and the worlds.
import * as THREE from 'three';
import { hctx } from './view.js';

export function hash(n){let x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);}
export function hash2(x,z){let v=Math.sin(x*127.1+z*311.7)*43758.5453;return v-Math.floor(v);}
export function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296;}}
export function clamp(v,a,b){return v<a?a:(v>b?b:v);}
export function lerp(a,b,k){return a+(b-a)*k;}
export function smooth(k){return k*k*(3-2*k);}
export function vnoise(x,z){
  const xi=Math.floor(x), zi=Math.floor(z);
  const u=smooth(x-xi), v=smooth(z-zi);
  const a=hash2(xi,zi), b=hash2(xi+1,zi), c=hash2(xi,zi+1), d=hash2(xi+1,zi+1);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
/**
 * Tileable value noise: a random lattice `per` cells square that wraps, so a
 * texture built from it repeats without a seam. Returns f(x, y) over lattice
 * units, smoothly interpolated.
 */
export function tileableNoise(per,seed){
  const a=new Float32Array(per*per);
  const r=mulberry32(seed);
  for(let i=0;i<a.length;i++) a[i]=r();
  const at=(i,j)=>a[(((j%per)+per)%per)*per+(((i%per)+per)%per)];
  return (x,y)=>{
    const xi=Math.floor(x);
    const yi=Math.floor(y);
    const u=smooth(x-xi);
    const v=smooth(y-yi);
    return lerp(lerp(at(xi,yi),at(xi+1,yi),u),lerp(at(xi,yi+1),at(xi+1,yi+1),u),v);
  };
}
export function lineGeo(arr){
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(arr),3));
  return g;
}
export function shade(hex,amt){
  const c=new THREE.Color(hex);
  c.r=clamp(c.r+amt,0,1); c.g=clamp(c.g+amt,0,1); c.b=clamp(c.b+amt,0,1);
  return "#"+c.getHexString();
}
export function midiF(m){return 440*Math.pow(2,(m-69)/12);}
export function roundedPoly(pts,r){
  hctx.beginPath();
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length], c=pts[(i+2)%pts.length];
    const v1=[a[0]-b[0],a[1]-b[1]], v2=[c[0]-b[0],c[1]-b[1]];
    const l1=Math.hypot(v1[0],v1[1])||1, l2=Math.hypot(v2[0],v2[1])||1;
    const rr=Math.min(r,l1/2,l2/2);
    const p1=[b[0]+v1[0]/l1*rr, b[1]+v1[1]/l1*rr];
    const p2=[b[0]+v2[0]/l2*rr, b[1]+v2[1]/l2*rr];
    if(i===0) hctx.moveTo(p1[0],p1[1]); else hctx.lineTo(p1[0],p1[1]);
    hctx.quadraticCurveTo(b[0],b[1],p2[0],p2[1]);
  }
  hctx.closePath();
}
export function esc(t){
  return String(t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",
    '"':"&quot;","'":"&#39;"}[c]));
}
export function ordinal(n){
  const s=["th","st","nd","rd"], v=n%100;
  return n+(s[(v-20)%10]||s[v]||s[0]);
}

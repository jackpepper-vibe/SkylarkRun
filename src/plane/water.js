// Skylark — lakes and reservoirs.
//
// One sheet at the theme's water level; wherever the land dips below it you
// get a lake. The surface is a shader rather than a tiled picture of water:
// two layers of ripple normals drift across each other, the sky is reflected
// through a Fresnel term — dark and clear looking down, a sheet of sky toward
// the far shore — and the sun lays a glittering path across it, bright enough
// to bloom. The reflected sky is evaluated with the dome's own gradient and
// the shared haze, so the water always agrees with the sky above it.
import * as THREE from 'three';
import { scene } from '../view.js';
import { Atmosphere } from '../atmosphere.js';
import { tileableNoise } from '../util.js';
import { Sky } from './sky.js';

/** Ripple normals from a tileable height field, packed as RG. */
function makeRippleNormals(){
  const N=256, img=new Uint8Array(N*N*4);
  const o1=tileableNoise(16,401), o2=tileableNoise(32,409), o3=tileableNoise(64,419);
  const h=(x,y)=>o1(x*16/N,y*16/N)*0.55+o2(x*32/N,y*32/N)*0.30+o3(x*64/N,y*64/N)*0.15;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const dx=(h(x+1,y)-h(x-1,y))*6.0, dy=(h(x,y+1)-h(x,y-1))*6.0;
    const inv=1/Math.hypot(dx,dy,1);
    const o=(y*N+x)*4;
    img[o]=Math.round((-dx*inv*0.5+0.5)*255);
    img[o+1]=Math.round((-dy*inv*0.5+0.5)*255);
    img[o+2]=Math.round((inv*0.5+0.5)*255);
    img[o+3]=255;
  }
  const t=new THREE.DataTexture(img,N,N,THREE.RGBAFormat,THREE.UnsignedByteType);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.magFilter=THREE.LinearFilter; t.minFilter=THREE.LinearMipmapLinearFilter;
  t.generateMipmaps=true;
  t.needsUpdate=true;
  return t;
}

const uniforms=Object.assign({
  ripples:{value:makeRippleNormals()},
  time:{value:0},
  deep:{value:new THREE.Color("#12303a")},
  zenith:Sky.uniforms.zenith,
  horizon:Sky.uniforms.horizon,
}, Atmosphere.uniforms);

const material=new THREE.ShaderMaterial({
  uniforms,
  vertexShader:`
    varying vec3 vWorld;
    void main(){
      vec4 w=modelMatrix*vec4(position,1.0);
      vWorld=w.xyz;
      gl_Position=projectionMatrix*viewMatrix*w;
    }`,
  fragmentShader:`
    uniform sampler2D ripples;
    uniform float time;
    uniform vec3 deep, zenith, horizon;
    varying vec3 vWorld;
    ${Atmosphere.glsl}
    vec3 skyAlong(vec3 r){
      vec3 c=mix(horizon,zenith,pow(max(r.y,0.0),0.42));
      return mix(c,hazeInscatter(r),exp(-max(r.y,0.0)*14.0));
    }
    void main(){
      vec3 toEye=cameraPosition-vWorld;
      float dist=length(toEye);
      vec3 v=toEye/dist;
      vec2 p=vWorld.xz;
      vec2 n1=texture2D(ripples,p*0.011+time*vec2(0.009,0.005)).rg*2.0-1.0;
      vec2 n2=texture2D(ripples,p*0.029+time*vec2(-0.006,0.011)).rg*2.0-1.0;
      // ripples flatten with distance, as they do, and so the far water cannot sparkle into noise
      float k=mix(0.15,0.035,smoothstep(80.0,1800.0,dist));
      vec3 n=normalize(vec3((n1.x+n2.x)*k,1.0,(n1.y+n2.y)*k));
      vec3 r=reflect(-v,n);
      r.y=abs(r.y);
      float fres=0.02+0.98*pow(1.0-max(dot(n,v),0.0),5.0);
      vec3 body=deep*(0.55+0.45*hazeColor);
      vec3 col=mix(body,skyAlong(r)*0.92,fres);
      // the sun's path: a hard glitter and a softer sheen round it
      float mu=max(dot(r,hazeSunDir),0.0);
      col+=hazeSun*(pow(mu,900.0)*40.0+pow(mu,80.0)*0.8);
      col=hazeApply(col,vWorld);
      gl_FragColor=vec4(col,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  fog:false,
});

const SNAP=200;
const mesh=new THREE.Mesh(new THREE.PlaneGeometry(6400,6400),material);
mesh.rotation.x=-Math.PI/2;
mesh.receiveShadow=false;
scene.add(mesh);

export const Water={
  mesh,
  /** Keep the sheet under the aircraft, at the theme's water level. */
  follow(x,z,level,t){
    mesh.position.set(Math.round(x/SNAP)*SNAP, level, Math.round(z/SNAP)*SNAP);
    uniforms.time.value=t*0.001;
  }
};

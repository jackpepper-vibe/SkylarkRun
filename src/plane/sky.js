// Skylark — lights, the sky dome and the time of day.
//
// The plane's sky, loaded only with the plane. It adds daylight to the shared
// scene, so the city must never pull it in.
//
// Every sector shifts the sun, so the whole palette — light colours, the air,
// the dome and the sun's glow — is driven from one table of times of day
// rather than set per scene. The dome is a shader that evaluates the same haze
// model as every fogged material (see atmosphere.js), so at the horizon the
// sky is exactly the colour the land fades into.
import * as THREE from 'three';
import { SUNDIR } from '../sun.js';
import { scene } from '../view.js';
import { Atmosphere } from '../atmosphere.js';
import { Clouds } from '../clouds.js';

// ---------- lights ----------
// Intensities in the table are in the old, pre-physical units; the physical
// light model divides diffuse by pi, so they are scaled back up where applied.
const hemiLight=new THREE.HemisphereLight(0xbcd8ee,0x4a5a34,0.95*Math.PI);
scene.add(hemiLight);
const sunLight=new THREE.DirectionalLight(0xfff2d0,1.35*Math.PI);
sunLight.position.set(700,900,-900);
scene.add(sunLight);
scene.add(sunLight.target);

// ---------- the sun's shadow ----------
// One map, 760 m square, laid over the ground ahead of the aircraft where
// shadows are big enough to read; beyond it the contact shade under each
// object carries on. The box is snapped to whole shadow texels in the light's
// own frame, so as it slides with the aircraft the shadow edges hold still
// instead of crawling.
/** The shadow box: its size, map resolution and how far ahead it is centred. */
const SHADOW={ SIZE:760, RES:2048, AHEAD:260 };
const SHADOW_SIZE=SHADOW.SIZE, SHADOW_RES=SHADOW.RES, SHADOW_AHEAD=SHADOW.AHEAD;
sunLight.castShadow=true;
sunLight.shadow.mapSize.set(SHADOW_RES,SHADOW_RES);
{
  const c=sunLight.shadow.camera;
  c.left=-SHADOW_SIZE/2; c.right=SHADOW_SIZE/2; c.top=SHADOW_SIZE/2; c.bottom=-SHADOW_SIZE/2;
  c.near=10; c.far=4000;
  c.updateProjectionMatrix();
}
sunLight.shadow.bias=-0.0004;
sunLight.shadow.normalBias=0.6;
sunLight.shadow.radius=2.5;
const _right=new THREE.Vector3(), _up=new THREE.Vector3(), _ctr=new THREE.Vector3();
const _sun=new THREE.Color(), _top=new THREE.Color(), _low=new THREE.Color(), _hz=new THREE.Color();
const fillLight=new THREE.DirectionalLight(0x88a8d8,0.22*Math.PI);
fillLight.position.set(-600,300,700);
scene.add(fillLight);

// ---------- time of day: every sector shifts the sun ----------
//   zenith / horizon   the clear sky overhead and just above the haze
//   haze               the air's colour with nothing behind it (horizon, fog)
//   glow               the sun's in-scatter colour through that air
//   density / falloff  haze per metre at the ground, and its scale height
const TODS=[
 {name:"MORNING",  zenith:"#3a74c2", horizon:"#a9cdea", haze:"#c9dcec", glow:"#ffe2b0",
  density:0.00040, falloff:420, sunC:0xfff0d6, sunI:1.55, hemiS:0xb4d0ec, hemiG:0x56603c, hemiI:0.62,
  exp:1.00, dir:[0.55,0.42,-0.72], ray:0.70},
 {name:"MIDDAY",   zenith:"#2a68c0", horizon:"#9ec6ea", haze:"#cfe0ee", glow:"#fff4dc",
  density:0.00032, falloff:460, sunC:0xffffff, sunI:1.70, hemiS:0xc4dcf2, hemiG:0x5e6a40, hemiI:0.66,
  exp:0.96, dir:[0.20,0.86,-0.47], ray:0.45},
 {name:"AFTERNOON",zenith:"#3470b8", horizon:"#b0cce4", haze:"#d6dcdc", glow:"#ffdcaa",
  density:0.00044, falloff:420, sunC:0xffecc8, sunI:1.55, hemiS:0xbccce0, hemiG:0x58603c, hemiI:0.60,
  exp:1.00, dir:[-0.52,0.50,-0.69], ray:0.75},
 {name:"GOLDEN",   zenith:"#2c5896", horizon:"#d8b690", haze:"#e2c6a0", glow:"#ffb468",
  density:0.00052, falloff:380, sunC:0xffc88a, sunI:1.45, hemiS:0xb8b0a8, hemiG:0x4e4430, hemiI:0.55,
  exp:1.04, dir:[-0.72,0.18,-0.67], ray:0.95},
];

// ---------- sky dome ----------
const skyUniforms=Object.assign({
  zenith:{value:new THREE.Color()}, horizon:{value:new THREE.Color()},
  time:{value:0}, cloudCover:{value:0.5}
}, Atmosphere.uniforms);

const skyMat=new THREE.ShaderMaterial({
  uniforms:skyUniforms,
  vertexShader:`
    varying vec3 vDir;
    void main(){
      vDir=position;
      vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      gl_Position=p.xyww;                                   // pinned to the far plane
    }`,
  fragmentShader:`
    varying vec3 vDir;
    uniform vec3 zenith,horizon;
    uniform float time,cloudCover;
    ${Atmosphere.glsl}
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vn(vec2 p){
      vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);
    }
    float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=vn(p)*a; p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
    void main(){
      vec3 d=normalize(vDir);
      float up=max(d.y,0.0);
      vec3 col=mix(horizon,zenith,pow(up,0.42));
      // high cirrus, drawn on a plane far overhead and stretched along the wind
      if(d.y>0.0){
        vec2 q=d.xz/(d.y+0.06);
        vec2 w=vec2(q.x*0.9,q.y*2.6)+vec2(time*0.004,0.0);
        float c=fbm(w*1.3)*0.7+fbm(w*4.1+3.0)*0.3;
        float m=smoothstep(0.62-cloudCover*0.18,0.95,c)*smoothstep(0.02,0.30,d.y);
        vec3 lit=mix(horizon,vec3(1.0),0.75)+hazeSun*0.20;
        col=mix(col,lit,m*0.55);
      }
      // The gradient already is the air overhead; only toward the horizon does
      // the sky thicken into the haze the land fades into. At the horizon it
      // is exactly hazeInscatter, which is what distant geometry converges on.
      float band=exp(-max(d.y,0.0)*14.0);
      col=mix(col,hazeInscatter(d),band);
      // the sun: a hot disc and a tight corona, both well over white so they bloom
      float mu=dot(d,hazeSunDir);
      col+=hazeSun*(smoothstep(0.99955,0.99975,mu)*38.0+pow(max(mu,0.0),900.0)*5.0+pow(max(mu,0.0),90.0)*0.5);
      gl_FragColor=vec4(col,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  side:THREE.BackSide, depthWrite:false, depthTest:true, fog:false
});
const sky=new THREE.Mesh(new THREE.SphereGeometry(5200,48,24),skyMat);
sky.renderOrder=-2;
sky.frustumCulled=false;
scene.add(sky);

/** The sky and lights for one time of day. */
const Sky={
  mesh:sky,
  uniforms:skyUniforms,
  apply(td){
    skyUniforms.zenith.value.set(td.zenith);
    skyUniforms.horizon.value.set(td.horizon);
    Atmosphere.set({haze:td.haze, sun:td.glow, density:td.density, falloff:td.falloff});
    sunLight.color.set(td.sunC); sunLight.intensity=td.sunI*Math.PI;
    hemiLight.color.set(td.hemiS); hemiLight.groundColor.set(td.hemiG);
    hemiLight.intensity=td.hemiI*Math.PI;
    // the clouds are lit by the same sun and sky, in their own units
    _sun.set(td.sunC).multiplyScalar(td.sunI*0.72);
    _top.set(td.zenith).lerp(_hz.set(td.haze),0.35).multiplyScalar(1.25);
    _low.set(td.haze).multiplyScalar(0.72);
    Clouds.setLight(_sun,_top,_low);
  },
  /** Thicker weather means more cirrus and a greyer dome. */
  setCover(k){ skyUniforms.cloudCover.value=k; },
  /** The dome and the sun's light ride with the aircraft. */
  follow(x,y,z,t){
    sky.position.set(x,y,z);
    skyUniforms.time.value=t*0.001;
    // centre the shadow box ahead, then snap it to the texel grid in light space
    _ctr.set(x,0,z-SHADOW_AHEAD);
    _right.set(0,1,0).cross(SUNDIR).normalize();
    _up.copy(SUNDIR).cross(_right).normalize();
    const texel=SHADOW_SIZE/SHADOW_RES;
    const u=Math.round(_ctr.dot(_right)/texel)*texel, v=Math.round(_ctr.dot(_up)/texel)*texel;
    const w=_ctr.dot(SUNDIR);
    _ctr.copy(_right).multiplyScalar(u).addScaledVector(_up,v).addScaledVector(SUNDIR,w);
    sunLight.target.position.copy(_ctr);
    sunLight.position.copy(_ctr).addScaledVector(SUNDIR,1800);
  }
};

export { SHADOW, TODS, Sky, hemiLight, sunLight };

// Skylark Run — the atmosphere: one haze for everything in the scene.
//
// Distance fog in three is a flat linear ramp to one colour. Real air thins
// with height and glows toward the sun, and it is what makes distant hills go
// blue while the sky at the horizon goes pale. This module replaces three's fog
// shader chunks with a height-fog integral plus a sun in-scatter term, so every
// built-in material that has `fog` on — terrain, trees, sprites, lines,
// points — is hazed by the same model, and the sky dome evaluates the very same
// functions, so land and sky meet at the horizon without a seam.
//
// The parameters are shared uniform objects. Built-in materials receive them
// through a default onBeforeCompile installed on Material.prototype; a material
// that needs its own onBeforeCompile calls Atmosphere.inject(shader) itself.
// Custom ShaderMaterials include Atmosphere.glsl and spread Atmosphere.uniforms.
//
// What the world sets, per sector: the haze colour (what the air looks like
// with nothing behind it), the in-scatter colour (the sun's glow through it),
// the density at the ground and the height it halves over. Weather scales the
// density; the sun direction is the shared SUNDIR, read by reference.
import * as THREE from 'three';
import { SUNDIR } from './sun.js';

const uniforms={
  hazeColor:   {value:new THREE.Color(0xc6dcf0)},
  hazeSun:     {value:new THREE.Color(0xfff0cc)},
  hazeSunDir:  {value:SUNDIR},
  hazeDensity: {value:0.0006},
  hazeFalloff: {value:1/420},
  hazeBase:    {value:0},
};

/** The haze model, callable from any fragment shader that declares it. */
const glsl=`
uniform vec3 hazeColor;
uniform vec3 hazeSun;
uniform vec3 hazeSunDir;
uniform float hazeDensity;
uniform float hazeFalloff;
uniform float hazeBase;
// light scattered toward the eye along a view direction: the air's own colour
// plus a forward-scattering glow around the sun
vec3 hazeInscatter(vec3 dir){
  float mu=max(dot(dir,hazeSunDir),0.0);
  return hazeColor+hazeSun*(0.12*pow(mu,4.0)+0.40*pow(mu,24.0));
}
// transmittance through exponential height fog, integrated in closed form
float hazeTransmit(vec3 eye,vec3 dir,float dist){
  float a=hazeDensity*exp(-(eye.y-hazeBase)*hazeFalloff);
  float b=dir.y*hazeFalloff;
  float od=abs(b)>1e-5 ? a*(1.0-exp(-b*dist))/b : a*dist;
  return exp(-od);
}
vec3 hazeApply(vec3 col,vec3 worldPos){
  vec3 v=worldPos-cameraPosition;
  float d=length(v);
  vec3 dir=v/max(d,1e-3);
  return mix(hazeInscatter(dir),col,hazeTransmit(cameraPosition,dir,d));
}
`;

// Replace three's fog chunks. The world position is rebuilt from the view-space
// position every fogged shader already has — sprites and points included, which
// have no model-space `transformed` to work from.
THREE.ShaderChunk.fog_pars_vertex=`
#ifdef USE_FOG
  varying vec3 vHazeWorld;
#endif`;
THREE.ShaderChunk.fog_vertex=`
#ifdef USE_FOG
  vHazeWorld=cameraPosition+mvPosition.xyz*mat3(viewMatrix);
#endif`;
THREE.ShaderChunk.fog_pars_fragment=`
#ifdef USE_FOG
  varying vec3 vHazeWorld;
  ${glsl}
#endif`;
THREE.ShaderChunk.fog_fragment=`
#ifdef USE_FOG
  gl_FragColor.rgb=hazeApply(gl_FragColor.rgb,vHazeWorld);
#endif`;

function inject(shader){
  for(const k in uniforms) shader.uniforms[k]=uniforms[k];
}
// Every material gets the shared uniforms unless it brings its own hook.
THREE.Material.prototype.onBeforeCompile=function(shader){ inject(shader); };

const _c=new THREE.Color();
export const Atmosphere={
  uniforms,
  glsl,
  inject,
  weatherScale:1,
  baseDensity:0.0006,
  /** Set the air for a sector: colours as hex, density at ground level. */
  set({haze,sun,density,falloff}){
    uniforms.hazeColor.value.set(haze);
    uniforms.hazeSun.value.set(sun);
    this.baseDensity=density;
    if(falloff) uniforms.hazeFalloff.value=1/falloff;
    this.apply();
  },
  /** Showers and thermals thicken the air; clear days leave it alone. */
  setWeather(scale){ this.weatherScale=scale; this.apply(); },
  apply(){ uniforms.hazeDensity.value=this.baseDensity*this.weatherScale; },
  /** The ground level the density is measured from. */
  setBase(y){ uniforms.hazeBase.value=y; },
  /** The haze colour as a linear Color, for anything that must match it. */
  color(out){ return (out||_c).copy(uniforms.hazeColor.value); }
};

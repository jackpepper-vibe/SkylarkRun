// Skylark Run — weather and wind.
//
// A sector is clear, overcast, wet or gusty. Wind pushes the aircraft about
// and the rain is one recycled point cloud; both read their state from Game,
// so the cloud field and this module stay independent of each other.
import * as THREE from 'three';
import { scene } from './view.js';
import { Game, P } from './state.js';
import { setRain } from './audio.js';
import { Clouds, weatherCloudAlpha } from './clouds.js';

// ---------- weather ----------
const WEATHERS=["CLEAR","BREEZY","SHOWERS","THERMALS"];
const gDrops=[];                                  // droplets on the little windscreen
const RAIN_N=340;
const rain=(()=>{
  const pos=new Float32Array(RAIN_N*3);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(pos,3));
  const pts=new THREE.Points(geo,new THREE.PointsMaterial({color:0xdfe8f2,size:1.5,
    transparent:true,opacity:0.55,sizeAttenuation:true,depthWrite:false}));
  pts.visible=false; scene.add(pts);
  return pts;
})();
function resetDrop(arr,i,init){
  arr[i*3]  =P.x+(Math.random()-0.5)*280;
  arr[i*3+1]=P.y+(init?Math.random()*160-60:70+Math.random()*40);
  arr[i*3+2]=P.z-Math.random()*300+40;
}
function updateRain(dt){
  if(Game.weather!==2){ rain.visible=false; return; }
  rain.visible=true;
  const arr=rain.geometry.attributes.position.array;
  for(let i=0;i<RAIN_N;i++){
    arr[i*3+1]-=(150+P.speed*0.5)*dt;
    arr[i*3+2]+=P.speed*0.55*dt;
    if(arr[i*3+1]<P.y-90||arr[i*3+2]>P.z+40) resetDrop(arr,i,false);
  }
  rain.geometry.attributes.position.needsUpdate=true;
}
function applyWeather(lvl){
  Game.weather=lvl<3?0:[0,1,2,3,1,2,0,3][(lvl-3)%8];
  gDrops.length=0;
  Game.wind=0; Game.windTarget=0; Game.thermal=0;
  Game.nextGust=performance.now()+3000;
  const arr=rain.geometry.attributes.position.array;
  for(let i=0;i<RAIN_N;i++) resetDrop(arr,i,true);
  rain.geometry.attributes.position.needsUpdate=true;
  rain.visible=Game.weather===2;
  setRain(Game.weather===2);
  scene.fog.far=Game.weather===2?2400:(Game.weather===3?2900:3400);
  scene.fog.near=Game.weather===2?500:800;
  for(const c of Clouds.list) c.sp.material.opacity=(0.55+Math.random()*0.4)*weatherCloudAlpha();
}

export { WEATHERS, applyWeather, gDrops, updateRain };

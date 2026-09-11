// Skylark Run — control input.
//
// Three sources feed one reading: phone tilt, a touch drag, and the keyboard.
// readInput() returns { steer, pitch } in -1..1 and the flight code never has
// to know which device produced it — which is also what will let a helicopter
// reuse this untouched.
/* global THREE */
import { clamp } from './util.js';
import { S, Game } from './state.js';

// ---------- input (tilt + touch + keys) ----------

// Whether this device can actually tilt. Desktop browsers still define
// DeviceOrientationEvent even though no sensor will ever fire it, so asking
// whether the constructor exists is not enough — a laptop would be offered an
// "Enable tilt" button that could never do anything. Judge it on the kind of
// input the device really has instead.
// navigator.maxTouchPoints is no help here — desktop Chrome reports 10 — and
// neither is `ontouchstart`. A coarse primary pointer is the signal that
// actually separates a phone or tablet from a machine with a mouse, including
// touchscreen laptops, which have a fine pointer and no gyroscope.
const CAN_TILT=(function(){
  if(typeof DeviceOrientationEvent==="undefined")return false;
  if(!window.matchMedia)return false;
  return window.matchMedia("(pointer: coarse)").matches;
})();

// Pitch on the keyboard follows the joystick convention by default: pushing
// forward puts the nose down. Anyone who prefers the arrows to move the
// aeroplane the way they point can switch it back, and the choice sticks.
const INVERT_KEY="skylark-invert-pitch";
let invertPitch=true;
try{
  const saved=localStorage.getItem(INVERT_KEY);
  if(saved!==null)invertPitch=saved==="1";
}catch(e){/* storage blocked — fall back to the default */}
function setInvertPitch(on){
  invertPitch=!!on;
  try{localStorage.setItem(INVERT_KEY,invertPitch?"1":"0");}catch(e){}
}

let rawBeta=0,rawGamma=0,haveTilt=false,calB=0,calG=0,permState="unknown";
window.addEventListener("deviceorientation",e=>{
  if(e.beta===null)return;
  rawBeta=e.beta;rawGamma=e.gamma;haveTilt=true;
});
function calibrate(){calB=rawBeta;calG=rawGamma;}
function screenAngle(){
  if(screen.orientation&&typeof screen.orientation.angle==="number")return screen.orientation.angle;
  return(typeof window.orientation==="number")?window.orientation:0;
}
const keys={};
window.addEventListener("keydown",e=>keys[e.key.toLowerCase()]=true);
window.addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);
let touchActive=false,tSX=0,tSY=0,tDX=0,tDY=0;
window.addEventListener("touchstart",e=>{
  if(Game.state!==S.PLAY&&Game.state!==S.ROLLOUT&&Game.state!==S.TAKEOFF)return;
  touchActive=true;tSX=e.touches[0].clientX;tSY=e.touches[0].clientY;tDX=0;tDY=0;
},{passive:true});
window.addEventListener("touchmove",e=>{
  if(!touchActive)return;
  tDX=e.touches[0].clientX-tSX;tDY=e.touches[0].clientY-tSY;
},{passive:true});
window.addEventListener("touchend",()=>{touchActive=false;tDX=0;tDY=0;});
window.addEventListener("touchcancel",()=>{touchActive=false;tDX=0;tDY=0;});
function readInput(){
  let steer=0,pitch=0;
  if(haveTilt){
    const b=rawBeta-calB,g=rawGamma-calG,a=screenAngle();
    if(a===90){steer=b;pitch=-g;}
    else if(a===-90||a===270){steer=-b;pitch=g;}
    else{steer=g;pitch=-b;}
    const MAXT=20;
    steer=clamp(steer/MAXT,-1,1);
    pitch=clamp(pitch/MAXT,-1,1);
    const DZ=0.06;
    steer=Math.abs(steer)<DZ?0:steer;pitch=Math.abs(pitch)<DZ?0:pitch;
  }
  if(keys["arrowleft"]||keys["a"])steer=-1;
  if(keys["arrowright"]||keys["d"])steer=1;
  // Positive pitch raises the nose. Under joystick pitch, pushing the stick
  // forward (up / W) lowers it instead, and easing back (down / S) raises it —
  // which also keeps "ease back at Vr" literally true on the takeoff roll.
  if(keys["arrowup"]||keys["w"])pitch=invertPitch?-1:1;
  if(keys["arrowdown"]||keys["s"])pitch=invertPitch?1:-1;
  if(touchActive){
    steer=clamp(tDX/90,-1,1);
    pitch=clamp(-tDY/70,-1,1);
  }
  return{steer,pitch};
}

// invertPitch is exported for reading only: importers see the live value,
// and changes go through setInvertPitch so the choice is persisted.
export { CAN_TILT, readInput, calibrate, screenAngle, setInvertPitch,
         invertPitch, haveTilt, permState };

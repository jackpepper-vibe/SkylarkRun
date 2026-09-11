// Skylark Run — game code.
//
// Loaded as an ES module so the engine can be split into files. three.js is
// still the r128 global build from the CDN, so THREE is referenced as a global
// here rather than imported.
/* global THREE */
import { hash, hash2, mulberry32, clamp, lerp, smooth, vnoise, lineGeo,
         shade, midiF, hatBuf, roundedPoly, esc, ordinal } from './util.js';
import { Save, Net, renderBoard, cleanName, NAME_MAX } from './logbook.js';
import { LAT_CLAMP, VIEW, SPEED0, SPEED_MAX, SPEED_RAMP, MAX_VX, MAX_VY,
         MAX_Y, PR, MIN_CLEAR, CANOPY_H } from './config.js';
import { S, Game, TO, P, G, dents, popups, popup } from './state.js';
import { CAN_TILT, readInput, calibrate, screenAngle, setInvertPitch,
         invertPitch, haveTilt, permState } from './input.js';
import { obstacleBeep, resumeAudio, suspendAudio, setRain, deathSpiral, fuelBeep, initAudio, audioTick, chime, whoosh, crashSound, setMuted, thud, radioCall, muted } from './audio.js';
import { DPR, H, W, camera, hctx, renderer, scene } from './view.js';
import { SUNDIR, TODS, hemiLight, sky, skyTexs, sunGlow, sunLight } from './sky.js';
import { renderPost, rtScene } from './post.js';
import { Clouds, weatherCloudAlpha } from './clouds.js';
import { overlays, show, hideAll } from './overlays.js';
import { WEATHERS, applyWeather, gDrops, updateRain } from './weather.js';
import { applyTheme, Airfield, Fuel, Haz, Rings, Scatter, Shadows, TH, THEMES, Terrain, af, burst, bursts, clearanceH, coursePathX, groundH, isWood, onField, ridges, updateBursts } from './countryside.js';
import { crash, levelClear, splats, startDying, updateDying } from './damage.js';
import { drawHUD } from './hud.js';
"use strict";
/* ============================================================
   SKYLARK RUN — open-cockpit monoplane air racing in Three.js.
   Procedural heightfield countryside, farmland patchwork, ring
   course, Game.weather, and a full runway approach & landing at the
   end of every sector. Single file, no backend, no APIs.

   Systems are grouped as small managers with the same shape:
     build once -> reset(level) -> update(dt)
   Everything that scrolls is pooled and recycled; nothing is
   allocated per frame in the hot path.
   ============================================================ */

// ---------- palette ----------
const CREAM="#fbf4e2", BRASS="#d9a441", INK="#241c12",
      RED="#d2452f", GREENL="#5fbf74", SKYC="#9fd2f2";

// ---------- helpers ----------






// value noise on an integer lattice, smooth-interpolated




// ---------- landing ----------
function touchdown(){
  const sink=Math.max(0,-P.vy);
  const dx=Math.abs(P.x-af.x);
  const bank=Math.abs(P.roll);
  const deep=P.z<af.z+af.len*0.5-90;              // past the piano keys, not a threshold dive
  let bonus=0;
  if(sink<7&&dx<10&&bank<0.13&&deep){ bonus=1500; G.landLabel="GREASED IT +1500"; }
  else if(sink<13&&dx<20&&deep){      bonus=900;  G.landLabel="GOOD LANDING +900"; }
  else if(sink<19){                   bonus=400;  G.landLabel="FIRM LANDING +400"; }
  else{                                            // arrived rather than landed
    crash("HEAVY LANDING — GO AROUND");
    P.y=af.y+30; P.vy=18; P.speed=Math.max(P.speed,58);
    return;
  }
  G.score+=bonus;
  popup(G.landLabel);
  chime(1180); setTimeout(()=>chime(1480),120);
  burst(new THREE.Vector3(P.x-6,af.y+1,P.z-4),0xdcd2c0,1.1);
  burst(new THREE.Vector3(P.x+6,af.y+1,P.z-4),0xdcd2c0,1.1);
  af.phase=2; af.rollT=0;
  Game.state=S.ROLLOUT;
  P.y=af.y+2.4; P.vy=0;
}
function updateRollout(dt){
  const inp=readInput();
  // rudder authority bleeds away with speed, as it does on a real landing roll
  P.vx+=((inp.steer*(9+P.speed*0.30))-P.vx)*Math.min(1,dt*4.0);
  P.x+=P.vx*dt;
  // aerodynamic drag first, wheel brakes taking over as she slows: ~250 m of roll
  P.speed=Math.max(0,P.speed-(3.2+P.speed*0.070)*dt);
  P.pz=P.z;
  P.z-=P.speed*dt; P.dist+=P.speed*dt;
  P.y=af.y+2.4;
  P.roll*=Math.exp(-5*dt);
  af.rollT+=dt;
  Game.shake=Math.max(0,Game.shake-dt*2.2)+ (P.speed>10?0.010:0);   // rumble of the grass strip
  Game.flash=Math.max(0,Game.flash-dt*2.5);
  Terrain.update(); Scatter.update(); Clouds.update(); updateBursts();
  if(Math.abs(P.x-af.x)>af.wid*0.5+2){
    G.landLabel="GROUND LOOP — BONUS LOST";
    popup("GROUND LOOP"); crashSound(); Game.shake=1;
    levelClear(); return;
  }
  if(P.z<af.z-af.len*0.5){
    G.landLabel="RAN OFF THE END — BONUS LOST";
    popup("OVERRUN"); crashSound(); Game.shake=1;
    levelClear(); return;
  }
  if(P.speed<3.5){
    P.speed=0;
    popup("WHEELS STOPPED");
    levelClear();
  }
}

// ---------- take-off: full power, hold the centreline, rotate at Vr ----------
function updateTakeoff(dt){
  const inp=readInput();
  af.rollT+=dt;
  P.pz=P.z;
  if(!TO.lifted){
    // rudder holds the centreline; it bites harder as the tail comes up
    P.vx+=((inp.steer*(7+P.speed*0.26))-P.vx)*Math.min(1,dt*4.0);
    P.roll*=Math.exp(-4*dt);
    P.y=af.y+2.4; P.vy=0;
    Game.shake=Math.min(0.5,0.04+P.speed*0.0026);          // the strip drumming through the gear
  }else{
    TO.rotT+=dt;
    P.vy=Math.min(24,7+TO.rotT*15);                   // she unsticks, then climbs away
    P.y+=P.vy*dt;
    P.vx+=((inp.steer*34)-P.vx)*Math.min(1,dt*3.5);
    P.roll+=((inp.steer*0.26)-P.roll)*Math.min(1,dt*3.0);
    Game.shake=Math.max(0,Game.shake-dt*2.0);
  }
  P.x+=P.vx*dt;
  // full throttle; on the ground she will not run away much past Vr
  const vMax=TO.lifted?SPEED_MAX:TO.vr*1.18;
  P.speed=Math.min(vMax,P.speed+Math.max(2.4,11.5*(1-P.speed/(SPEED_MAX*1.05)))*dt);
  P.z-=P.speed*dt;                                    // the ground roll is not sector distance
  Game.flash=Math.max(0,Game.flash-dt*2.5);
  Terrain.update(); Scatter.update(); Clouds.update(); updateBursts();

  const runLeft=P.z-(af.z-af.len*0.5);
  if(!TO.lifted){
    if(Math.abs(P.x-af.x)>af.wid*0.5+2){
      crash("OFF THE STRIP");
      TO.lifted=true; TO.rotT=0; P.vy=14; P.y=af.y+6; return;
    }
    if(runLeft<40){
      crash("OVERRAN THE STRIP");
      TO.lifted=true; TO.rotT=0; P.vy=14; P.y=af.y+6; return;
    }
    // rotate when the pilot eases back at Vr; past Vr she wants to fly anyway
    if(P.speed>=TO.vr) TO.vrT+=dt;
    if(P.speed>=TO.vr&&(inp.pitch>0.22||TO.vrT>2.0||runLeft<260)){
      TO.lifted=true; TO.rotT=0;
      popup("ROTATE"); chime(880);
      burst(new THREE.Vector3(P.x,af.y+1,P.z+6),0xd8d0b8,1.0);
    }
  }else if(P.y>af.y+45){                              // clear of the strip: the sector begins
    Game.state=S.PLAY;
    af.phase=5;
    P.vy=Math.min(P.vy,MAX_VY*0.55);
    popup("AIRBORNE — SECTOR "+G.lvl+" RUNNING");
  }
}

// ---------- main update ----------
function update(dt,t){
  const inp=readInput();
  P.vx+=((inp.steer*MAX_VX)-P.vx)*Math.min(1,dt*5.0);
  P.vy+=((inp.pitch*MAX_VY)-P.vy)*Math.min(1,dt*5.0);
  P.roll+=((inp.steer*0.42)-P.roll)*Math.min(1,dt*4.0);
  P.pz=P.z;

  // weather: gusts push you sideways, thermals lift you
  if(Game.weather===1||Game.weather===2){
    const nowW=performance.now();
    if(nowW>Game.nextGust){
      Game.windTarget=(Math.random()<0.5?-1:1)*(16+Math.random()*20);
      popup("GUST "+(Game.windTarget>0?"→":"←"));
      Game.gustEnd=nowW+2400;
      Game.nextGust=nowW+4200+Math.random()*4200;
    }
    if(nowW>Game.gustEnd)Game.windTarget=0;
  }else Game.windTarget=0;
  if(Game.weather===3){
    Game.thermal=Math.sin(P.z*0.0016)*Math.cos(P.x*0.0021)*16;
  }else Game.thermal=0;
  Game.wind+=(Game.windTarget-Game.wind)*Math.min(1,dt*2);

  const cx=coursePathX(P.z);
  P.x=clamp(P.x+(P.vx+Game.wind)*dt, cx-LAT_CLAMP, cx+LAT_CLAMP);
  P.y=clamp(P.y+(P.vy+Game.thermal)*dt, -50, MAX_Y+60);
  if(!af.active||af.phase!==1) P.speed=Math.min(SPEED_MAX,P.speed+SPEED_RAMP*dt);
  P.z-=P.speed*dt; P.dist+=P.speed*dt;
  if(P.invuln>0)P.invuln-=dt;
  Game.shake=Math.max(0,Game.shake-dt*2.2); Game.flash=Math.max(0,Game.flash-dt*2.5);

  // fuel is the clock you fly against
  G.fuel-=(1.35+0.14*(G.lvl-1))*dt;
  if(G.fuel<=0){G.fuel=0;startDying("Dead <span>stick</span>","tanks dry — engine out");return;}
  if(G.fuel<20&&performance.now()-Game.lastFuelBeep>1200){
    if(fuelBeep()) Game.lastFuelBeep=performance.now();
  }

  // scoring: distance trickle plus a bonus for hedge-hopping
  G.score+=dt*P.speed*0.14;
  const agl=P.y-groundH(P.x,P.z);
  if(agl<45&&!af.active) G.score+=dt*22;

  Rings.update(dt);
  Fuel.update(dt);
  Haz.update(dt);
  updateRain(dt);
  updateBursts();
  Terrain.update();
  Scatter.update();
  Clouds.update();

  // whiteout in the cloud base — height is not free
  const over=P.y-(MAX_Y-40);
  Game.whiteout=clamp(over/55,0,1)*(Game.weather===2?1:0.85);

  // climbing away from the departure strip: let it go once it is behind us
  // wait until the grading blend has already faded out, so nothing shifts underneath us
  if(af.active&&af.phase===5&&P.z<af.z-af.len*0.5-560) Airfield.deactivate();

  // the sector finale
  if(!af.active&&P.dist>G.levelEnd-4300) Airfield.reveal();
  if(af.active&&af.phase===6){
    const toThresh=P.z-(af.z+af.len*0.5);
    if(!af.seen&&toThresh<2400){ af.seen=true; popup("AIRFIELD AHEAD"); }
    if(toThresh<1100) Airfield.beginApproach();
  }
  if(af.active&&af.phase===1){
    P.speed+=(54-P.speed)*Math.min(1,dt*0.7);          // throttle back for the approach
    if(P.z<af.z-af.len*0.5-60){                        // flew the length of it and never landed
      G.landLabel="MISSED APPROACH — NO BONUS";
      popup("GO AROUND — NO BONUS");
      af.phase=3;
      levelClear(); return;
    }
    if(onField(P.x,P.z)){
      if(P.y-af.y<=2.6){
        const onStrip=Math.abs(P.x-af.x)<af.wid*0.5+2&&
                      P.z<af.z+af.len*0.5+6&&P.z>af.z-af.len*0.5;
        if(onStrip){ touchdown(); return; }
        crash("LANDED SHORT"); P.y=af.y+26; P.vy=16; return;
      }
    }
  }

  // terrain, treetops and the ceiling
  if(P.invuln<=0&&!(af.active&&(af.phase===1||af.phase===5)&&onField(P.x,P.z))){
    if(P.y<clearanceH(P.x,P.z)+MIN_CLEAR){
      const wood=isWood(P.x,P.z);
      crash(wood?"INTO THE TREES":"HIT THE DECK");
      P.y=clearanceH(P.x,P.z)+34; P.vy=Math.max(P.vy,14);
      return;
    }
  }

  // proximity warning: rising ground ahead
  if(!Game.warnObst){
    for(let d=120;d<=460;d+=85){
      if(clearanceH(P.x,P.z-d)+34>P.y){ Game.warnObst=true; break; }
    }
  }
  if(Game.warnObst&&performance.now()-Game.lastBeep>460){
    if(obstacleBeep()) Game.lastBeep=performance.now();
  }
}

// ---------- world reset ----------
function resetWorld(){
  P.x=0;P.y=140;P.z=0;P.pz=0;P.vx=0;P.vy=0;P.roll=0;
  P.speed=SPEED0;P.lives=3;P.invuln=0;P.dist=0;
  Game.shake=0;Game.flash=0;Game.whiteout=0;
  dents.length=0;splats.length=0;popups.length=0;gDrops.length=0;
  G.score=0;G.combo=0;G.bestCombo=0;G.fuel=100;G.lvl=1;G.levelEnd=5400;
  G.rings=0;G.ringsHit=0;G.gold=0;G.goldHit=0;G.landLabel="";
  af.active=false;af.phase=0;af.group.visible=false;
  applyTheme(1);
  Airfield.departure();          // sets P to the holding point; do this before the world
  Terrain.reset();
  Scatter.reset();
  Clouds.reset();
  Rings.reset();
  Fuel.reset();
  Haz.reset();
  clearOfDeparture();
  for(const b of bursts){b.active=false;b.sp.visible=false;}
  popup("SECTOR 1: "+THEMES[Game.curTheme].name+" · "+TODS[Game.curTod].name);
  popup("LINE UP — FULL POWER");
}
// nothing spawns over the departure strip or its climb-out
function clearOfDeparture(){
  const clear=af.z-af.len*0.5-320;
  Rings.nextZ=Math.min(Rings.nextZ,clear);
  Fuel.nextZ=Math.min(Fuel.nextZ,clear-260);
  Haz.nextZ=Math.min(Haz.nextZ,clear-620);
}
function nextSector(){
  G.lvl++;
  G.fuel=100;
  P.lives=Math.min(3,P.lives+1);
  G.landLabel="";
  applyTheme(G.lvl);
  // taxi back out: a fresh strip a little way on, and the sector starts on the roll
  P.z-=600;
  Airfield.departure();
  Terrain.reset();
  Scatter.reset();
  Clouds.reset();
  Rings.reset();
  Fuel.reset();
  Haz.reset();
  clearOfDeparture();
  G.levelEnd=P.dist+5000+700*G.lvl;
  P.invuln=0;
  if(G.lvl===2)popup("NEW: PYLONS, MASTS & TURBINES");
  popup("SECTOR "+G.lvl+": "+THEMES[Game.curTheme].name+" · "+TODS[Game.curTod].name+
        (Game.weather?" · "+WEATHERS[Game.weather]:""));
}

// ---------- frame ----------
function stopLoop(){ Game.looping=false; }
function startLoop(){
  if(Game.looping) return;
  Game.looping=true; Game.tPrev=performance.now();
  requestAnimationFrame(frame);
}
function frame(t){
  if(!Game.looping) return;
  requestAnimationFrame(frame);
  const dt=Game.simHold?0:(Math.min(0.05,(t-Game.tPrev)/1000)||0.016);Game.tPrev=t;
  if(Game.simHold){
    Airfield.update(dt,t);
    renderFrame(t);
    return;
  }
  if(Game.state===S.PLAY){
    if(Game.readyT>0)Game.readyT-=dt;
    else update(dt,t);
  }
  else if(Game.state===S.TAKEOFF){
    if(Game.readyT>0)Game.readyT-=dt;                 // run-up at the holding point
    else updateTakeoff(dt);
  }
  else if(Game.state===S.ROLLOUT) updateRollout(dt);
  else if(Game.state===S.DYING) updateDying(dt);
  else if(Game.state===S.MENU&&Game.attractOn) updateAttract(dt);
  Airfield.update(dt,t);
  audioTick();
  renderFrame(t);
}
function renderFrame(t){
  Shadows.update();
  const bank=Game.state===S.DYING?Math.sin(Game.dying.roll)*0.95:P.roll;
  camera.position.set(P.x,P.y,P.z);
  if(Game.state===S.DYING){
    camera.rotation.set(-0.34+Math.sin(Game.dying.t*7)*0.05,Math.sin(Game.dying.roll*0.5)*0.25,-bank);
  }else if(Game.state===S.ROLLOUT){
    camera.rotation.set(0.02,0,-bank*0.4);
  }else if(Game.state===S.TAKEOFF){
    // tail-down on the roll, nose coming up through the rotation
    camera.rotation.set(0.06-Math.min(0.10,P.speed*0.0011)+(TO.lifted?Math.min(0.16,TO.rotT*0.4):0),
                        0,-bank*0.5);
  }else{
    camera.rotation.set(P.vy*0.0042,-P.vx*0.0016,-bank);
  }
  if(Game.shake>0){
    camera.position.x+=(Math.random()-0.5)*Game.shake*4;
    camera.position.y+=(Math.random()-0.5)*Game.shake*4;
  }
  sky.position.set(P.x,0,P.z);
  sunGlow.position.set(P.x+SUNDIR.x*4000, SUNDIR.y*4000, P.z+SUNDIR.z*4000);
  for(const r of ridges){
    const u=r.userData;
    r.position.set(P.x*u.fac, u.h*0.30+TH.amp*0.5, P.z-u.dist);
  }
  if(Game.postOn&&rtScene){ renderPost(); }
  else{ renderer.setRenderTarget(null); renderer.render(scene,camera); }
  drawHUD(t);
}
requestAnimationFrame(frame);

// ---------- overlays / flow ----------
function isPortrait(){return window.innerHeight>window.innerWidth;}
function checkOrient(){
  const ro=document.getElementById("rotateOverlay");
  if(isPortrait()&&Game.state!==S.MENU){
    ro.classList.remove("hidden");
    if(Game.state===S.PLAY||Game.state===S.ROLLOUT||Game.state===S.TAKEOFF){Game.prePauseState=Game.state;Game.state=S.PAUSE;Game.orientPaused=true;}
  }else if(!isPortrait()){
    ro.classList.add("hidden");
    if(Game.state===S.PAUSE&&Game.orientPaused){
      Game.orientPaused=false;
      calibrate();
      hideAll();
      Game.readyT=Math.max(Game.readyT,1.0);
      Game.state=Game.prePauseState;
    }else if(Game.state===S.PAUSE&&document.getElementById("pauseOverlay").classList.contains("hidden")){
      show("pauseOverlay");
    }
  }
}
window.addEventListener("resize",checkOrient);
window.addEventListener("orientationchange",checkOrient);

async function startFlow(){
  initAudio();
  resumeAudio();
  if(!CAN_TILT){
    permState="unsupported";
  }else try{
    if(typeof DeviceOrientationEvent.requestPermission==="function"){
      permState=await DeviceOrientationEvent.requestPermission();
    }else{permState="granted";}
  }catch(e){permState="denied";}
  try{await document.documentElement.requestFullscreen({navigationUI:"hide"});}catch(e){}
  try{if(screen.orientation&&screen.orientation.lock)await screen.orientation.lock("landscape");}catch(e){}
  setTimeout(()=>{
    calibrate();resetWorld();hideAll();
    document.getElementById("uiBtns").style.display="flex";
    Game.attractOn=false;
    Game.state=S.TAKEOFF;Game.readyT=2.0;checkOrient();
  },350);
}
// A device that cannot tilt shouldn't be offered tilt: the button, the control
// line and the recalibrate option all describe the keyboard instead.
(function setupControlsUI(){
  const chk=document.getElementById("invertChk");
  chk.checked=invertPitch;
  chk.addEventListener("change",()=>setInvertPitch(chk.checked));

  if(CAN_TILT)return;

  document.getElementById("startBtn").innerHTML="&#9654;&ensp;Fly";
  document.getElementById("ctrlLine").innerHTML=
    "<b>ARROWS</b> or <b>WASD</b> to bank &middot; dive &middot; climb";
  document.getElementById("footLine").innerHTML=
    "Headphones recommended &middot; &larr; &rarr; bank &middot; &uarr; &darr; pitch";
  document.getElementById("invertRow").style.display="flex";
  const recal=document.getElementById("recalBtn");
  if(recal)recal.style.display="none";
})();

document.getElementById("startBtn").addEventListener("click",startFlow);
document.getElementById("retryBtn").addEventListener("click",()=>{
  calibrate();resetWorld();hideAll();Game.state=S.TAKEOFF;Game.readyT=2.0;checkOrient();
});
document.getElementById("contBtn").addEventListener("click",()=>{
  nextSector();
  hideAll();Game.state=S.TAKEOFF;Game.readyT=1.6;checkOrient();
});
document.getElementById("entryRow").addEventListener("submit",async (e)=>{
  e.preventDefault();
  const pn=document.getElementById("pilotName");
  const name=cleanName(pn.value);
  if(!name){                                  // ask again rather than post a blank
    pn.classList.remove("nudge"); void pn.offsetWidth; pn.classList.add("nudge");
    pn.focus();
    return;
  }
  pn.blur();                                  // let the on-screen keyboard go
  const entry={name,score:G.score,lvl:G.lvl,rings:G.ringsHit,chain:G.bestCombo};
  Save.submit(entry);                         // the local logbook always takes it
  document.getElementById("entryRow").style.display="none";
  chime(980);
  if(!Net.online){ renderBoard(name); return; }
  Net.note="sending to the world board…";
  renderBoard(name);
  const d=await Net.submit(entry);
  if(d&&d.ok){
    Net.note=d.rank
      ? "world logbook &middot; you are <b>"+ordinal(d.rank)+"</b>"+
        (d.improved?"":" (your best still stands)")
      : "";
  }else{
    Net.note=(d&&d.error?d.error:"world board unreachable")+
      " &middot; saved to your logbook";
  }
  renderBoard(name);
  setTimeout(()=>{ Net.note=""; },6000);
});
document.getElementById("pauseBtn").addEventListener("click",()=>{
  if(Game.state===S.PLAY||Game.state===S.ROLLOUT||Game.state===S.TAKEOFF){Game.prePauseState=Game.state;Game.state=S.PAUSE;show("pauseOverlay");}
});
document.getElementById("resumeBtn").addEventListener("click",()=>{
  if(isPortrait()){checkOrient();return;}
  hideAll();Game.state=Game.prePauseState;
});
document.getElementById("recalBtn").addEventListener("click",()=>calibrate());

// ---------- shutting down ----------
// A page may only close itself when the browser opened it by script or it is
// running as an installed app. Rather than pretend, this shuts the flight down
// properly — engine off, out of fullscreen, orientation released, rendering
// stopped, logbook flushed — then asks to close and says so if it is refused.
async function exitGame(){
  Save.flush();
  stopLoop();
  Game.state=S.MENU; Game.attractOn=false; Game.readyT=0;
  setMuted(true);
  await suspendAudio();
  try{ if(document.fullscreenElement&&document.exitFullscreen) await document.exitFullscreen(); }catch(e){}
  try{ if(screen.orientation&&screen.orientation.unlock) screen.orientation.unlock(); }catch(e){}
  document.getElementById("uiBtns").style.display="none";
  const d=Save.data;
  document.getElementById("quitBest").innerHTML=
    d.bestScore?"Best <b>"+d.bestScore.toLocaleString()+"</b> &middot; sector <b>"+d.bestSector+"</b>":"";
  document.getElementById("quitNote").textContent="";
  show("quitOverlay");
  try{ window.close(); }catch(e){}
  setTimeout(()=>{
    if(!window.closed){
      document.getElementById("quitNote").textContent=
        "Your browser will not let a page close itself. The flight is shut down — "+
        "close the tab, or swipe the app away. Installed to your home screen, this button closes it.";
    }
  },350);
}
document.getElementById("exitBtn").addEventListener("click",exitGame);
document.getElementById("backBtn").addEventListener("click",()=>{
  setMuted(false);
  resumeAudio();
  startLoop();
  resetWorld();
  popups.length=0;
  Game.attractOn=true;
  Game.state=S.MENU;
  show("startOverlay");
  renderBoard();
  Net.load();
});
document.getElementById("muteBtn").addEventListener("click",()=>setMuted(!muted));
document.getElementById("fxBtn").addEventListener("click",()=>{
  Game.postOn=!Game.postOn;
  document.getElementById("fxBtn").style.opacity=Game.postOn?"1":"0.4";
});
document.addEventListener("visibilitychange",()=>{
  if(document.hidden&&(Game.state===S.PLAY||Game.state===S.ROLLOUT||Game.state===S.TAKEOFF)){
    Game.prePauseState=Game.state;Game.state=S.PAUSE;show("pauseOverlay");
  }
});
window.addEventListener("keydown",e=>{
  if(e.key==="Escape"||e.key==="p"){
    if(Game.state===S.PLAY||Game.state===S.ROLLOUT||Game.state===S.TAKEOFF){Game.prePauseState=Game.state;Game.state=S.PAUSE;show("pauseOverlay");}
    else if(Game.state===S.PAUSE){hideAll();Game.state=Game.prePauseState;}
  }
});

// ---------- attract mode: the countryside flies itself behind the menu ----------
function updateAttract(dt){
  P.speed=46;
  P.pz=P.z;
  P.z-=P.speed*dt;
  const tt=performance.now()*0.001;
  P.x=coursePathX(P.z)+Math.sin(tt*0.20)*90;
  P.vx=Math.cos(tt*0.20)*90*0.20;
  P.roll=-P.vx*0.004;
  P.y=Math.max(groundH(P.x,P.z)+70, 130+Math.sin(tt*0.13)*40);
  P.vy=Math.cos(tt*0.13)*40*0.13;
  Terrain.update();
  Scatter.update();
  Clouds.update();
  Rings.update(dt);
  Fuel.update(dt);
  updateBursts();
}
resetWorld();
popups.length=0;
Game.attractOn=true;
renderBoard();            // show the logbook bests on the title card
Net.load();               // and the world leader, if the board is reachable

// ---------- test hook: drives the game from a headless browser ----------
window.SKY={
  P,G,af,Rings,Fuel,Haz,Terrain,
  state:()=>Game.state,
  // start on the strip, ready to roll
  takeoff(){ resetWorld(); Game.attractOn=false; hideAll();
             document.getElementById("uiBtns").style.display="flex";
             Game.state=S.TAKEOFF; Game.readyT=0; },
  // start on the strip and fly her off, so tests begin airborne
  play(){ this.takeoff();
          for(let i=0;i<1200&&Game.state===S.TAKEOFF;i++) updateTakeoff(0.033);
          return Game.state===S.PLAY; },
  approach(){ this.play(); G.levelEnd=P.dist+1400; },
  // headless: advance the simulation without waiting on frames
  step(n,dt){
    dt=dt||0.033;
    for(let i=0;i<n;i++){
      if(Game.state===S.PLAY&&Game.readyT<=0) update(dt,performance.now());
      else if(Game.state===S.ROLLOUT) updateRollout(dt);
      else if(Game.state===S.TAKEOFF&&Game.readyT<=0) updateTakeoff(dt);
      else if(Game.state===S.DYING) updateDying(dt);
      else break;
    }
    return {state: Game.state,z:Math.round(P.z),y:Math.round(P.y),dist:Math.round(P.dist),
            score:Math.floor(G.score),rings:G.ringsHit+"/"+G.rings,fuel:Math.round(G.fuel),
            lives:P.lives,label:G.landLabel,afPhase:af.phase};
  },
  aimAt(x,y){ P.x=x; P.y=y; },
  hold(on){ Game.simHold=!!on; },
  Save,
  courseX:z=>coursePathX(z),
  groundAt:(x,z)=>groundH(x,z),
  drawHUD:t=>drawHUD(t),
  setMuted(m){ setMuted(m); },
  fx(on){ Game.postOn=on; }
};

// ---------- PWA manifest (inline) ----------
(function(){
  const manifest={name:"Skylark Run",short_name:"SkylarkRun",
    display:"fullscreen",orientation:"landscape",
    background_color:"#7fb6e0",theme_color:"#7fb6e0",start_url:".",
    icons:[
      {src:"/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
      {src:"/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"}
    ]};
  const link=document.createElement("link");
  link.rel="manifest";
  link.href="data:application/manifest+json,"+encodeURIComponent(JSON.stringify(manifest));
  document.head.appendChild(link);
})();

// Skylark Run — game code.
//
// Loaded as an ES module so the engine can be split into files. three.js is
// still the r128 global build from the CDN, so THREE is referenced as a global
// here rather than imported.
/* global THREE */
import { hash, hash2, mulberry32, clamp, lerp, smooth, vnoise, lineGeo,
         shade, midiF, hatBuf, roundedPoly, esc, ordinal } from './util.js';
import { Save, Net, renderBoard, cleanName, NAME_MAX } from './logbook.js';
import { S, Game, TO, P, G, dents, popups, popup } from './state.js';
import { CAN_TILT, readInput, calibrate, screenAngle, setInvertPitch,
         invertPitch, haveTilt, permState } from './input.js';
import { obstacleBeep, resumeAudio, suspendAudio, setRain, deathSpiral, fuelBeep, initAudio, audioTick, chime, whoosh, crashSound, setMuted, thud, radioCall, muted } from './audio.js';
import { DPR, H, W, camera, hctx, renderer, scene } from './view.js';
import { SUNDIR, sky, sunGlow } from './sky.js';
import { renderPost, rtScene } from './post.js';
import { overlays, show, hideAll } from './overlays.js';
import { updateDying } from './damage.js';
"use strict";

// ---------- choosing an aircraft ----------
// A craft is loaded on demand rather than imported at the top. Each one brings
// a world with it — a heightfield countryside, or a city of pooled buildings —
// and building both to fly one would cost the memory and the load time twice.
// A dynamic import defers the whole of it, geometry included, until chosen.
let Craft = null;

const CRAFT = {
  plane: { label:"Skylark",  sub:"monoplane · open country",
           load:()=>import('./plane/flight.js').then(m=>m.Plane) },
  heli:  { label:"Rotor",    sub:"helicopter · night city",
           load:()=>import('./heli/flight.js').then(m=>m.Helicopter) }
};

async function selectCraft(id){
  const entry = CRAFT[id];
  if(!entry) throw new Error("unknown craft: " + id);
  Craft = await entry.load();
  // The craft owns its own title card wording.
  const set = (el,html)=>{ const n=document.getElementById(el); if(n) n.innerHTML=html; };
  set("craftName", Craft.name);
  set("craftTag", Craft.tagline);
  set("ctrlLine", Craft.controlLine);
  set("placardBody", Craft.placard);
  Craft.reset();
  popups.length=0;
  Game.attractOn = true;
  Game.state = S.MENU;
  show("startOverlay");
  renderBoard();
  Net.load();
  startLoop();
  return Craft.id;
}

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
  if(Craft&&Craft.ownsState(Game.state)){
    // A sector opens on a hold — the run-up at the holding point, or the
    // rotors coming up to speed — before the controls go live.
    if(Game.readyT>0) Game.readyT-=dt;
    else Craft.tick(dt,t);
  }
  else if(Game.state===S.DYING) updateDying(dt);
  else if(Game.state===S.MENU&&Game.attractOn&&Craft) Craft.attract(dt);
  if(Craft&&Craft.tickWorld) Craft.tickWorld(dt,t);
  audioTick();
  renderFrame(t);
}
function renderFrame(t){
  if(!Craft){ return; }               // nothing to draw until one is chosen
  Craft.rigWorld(t);
  Craft.rigCamera();
  if(Game.postOn&&rtScene){ renderPost(); }
  else{ renderer.setRenderTarget(null); renderer.render(scene,camera); }
  Craft.drawCockpit(t);
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
    calibrate();Craft.reset();hideAll();
    document.getElementById("uiBtns").style.display="flex";
    Game.attractOn=false;
    Game.state=Craft.startState;Game.readyT=Craft.startHold;checkOrient();
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

document.querySelectorAll(".craftCard").forEach(b=>{
  b.addEventListener("click",()=>{
    b.disabled=true;
    selectCraft(b.dataset.craft).catch(err=>{
      b.disabled=false;
      console.error(err);
      const n=document.querySelector("#craftOverlay .tiny");
      if(n) n.textContent="That aircraft failed to load — try the other one.";
    });
  });
});
document.getElementById("startBtn").addEventListener("click",startFlow);
document.getElementById("retryBtn").addEventListener("click",()=>{
  calibrate();Craft.reset();hideAll();Game.state=Craft.startState;Game.readyT=Craft.startHold;checkOrient();
});
document.getElementById("contBtn").addEventListener("click",()=>{
  Craft.nextSector();
  hideAll();Game.state=Craft.startState;Game.readyT=Craft.startHold*0.8;checkOrient();
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
  Craft.reset();
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

// Boot straight to the picker: no world exists until a craft is chosen.
show("craftOverlay");
renderBoard();            // the logbook bests are craft-independent
Net.load();               // and the world leader, if the board is reachable

// ---------- test hook: drives the game from a headless browser ----------
window.SKY={
  P,G,
  state:()=>Game.state,
  craft:()=>Craft&&Craft.id,
  /** Tests pick a craft first; nothing exists until they do. */
  select:id=>selectCraft(id),
  // start a sector the way this craft starts one
  takeoff(){ Craft.reset(); Game.attractOn=false; hideAll();
             document.getElementById("uiBtns").style.display="flex";
             Game.state=Craft.startState; Game.readyT=0; },
  // and get airborne, whichever craft it is: the plane rolls, the rotor is
  // already flying, so this simply ticks until the sector proper is running
  play(){ this.takeoff();
          for(let i=0;i<1200&&Game.state!==S.PLAY;i++){
            if(!Craft.ownsState(Game.state)) break;
            Craft.tick(0.033, performance.now());
          }
          return Game.state===S.PLAY; },
  approach(){ this.play(); G.levelEnd=P.dist+1400; },
  // headless: advance the simulation without waiting on frames
  step(n,dt){
    dt=dt||0.033;
    for(let i=0;i<n;i++){
      if(Craft.ownsState(Game.state)&&Game.readyT<=0) Craft.tick(dt,performance.now());
      else if(Game.state===S.DYING) updateDying(dt);
      else break;
    }
    return Object.assign({
      state: Game.state, z:Math.round(P.z), y:Math.round(P.y), dist:Math.round(P.dist),
      score:Math.floor(G.score), rings:G.ringsHit+"/"+G.rings, fuel:Math.round(G.fuel),
      lives:P.lives, label:G.landLabel
    }, Craft.debug.extra());
  },
  aimAt(x,y){ P.x=x; P.y=y; },
  hold(on){ Game.simHold=!!on; },
  Save,
  get af(){ return Craft.debug.af; },
  get Rings(){ return Craft.debug.Rings; },
  get Fuel(){ return Craft.debug.Fuel; },
  get Haz(){ return Craft.debug.Haz; },
  get Terrain(){ return Craft.debug.Terrain; },
  get pad(){ return Craft.debug.pad; },
  courseX:z=>Craft.debug.courseX(z),
  groundAt:(x,z)=>Craft.debug.groundAt(x,z),
  drawHUD:t=>Craft.drawCockpit(t),
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

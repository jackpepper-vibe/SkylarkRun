// Skylark Run — damage, death and the end of a run.
//
// Everything that costs the airframe: a strike takes a life and marks the
// cowling, the last one starts the spiral, and endGame closes the logbook
// entry. countryside.js calls in here on a collision, and this module reads
// the terrain back — a cycle ES modules allow because neither side touches the
// other while the modules are being evaluated.
/* global THREE */
import { G, Game, P, S, dents, popup } from './state.js';
import { chime, crashSound, deathSpiral, thud } from './audio.js';
import { SPEED0 } from './plane/config.js';
import { Scatter, THEMES, Terrain, burst, groundH } from './plane/world.js';
import { H, W } from './view.js';
import { Clouds } from './clouds.js';
import { Net, Save, renderBoard } from './logbook.js';
import { show } from './overlays.js';

// Windscreen damage, for the craft whose cockpit has a windscreen rather than
// a cowling. Populated on the same hit that dents the plane.
const cracks=[];

// ---------- damage, death and the end of a run ----------
function crash(reason){
  cracks.push({x:W*(0.30+Math.random()*0.40), y:H*(0.15+Math.random()*0.35),
               seed:Math.floor(Math.random()*1e4), arms:5+Math.floor(Math.random()*3)});
  if(P.invuln>0||Game.state===S.DYING) return;
  P.lives--; P.invuln=2.4; Game.shake=1; Game.flash=1; crashSound();
  if(navigator.vibrate)navigator.vibrate(180);
  P.speed=Math.max(SPEED0*0.75,P.speed*0.45);
  G.combo=0;
  dents.push({x:W*(0.28+Math.random()*0.44),y:H*(0.55+Math.random()*0.18),
    seed:Math.floor(Math.random()*1e4),r:10+Math.random()*14});
  if(reason) popup(reason);
  if(P.lives<=0) startDying("Down in the <span>fields</span>","airframe written off");
}
function birdStrike(){
  if(P.invuln>0||Game.state===S.DYING) return;
  Game.shake=Math.max(Game.shake,0.75); Game.flash=Math.max(Game.flash,0.4);
  P.speed=Math.max(SPEED0*0.8,P.speed-16);
  G.combo=0;
  splats.push({x:W*(0.30+Math.random()*0.40),y:H*(0.44+Math.random()*0.16),
    r:6+Math.random()*9,seed:Math.random()*1000});
  popup("BIRD STRIKE");
  thud(); crashSound();
  if(navigator.vibrate)navigator.vibrate(90);
}
const splats=[];
function startDying(title,sub){
  if(Game.state===S.DYING)return;
  Game.state=S.DYING;
  Game.dying={t:0,roll:Math.random()<0.5?0:Math.PI,title,sub};
  deathSpiral();
}
function updateDying(dt){
  Game.dying.t+=dt; Game.dying.roll+=dt*(1.5+Game.dying.t*0.6);
  P.speed=Math.max(22,P.speed-16*dt);
  P.z-=P.speed*dt;
  P.y-=(10+Game.dying.t*30)*dt;
  Game.shake=Math.min(1.3,Game.shake+dt*1.5);
  Game.flash=Math.max(Game.flash,0.12);
  Terrain.update(); Scatter.update(); Clouds.update();
  const g=groundH(P.x,P.z);
  if(P.y<=g+3){
    P.y=g+3; Game.flash=1; Game.shake=1.5;
    crashSound(); setTimeout(crashSound,150);
    burst(new THREE.Vector3(P.x,g+6,P.z-16),0xff8a3a,1.8);
    burst(new THREE.Vector3(P.x+10,g+9,P.z-24),0xffd08a,1.4);
    burst(new THREE.Vector3(P.x-11,g+5,P.z-12),0xd2452f,1.4);
    endGame(Game.dying.title,Game.dying.sub);
  }
}
function endGame(title,sub){
  Game.state=S.OVER;
  G.score=Math.floor(G.score);
  const wasBest=G.score>Save.data.bestScore;
  Save.noteRun(G,P);
  document.getElementById("overTitle").innerHTML=title;
  document.getElementById("overSub").textContent=sub;
  document.getElementById("finalScore").textContent=G.score.toLocaleString()+(wasBest?"  ★ BEST":"");
  document.getElementById("finalRings").textContent=G.ringsHit+"/"+G.rings+
    (G.goldHit?"  ("+G.goldHit+" gold)":"");
  document.getElementById("finalDist").textContent=(P.dist/1000).toFixed(2)+" km";
  document.getElementById("finalLvl").textContent=G.lvl;
  document.getElementById("finalChain").textContent="x"+G.bestCombo;
  document.getElementById("entryRow").style.display=G.score>0?"flex":"none";
  const pn=document.getElementById("pilotName");
  pn.value=Save.data.pilot||"";
  Net.note="";
  renderBoard();
  Net.load();                       // freshen the world board while the card is up
  show("overOverlay");
}

function levelClear(){
  Game.state=S.CLEAR;
  const rb=G.ringsHit*40;
  const bf=Math.round(G.fuel*12), bh=P.lives*300;
  G.score=Math.floor(G.score+rb+bf+bh);
  document.getElementById("clearLvl").textContent=G.lvl;
  document.getElementById("bLand").textContent=G.landLabel||"";
  document.getElementById("bRings").textContent=G.ringsHit+"/"+G.rings+"  (+"+rb.toLocaleString()+")";
  document.getElementById("bChain").textContent="x"+G.bestCombo;
  document.getElementById("bFuel").textContent="+"+bf.toLocaleString();
  document.getElementById("bHull").textContent="+"+bh.toLocaleString();
  document.getElementById("clearScore").textContent=G.score.toLocaleString();
  document.getElementById("nextTheme").textContent=THEMES[G.lvl%THEMES.length].name;
  [660,880,1100].forEach((f,i)=>setTimeout(()=>chime(f),i*140));
  show("clearOverlay");
}

export { cracks, birdStrike, crash, levelClear, splats, startDying, updateDying };

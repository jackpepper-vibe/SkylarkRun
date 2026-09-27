// Skylark Run — damage, death and the end of a run.
//
// Everything that costs the airframe: a strike takes a life and marks the
// cowling, the last one starts the spiral, and endGame closes the logbook
// entry. countryside.js calls in here on a collision, and this module reads
// the terrain back — a cycle ES modules allow because neither side touches the
// other while the modules are being evaluated.
import { G, Game, P, S, award, dents, popup } from './state.js';
import { chime, crashSound, deathSpiral, thud } from './audio.js';
import { Aircraft } from './plane/aircraft.js';
import { Active } from './active.js';
import { H, W } from './view.js';
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
  P.speed=Math.max(Aircraft.spec.speed0*0.75,P.speed*0.45);
  G.combo=0;
  dents.push({x:W*(0.28+Math.random()*0.44),y:H*(0.55+Math.random()*0.18),
    seed:Math.floor(Math.random()*1e4),r:10+Math.random()*14});
  if(reason) popup(reason);
  if(P.lives<=0) startDying("Down in the <span>fields</span>","airframe written off");
}
function birdStrike(){
  if(P.invuln>0||Game.state===S.DYING) return;
  Game.shake=Math.max(Game.shake,0.75); Game.flash=Math.max(Game.flash,0.4);
  P.speed=Math.max(Aircraft.spec.speed0*0.8,P.speed-16);
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
  Active.craft.scrollWorld();
  const g=Active.craft.groundAt(P.x,P.z);
  if(P.y<=g+3){
    P.y=g+3; Game.flash=1; Game.shake=1.5;
    crashSound(); setTimeout(crashSound,150);
    Active.craft.impact(g);
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

const STAR_ON="★", STAR_OFF="☆";
function levelClear(){
  Game.state=S.CLEAR;
  const card=Active.craft.sectorCard(), sr=card.rings;
  // the end-of-sector bonuses, at the run's current worth like every other point
  const rb=award(sr.hit*40), bf=award(G.fuel*12), bh=award(P.lives*300);
  G.score=Math.floor(G.score);
  const stars=card.stars;
  Save.noteStars(card.flown.key,stars);
  const $=id=>document.getElementById(id);
  $("clearLvl").textContent=G.lvl;
  $("clearName").textContent=card.flown.name+" · wheels stopped";
  $("clearStars").textContent=STAR_ON.repeat(stars)+STAR_OFF.repeat(3-stars);
  $("bLand").textContent=G.landLabel||"";
  $("bObj").textContent=card.flown.objective.text+(G.objDone?" ✓":" ✗");
  $("bObj").style.color=G.objDone?"#c9ffd0":"#ffc2a8";
  $("bRings").textContent=sr.hit+"/"+sr.seen+"  (+"+rb.toLocaleString()+")";
  $("bChain").textContent="x"+G.secChain;
  $("bFuel").textContent="+"+bf.toLocaleString();
  $("bHull").textContent="+"+bh.toLocaleString();
  $("clearScore").textContent=G.score.toLocaleString();
  // the next leg's briefing
  const n=card.next;
  $("nextName").textContent="Sector "+n.n+": "+n.name;
  $("nextMeta").textContent=[n.def.land,n.def.tod,n.def.weather].map(s=>s.toLowerCase()).join(" · ")+
    " · score ×"+(n.mult*Aircraft.spec.scoreMul).toFixed(2);
  $("nextBrief").textContent=n.def.brief;
  $("nextObj").textContent=n.objective.text;
  $("nextNew").textContent=card.fresh.length?"New: "+card.fresh.join(", "):"";
  $("contBtn").innerHTML="&#9654;&ensp;Take off for "+n.name;
  [660,880,1100].forEach((f,i)=>setTimeout(()=>chime(f),i*140));
  show("clearOverlay");
}

export { cracks, birdStrike, crash, levelClear, splats, startDying, updateDying };

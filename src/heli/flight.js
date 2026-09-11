// Rotor — the helicopter.
//
// The other half of a Craft. The flight integration is the plane's, three lines
// of it, over different constants: she is slower, turns tighter, and has a
// hover floor rather than a ground to land on. There is no take-off roll — a
// sector opens airborne — and the finale is a pad rather than a runway.
/* global THREE */
import { clamp } from '../util.js';
import { S, Game, P, G, popups, popup } from '../state.js';
import { readInput } from '../input.js';
import { chime, whoosh, obstacleBeep, fuelBeep } from '../audio.js';
import { camera, scene, W, H } from '../view.js';
import { gDrops, updateRain } from '../weather.js';
import { crash, levelClear, startDying } from '../damage.js';
import { LANES, STREETS, ROW_SPACING, VIEW, SPEED0, SPEED_MAX, SPEED_RAMP,
         MAX_VX, MAX_VY, MIN_Y, MAX_Y, LAT_CLAMP, PR } from './config.js';
import { THEME_NAMES, updateLightning, advanceRows, rebaseGround, pad, activeB, activatePad, resetCity, nextCitySector, rigCity, tickCity,
         updateAttract, updateTraffic, updateSideCity, updateScenery,
         updateCityLife, updatePickups, updateHazards, diceAngle } from './world.js';
import { drawHeliHUD } from './hud.js';

// ---------- update ----------
function update(dt){
  const inp=readInput();
  P.vx+=((inp.steer*MAX_VX)-P.vx)*Math.min(1,dt*5.5);
  P.vy+=((inp.pitch*MAX_VY)-P.vy)*Math.min(1,dt*5.5);
  P.x=Math.max(-LAT_CLAMP,Math.min(LAT_CLAMP,P.x+P.vx*dt));
  P.y=Math.max(MIN_Y-2,Math.min(MAX_Y,P.y+P.vy*dt));
  P.speed=Math.min(SPEED_MAX,P.speed+SPEED_RAMP*dt);
  P.z-=P.speed*dt;P.dist+=P.speed*dt;
  if(P.invuln>0)P.invuln-=dt;
  Game.shake=Math.max(0,Game.shake-dt*2.2);Game.flash=Math.max(0,Game.flash-dt*2.5);

  // fuel: the clock you fly against
  G.fuel-=(1.5+0.15*(G.lvl-1))*dt;
  if(G.fuel<=0){G.fuel=0;startDying('Tanks <span>dry</span>',"fuel exhausted \u2014 engine out");return;}
  if(G.fuel<20&&performance.now()-Game.lastFuelBeep>1200){
    if(fuelBeep()) Game.lastFuelBeep=performance.now();
  }
  // scoring: survival trickle + deck-run bonus
  G.score+=dt*P.speed*0.15;
  if(P.y<42) G.score+=dt*14;
  updatePickups(dt);
  updateHazards(dt);
  updateRain(dt);
  // rain: windscreen droplets + gusts
  if(Game.weather===1){
    const nowW=performance.now();
    if(Math.random()<dt*14&&gDrops.length<60)
      gDrops.push({x:W*(0.10+Math.random()*0.80),y:H*(0.05+Math.random()*0.60),
        r:1.5+Math.random()*2.5,t0:nowW});
    if(nowW>Game.nextGust){
      Game.windTarget=(Math.random()<0.5?-1:1)*(14+Math.random()*16);
      popup("GUST "+(Game.windTarget>0?"\u2192":"\u2190"));
      Game.gustEnd=nowW+2200;
      Game.nextGust=nowW+4500+Math.random()*4000;
    }
    updateLightning();
    if(performance.now()>Game.gustEnd)Game.windTarget=0;
  }else Game.windTarget=0;
  Game.wind+=(Game.windTarget-Game.wind)*Math.min(1,dt*2);
  P.x=Math.max(-LAT_CLAMP,Math.min(LAT_CLAMP,P.x+Game.wind*dt));

  // sector finale: helipad approach & landing
  if(!pad.active&&P.dist>G.levelEnd-650) activatePad();
  if(pad.active){
    P.speed+=(26-P.speed)*Math.min(1,dt*0.8); // auto-throttle
    const nowP=performance.now();
    pad.lights.material.color.set(Math.floor(nowP/300)%2?0x39d98a:0xffcf87);
    pad.beam.material.opacity=0.08+0.05*Math.sin(nowP*0.004);
    const flashI=6-Math.floor(nowP/90)%7; // strobes chase toward the pad
    pad.strobes.forEach((s,i)=>{s.material.opacity=(i===flashI)?1:0.12;});
    const inXZ=Math.abs(P.x-pad.x)<24&&P.z<pad.z+27&&P.z>pad.z-27;
    if(inXZ&&P.y<=pad.h+3.5&&P.y>pad.h-2){
      pad.active=false;
      const gentle=Math.abs(P.vy)<9;
      const bonus=gentle?800:300;
      G.score+=bonus;
      G.landLabel=(gentle?"PERFECT LANDING +800":"FIRM LANDING +300");
      popup(G.landLabel); chime(1200);
      levelClear(); return;
    }
    if(P.invuln<=0&&P.z<pad.z+27&&P.z>pad.z-27&&
       Math.abs(P.x-pad.x)<27+PR&&P.y<pad.h-4){
      crash(); P.y=pad.h+16; return;   // flew into the pad tower
    }
    if(P.z<pad.z-45){                   // overshot
      pad.active=false;
      G.landLabel="OVERSHOT \u2014 NO LANDING BONUS";
      popup("OVERSHOT");
      levelClear(); return;
    }
  }

  advanceRows();
  updateTraffic(dt);
  updateSideCity();
  updateScenery(dt);
  updateCityLife(dt);
  rebaseGround();

  // obstacle proximity warning + near-miss scoring
  Game.warnObst=false;
  for(const b of activeB){
    const dAhead=P.z-(b.z+b.d/2);
    if(!Game.warnObst&&dAhead>0&&dAhead<330&&Math.abs(P.x-b.x)<b.w/2+18&&P.y<b.h+18)Game.warnObst=true;
    const inZ=P.z<b.z+b.d/2&&P.z>b.z-b.d/2;
    if(inZ&&!b.scored){
      const latC=Math.abs(P.x-b.x)-b.w/2, vC=P.y-b.h;
      if((latC>0&&latC<16&&P.y<b.h)||(vC>0&&vC<14&&Math.abs(P.x-b.x)<b.w/2)) b.nearMiss=true;
    }
    if(!b.scored&&b.nearMiss&&P.z<b.z-b.d/2-6){
      b.scored=true;G.score+=60;popup("CLOSE +60");whoosh();
    }
  }
  if(Game.warnObst&&performance.now()-Game.lastBeep>450){
    if(obstacleBeep()) Game.lastBeep=performance.now();
  }

  if(P.invuln<=0){
    if(P.y<MIN_Y){crash();P.y=MIN_Y+18;return;}
    for(const b of activeB){
      if(P.z<b.z+b.d/2+4&&P.z>b.z-b.d/2-4&&
         Math.abs(P.x-b.x)<b.w/2+PR&&
         P.y<b.h+PR*0.6){
        crash();
        if(b.h+22<=MAX_Y) P.y=b.h+22;                       // glance up over the roof
        else P.x=b.x+(P.x>=b.x?1:-1)*(b.w/2+PR+16);         // supertall: bounce sideways
        return;
      }
    }
  }
}


// ---------- the craft ----------
export const Helicopter = {
  id: "heli",
  name: "Rotor",
  tagline: "night shift &middot; over the city",
  controlLine: "<b>TILT</b> to bank &middot; climb &middot; descend",
  placard:
    "Hold her steady between the towers &mdash; there is no runway here<br>" +
    "Thread the <b>rings</b> down the avenues &middot; chain them for multipliers<br>" +
    "Supply drops top the tank &middot; cranes, cables and drones bite<br>" +
    "Every sector ends on a <b>helipad</b> &mdash; come down gently onto the mark",

  // She starts in the air: no strip to roll down.
  startState: S.PLAY,
  startHold: 2.0,

  reset(){ resetCity(); },
  nextSector(){ nextCitySector(); },

  tick(dt, t){ if(Game.state===S.PLAY) update(dt, t); },
  ownsState(st){ return st===S.PLAY; },
  attract(dt){ updateAttract(dt); },

  tickWorld(dt, t){ tickCity(dt, t); },
  rigWorld(t){ rigCity(t); },

  rigCamera(){
    const bank = Game.state===S.DYING ? Math.sin(Game.dying.roll)*0.95 : (P.vx/MAX_VX)*0.22;
    camera.position.set(P.x,P.y,P.z);
    if(Game.state===S.DYING){
      camera.rotation.set(-0.30+Math.sin(Game.dying.t*7)*0.05,
                          Math.sin(Game.dying.roll*0.5)*0.25, -bank);
    }else{
      camera.rotation.set(P.vy*0.005, 0, -bank);
    }
  },

  /** The city keeps scrolling under her as she falls. */
  scrollWorld(){ advanceRows(); updateTraffic(0.016); updateScenery(0.016); rebaseGround(); },
  /** There is no terrain here: the street is the floor. */
  groundAt(){ return 0; },
  impact(){ /* the city has its own crash flare in the HUD */ },
  nextThemeName(){ return THEME_NAMES[(G.lvl)%THEME_NAMES.length]; },

  drawCockpit(t){
    // Rotor Run's HUD is handed the bank angle the camera was rigged with.
    const bank = Game.state===S.DYING ? Math.sin(Game.dying.roll)*0.95 : (P.vx/MAX_VX)*0.22;
    drawHeliHUD(bank, t);
  },

  /** Craft-specific handles and readings for the headless suite. */
  debug: {
    pad, activeB,
    courseX: () => 0,                       // the city has no curving course line
    groundAt: () => 0,                      // and its ground is flat under the towers
    extra: () => ({ padActive: pad.active })
  }
};

// Skylark — the aeroplane.
//
// One half of a Craft: the flight model, the take-off roll and landing that
// bracket every sector, the camera rig for an open cockpit, and how a sector
// is set up and advanced. The engine drives all of it through the Plane object
// at the foot of this file, so main.js never needs to know which aircraft is
// flying.
/* global THREE */
import { clamp } from '../util.js';
import { S, Game, TO, P, G, dents, popups, popup } from '../state.js';
import { readInput } from '../input.js';
import { chime, crashSound, fuelBeep, obstacleBeep } from '../audio.js';
import { camera, scene } from '../view.js';
import { sky, sunGlow } from './sky.js';
import { SUNDIR } from '../sun.js';
import { TODS } from './sky.js';
import { Clouds } from '../clouds.js';
import { WEATHERS, gDrops, updateRain } from '../weather.js';
import { crash, levelClear, splats, startDying } from '../damage.js';
import { LAT_CLAMP, SPEED0, SPEED_MAX, SPEED_RAMP, MAX_VX, MAX_VY, MAX_Y,
         MIN_CLEAR } from './config.js';
import { applyTheme, Airfield, Fuel, Haz, Rings, Scatter, Shadows, Terrain, TH, THEMES, af, ridges,
         burst, bursts, clearanceH, coursePathX, groundH, isWood, onField,
         updateBursts } from './world.js';
import { drawHUD } from './hud.js';

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


// ---------- the craft ----------
// What the engine is allowed to ask of an aircraft. There is one today, but the
// engine talks to it through this shape rather than by name, so main.js has no
// idea what it is flying.
export const Plane = {
  id: "plane",
  name: "Skylark",

  /** The state a sector begins in: on the strip, ready to roll. */
  startState: S.TAKEOFF,
  startHold: 2.0,

  reset(){ resetWorld(); },
  nextSector(){ nextSector(); },

  /** One tick of flight, dispatched on the state the aircraft is in. */
  tick(dt, t){
    if(Game.state===S.PLAY)          update(dt, t);
    else if(Game.state===S.TAKEOFF)  updateTakeoff(dt);
    else if(Game.state===S.ROLLOUT)  updateRollout(dt);
  },

  /** States this craft handles itself, so the loop knows to keep ticking. */
  ownsState(st){ return st===S.PLAY || st===S.TAKEOFF || st===S.ROLLOUT; },

  attract(dt){ updateAttract(dt); },

  /** Where the pilot's head is, and how it is lying. */
  rigCamera(){
    const bank = Game.state===S.DYING ? Math.sin(Game.dying.roll)*0.95 : P.roll;
    camera.position.set(P.x,P.y,P.z);
    if(Game.state===S.DYING){
      camera.rotation.set(-0.34+Math.sin(Game.dying.t*7)*0.05, Math.sin(Game.dying.roll*0.5)*0.25, -bank);
    }else if(Game.state===S.ROLLOUT){
      camera.rotation.set(0.02,0,-bank*0.4);
    }else if(Game.state===S.TAKEOFF){
      // tail-down on the roll, nose coming up through the rotation
      camera.rotation.set(0.06-Math.min(0.10,P.speed*0.0011)+(TO.lifted?Math.min(0.16,TO.rotT*0.4):0),
                          0,-bank*0.5);
    }else{
      camera.rotation.set(P.vy*0.0042,-P.vx*0.0016,-bank);
    }
  },

  /** The airfield animates whether or not the pilot is flying it. */
  tickWorld(dt, t){ Airfield.update(dt, t); },

  /** Per-frame world dressing that follows the aircraft: the sky dome, the
   *  sun glow and the parallax ridges all sit relative to the cockpit. */
  rigWorld(){
    Shadows.update();
    sky.position.set(P.x,0,P.z);
    sunGlow.position.set(P.x+SUNDIR.x*4000, SUNDIR.y*4000, P.z+SUNDIR.z*4000);
    for(const r of ridges){
      const u=r.userData;
      r.position.set(P.x*u.fac, u.h*0.30+TH.amp*0.5, P.z-u.dist);
    }
  },

  /** Keep the scenery moving while she is going in. */
  scrollWorld(){ Terrain.update(); Scatter.update(); Clouds.update(); },
  groundAt(x,z){ return groundH(x,z); },
  /** Fireball where she came to rest. */
  impact(g){
    burst(new THREE.Vector3(P.x,g+6,P.z-16),0xff8a3a,1.8);
    burst(new THREE.Vector3(P.x+10,g+9,P.z-24),0xffd08a,1.4);
    burst(new THREE.Vector3(P.x-11,g+5,P.z-12),0xd2452f,1.4);
  },
  nextThemeName(){ return THEMES[G.lvl%THEMES.length].name; },

  drawCockpit(t){ drawHUD(t); },

  /** Craft-specific handles and readings for the headless suite. */
  debug: {
    af, Rings, Fuel, Haz, Terrain,
    courseX: z => coursePathX(z),
    groundAt: (x,z) => groundH(x,z),
    extra: () => ({ afPhase: af.phase })
  }
};

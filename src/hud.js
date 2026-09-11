// Skylark Run — the cockpit, drawn in 2D over the world.
//
// Everything the pilot reads: brass gauges, the gate ladder, the approach
// picture and the damage accumulating on the cowling. It is a plain canvas
// overlay rather than geometry, which keeps it sharp on a phone and costs
// under a millisecond a frame.
//
// This is the most aircraft-specific part of the game, so it is the piece a
// helicopter will replace wholesale rather than reuse.
/* global THREE */
import { H, W, camera, hctx } from './view.js';
import { clamp, hash } from './util.js';
import { splats } from './damage.js';
import { G, Game, P, S, TO, dents, popups } from './state.js';
import { gDrops } from './weather.js';
import { CANOPY_H, LAT_CLAMP, MAX_VX, MAX_VY, MAX_Y, MIN_CLEAR, PR, SPEED0, SPEED_MAX, SPEED_RAMP, VIEW } from './config.js';
import { Airfield, Fuel, Haz, Rings, af, coursePathX, groundH } from './countryside.js';
import { CAN_TILT, haveTilt, permState } from './input.js';

// ---------- HUD: the open cockpit, drawn in 2D over the world ----------
const _mark=new THREE.Vector3();

function brassGauge(x,y,r,val,label,warn,ticks){
  hctx.save();
  // brass bezel
  const bz=hctx.createLinearGradient(x-r,y-r,x+r,y+r);
  bz.addColorStop(0,"#f0d08a"); bz.addColorStop(0.45,"#c8993f");
  bz.addColorStop(0.7,"#8a6a2a"); bz.addColorStop(1,"#e0c079");
  hctx.fillStyle=bz;
  hctx.beginPath();hctx.arc(x,y,r*1.10,0,7);hctx.fill();
  hctx.fillStyle="#151210";
  hctx.beginPath();hctx.arc(x,y,r,0,7);hctx.fill();
  // dial face
  const fg=hctx.createRadialGradient(x-r*0.3,y-r*0.4,r*0.1,x,y,r);
  fg.addColorStop(0,"#2c2723"); fg.addColorStop(1,"#100e0c");
  hctx.fillStyle=fg;
  hctx.beginPath();hctx.arc(x,y,r*0.96,0,7);hctx.fill();
  const a0=Math.PI*0.75, sweep=Math.PI*1.5;
  hctx.strokeStyle="#8f8878";hctx.lineWidth=Math.max(1,r*0.055);
  const nt=ticks||6;
  for(let i=0;i<=nt;i++){
    const a=a0+sweep*i/nt, major=i%2===0;
    hctx.beginPath();
    hctx.moveTo(x+Math.cos(a)*r*(major?0.68:0.76),y+Math.sin(a)*r*(major?0.68:0.76));
    hctx.lineTo(x+Math.cos(a)*r*0.88,y+Math.sin(a)*r*0.88);
    hctx.stroke();
  }
  hctx.strokeStyle="#c33a28";hctx.lineWidth=Math.max(2,r*0.10);
  hctx.beginPath();hctx.arc(x,y,r*0.80,a0+sweep*0.86,a0+sweep);hctx.stroke();
  // needle
  const a=a0+sweep*clamp(val,0,1);
  hctx.strokeStyle=warn?"#ff6a52":"#f4ead4";hctx.lineWidth=Math.max(1.8,r*0.09);
  hctx.lineCap="round";
  hctx.beginPath();
  hctx.moveTo(x-Math.cos(a)*r*0.17,y-Math.sin(a)*r*0.17);
  hctx.lineTo(x+Math.cos(a)*r*0.76,y+Math.sin(a)*r*0.76);
  hctx.stroke();
  hctx.fillStyle="#6a6154";hctx.beginPath();hctx.arc(x,y,r*0.11,0,7);hctx.fill();
  hctx.fillStyle="#9a917e";
  hctx.font="600 "+Math.max(7,r*0.30)+"px ui-monospace,Menlo,Consolas,monospace";
  hctx.textAlign="center";hctx.textBaseline="middle";
  hctx.fillText(label,x,y+r*0.50);
  // glass glint
  hctx.globalAlpha=0.10;
  hctx.fillStyle="#ffffff";
  hctx.beginPath();hctx.ellipse(x-r*0.28,y-r*0.36,r*0.52,r*0.30,-0.6,0,7);hctx.fill();
  hctx.globalAlpha=1;
  hctx.restore();
}
function drawSplats(){
  for(const s of splats){
    hctx.save();
    hctx.globalAlpha=0.55;
    hctx.fillStyle="#6d6a4a";
    hctx.beginPath();hctx.ellipse(s.x,s.y,s.r,s.r*0.72,s.seed,0,7);hctx.fill();
    hctx.fillStyle="#8f8a5e";
    for(let i=0;i<5;i++){
      const a=s.seed+i*1.3, d=s.r*(0.9+hash(s.seed+i)*0.9);
      hctx.beginPath();
      hctx.arc(s.x+Math.cos(a)*d,s.y+Math.sin(a)*d,s.r*0.22*(0.5+hash(s.seed*3+i)),0,7);
      hctx.fill();
    }
    hctx.globalAlpha=1;
    hctx.restore();
  }
}
function drawDents(){
  for(const d of dents){
    hctx.save();
    hctx.translate(d.x,d.y);
    hctx.strokeStyle="rgba(30,26,20,0.55)";hctx.lineWidth=1.4;
    hctx.beginPath();
    for(let i=0;i<=10;i++){
      const a=i/10*Math.PI*2;
      const rr=d.r*(0.6+hash(d.seed+i)*0.7);
      const px=Math.cos(a)*rr, py=Math.sin(a)*rr*0.7;
      if(i===0)hctx.moveTo(px,py);else hctx.lineTo(px,py);
    }
    hctx.stroke();
    hctx.fillStyle="rgba(255,255,255,0.10)";hctx.fill();
    hctx.strokeStyle="rgba(180,170,150,0.35)";hctx.lineWidth=1;
    for(let i=0;i<3;i++){
      const a=hash(d.seed*7+i)*6;
      hctx.beginPath();hctx.moveTo(0,0);
      hctx.lineTo(Math.cos(a)*d.r*1.4,Math.sin(a)*d.r*0.9);hctx.stroke();
    }
    hctx.restore();
  }
}
function drawHUD(t){
  hctx.clearRect(0,0,W,H);
  const ph=H*0.235, panelTop=H-ph;
  const cowlTop=panelTop-H*0.090;
  const wsTop=cowlTop-H*0.105;

  // ---- open-air effects ----
  if(Game.whiteout>0){
    hctx.fillStyle="rgba(238,244,250,"+(Game.whiteout*0.80).toFixed(3)+")";
    hctx.fillRect(0,0,W,H);
  }
  if(Game.flash>0){hctx.fillStyle="rgba(210,70,40,"+(Game.flash*0.36).toFixed(3)+")";hctx.fillRect(0,0,W,H);}
  // slipstream streaks tearing past the open sides
  {
    const sp=clamp((P.speed-50)/90,0,1);
    hctx.save();
    hctx.globalAlpha=0.10+sp*0.22;
    hctx.strokeStyle="#ffffff";hctx.lineWidth=1.4;
    for(let i=0;i<16;i++){
      const k=((t*0.0014*(0.6+sp))+i*0.0625)%1;
      const side=i%2?1:-1;
      const y=H*0.10+((i*97)%100)/100*H*0.62;
      const x0=W*0.5+side*(W*0.20+k*W*0.42);
      const len=(28+k*150)*(0.5+sp);
      hctx.beginPath();hctx.moveTo(x0,y);hctx.lineTo(x0+side*len,y+len*0.10*side);hctx.stroke();
    }
    hctx.restore();
  }

  // ---- cockpit rigid body: head lag, no vibration ----
  const ox=clamp(P.vx*0.26,-26,26);
  const oy=clamp(-P.vy*0.20,-18,18);
  hctx.save();
  hctx.translate(ox,oy);

  // ---- propeller: two blades in front of everything ----
  {
    // the disc is drawn larger than the screen so no rim ever shows
    const cx=W/2, cy=cowlTop+H*0.02, R=Math.hypot(W,H)*0.62;
    const ang=t*0.0012*Math.PI*2*7.4*(0.45+P.speed/SPEED_MAX*0.55);
    hctx.save();
    hctx.translate(cx,cy);
    for(let b=0;b<2;b++){
      hctx.save();
      hctx.rotate(ang+b*Math.PI);
      hctx.globalAlpha=0.11;
      hctx.fillStyle="#20180f";
      hctx.beginPath();
      hctx.moveTo(0,-6);hctx.lineTo(R,-R*0.022);
      hctx.lineTo(R,R*0.022);hctx.lineTo(0,6);
      hctx.closePath();hctx.fill();
      hctx.globalAlpha=0.04;hctx.rotate(-0.16);
      hctx.beginPath();
      hctx.moveTo(0,-6);hctx.lineTo(R,-R*0.045);
      hctx.lineTo(R,R*0.045);hctx.lineTo(0,6);
      hctx.closePath();hctx.fill();
      hctx.restore();
    }
    // spinner and the hub blur just above the cowl
    hctx.globalAlpha=0.9;
    hctx.fillStyle="#7a8a72";
    hctx.beginPath();hctx.ellipse(0,-H*0.005,W*0.020,H*0.026,0,0,7);hctx.fill();
    hctx.fillStyle="rgba(255,255,255,0.18)";
    hctx.beginPath();hctx.ellipse(-W*0.006,-H*0.012,W*0.007,H*0.010,0,0,7);hctx.fill();
    hctx.globalAlpha=1;
    hctx.restore();
  }

  // ---- parasol wing overhead, on its cabane struts ----
  {
    const wingBot=H*0.085, tipDrop=H*0.040;          // trailing edge across the top
    const strutFoot=wingBot+H*0.16;                  // cabane struts vanish behind the cowl
    hctx.save();
    // bracing wires first, so the wing sits over them
    hctx.strokeStyle="rgba(60,54,42,0.40)";hctx.lineWidth=1;
    for(const s of [-1,1]){
      hctx.beginPath();
      hctx.moveTo(W/2+s*W*0.075,strutFoot);
      hctx.lineTo(W/2+s*W*0.34,wingBot+tipDrop*0.30);
      hctx.stroke();
    }
    // cabane struts
    for(const s of [-1,1]){
      hctx.strokeStyle="#a89e88";hctx.lineWidth=Math.max(3,W*0.0038);
      hctx.lineCap="round";
      hctx.beginPath();
      hctx.moveTo(W/2+s*W*0.075,strutFoot);
      hctx.lineTo(W/2+s*W*0.125,wingBot-2);
      hctx.stroke();
      hctx.strokeStyle="rgba(40,36,28,0.40)";hctx.lineWidth=1;
      hctx.beginPath();
      hctx.moveTo(W/2+s*W*0.0765,strutFoot);
      hctx.lineTo(W/2+s*W*0.1265,wingBot-2);
      hctx.stroke();
    }
    // the wing underside
    hctx.beginPath();
    hctx.moveTo(-W*0.06,-2);
    hctx.lineTo(W*1.06,-2);
    hctx.lineTo(W*1.02,wingBot-tipDrop);
    hctx.quadraticCurveTo(W*0.5,wingBot+H*0.028,-W*0.02,wingBot-tipDrop);
    hctx.closePath();
    const wg=hctx.createLinearGradient(0,0,0,wingBot);
    wg.addColorStop(0,"#d8d0b4"); wg.addColorStop(0.55,"#c2b99c"); wg.addColorStop(1,"#9d9480");
    hctx.fillStyle=wg;hctx.fill();
    hctx.strokeStyle="#726a56";hctx.lineWidth=1.6;hctx.stroke();
    // rib stitching across the fabric
    hctx.strokeStyle="rgba(110,102,82,0.55)";hctx.lineWidth=1.1;
    for(let i=1;i<14;i++){
      const x=W*(i/14);
      const drop=wingBot-tipDrop+Math.sin(Math.PI*(i/14))*H*0.030;
      hctx.beginPath();hctx.moveTo(x,-2);hctx.lineTo(x,drop);hctx.stroke();
    }
    // roundels under each wing panel
    for(const s of [-1,1]){
      const rx=W/2+s*W*0.30, ry=wingBot*0.52, rr=Math.min(W,H)*0.034;
      hctx.fillStyle="#2b4f86";hctx.beginPath();hctx.ellipse(rx,ry,rr,rr*0.80,0,0,7);hctx.fill();
      hctx.fillStyle="#f2ecd8";hctx.beginPath();hctx.ellipse(rx,ry,rr*0.62,rr*0.50,0,0,7);hctx.fill();
      hctx.fillStyle="#c33a28";hctx.beginPath();hctx.ellipse(rx,ry,rr*0.26,rr*0.21,0,0,7);hctx.fill();
    }
    // shadow the wing casts into the cockpit
    const sh=hctx.createLinearGradient(0,wingBot-6,0,wingBot+H*0.10);
    sh.addColorStop(0,"rgba(30,34,40,0.28)");
    sh.addColorStop(1,"rgba(30,34,40,0)");
    hctx.fillStyle=sh;hctx.fillRect(0,wingBot-6,W,H*0.10);
    hctx.restore();
  }

  // ---- engine cowling ----
  {
    const cg=hctx.createLinearGradient(0,cowlTop,0,panelTop+8);
    cg.addColorStop(0,"#3f5a48"); cg.addColorStop(0.45,"#2f4738"); cg.addColorStop(1,"#1d2c24");
    hctx.fillStyle=cg;
    hctx.beginPath();
    hctx.moveTo(W*0.16,panelTop+10);
    hctx.quadraticCurveTo(W*0.24,cowlTop+H*0.012,W*0.34,cowlTop);
    hctx.lineTo(W*0.66,cowlTop);
    hctx.quadraticCurveTo(W*0.76,cowlTop+H*0.012,W*0.84,panelTop+10);
    hctx.closePath();hctx.fill();
    // top highlight
    hctx.strokeStyle="rgba(230,240,225,0.30)";hctx.lineWidth=2;
    hctx.beginPath();
    hctx.moveTo(W*0.345,cowlTop+2);hctx.lineTo(W*0.655,cowlTop+2);hctx.stroke();
    // rivet lines and panel seams
    hctx.fillStyle="rgba(20,26,22,0.75)";
    for(let i=0;i<16;i++){
      const k=i/15, px=W*(0.345+k*0.31);
      hctx.beginPath();hctx.arc(px,cowlTop+H*0.016,1.7,0,7);hctx.fill();
      hctx.beginPath();hctx.arc(px,panelTop-H*0.012,1.7,0,7);hctx.fill();
    }
    hctx.strokeStyle="rgba(18,24,20,0.8)";hctx.lineWidth=1.4;
    hctx.beginPath();hctx.moveTo(W*0.42,cowlTop+2);hctx.lineTo(W*0.40,panelTop+8);hctx.stroke();
    hctx.beginPath();hctx.moveTo(W*0.58,cowlTop+2);hctx.lineTo(W*0.60,panelTop+8);hctx.stroke();
    // filler cap
    hctx.fillStyle="#7a8a72";
    hctx.beginPath();hctx.ellipse(W*0.375,cowlTop+H*0.045,W*0.016,H*0.010,0,0,7);hctx.fill();
    hctx.strokeStyle="#4a5a4a";hctx.lineWidth=1.2;hctx.stroke();
    // exhaust stubs with soot
    for(const s of [-1,1]){
      const ex=W/2+s*W*0.19;
      hctx.fillStyle="#3a332c";
      hctx.beginPath();hctx.ellipse(ex,panelTop-H*0.028,W*0.012,H*0.011,0,0,7);hctx.fill();
      hctx.globalAlpha=0.30;hctx.fillStyle="#15120f";
      hctx.beginPath();hctx.ellipse(ex+s*W*0.03,panelTop-H*0.022,W*0.045,H*0.020,0,0,7);hctx.fill();
      hctx.globalAlpha=1;
    }
    // oil smears on a tired engine
    if(P.lives<=2){
      hctx.globalAlpha=0.22;hctx.fillStyle="#1a1408";
      for(let i=0;i<5;i++){
        const px=W*(0.40+hash(i*7)*0.20), py=cowlTop+H*0.02+hash(i*3)*H*0.05;
        hctx.beginPath();hctx.ellipse(px,py,W*0.012,H*0.030,0.2,0,7);hctx.fill();
      }
      hctx.globalAlpha=1;
    }
  }

  // ---- windscreen: small, curved, scratched ----
  {
    hctx.save();
    hctx.beginPath();
    hctx.moveTo(W*0.345,cowlTop+2);
    hctx.quadraticCurveTo(W*0.50,wsTop,W*0.655,cowlTop+2);
    hctx.closePath();
    hctx.save();
    hctx.clip();
    hctx.globalAlpha=0.10;
    hctx.fillStyle="#cfe6f2";hctx.fillRect(W*0.33,wsTop-4,W*0.34,H*0.2);
    hctx.globalAlpha=0.16;
    const sg=hctx.createLinearGradient(W*0.35,wsTop,W*0.62,cowlTop);
    sg.addColorStop(0,"rgba(255,255,255,0)");
    sg.addColorStop(0.35,"rgba(255,255,255,0.9)");
    sg.addColorStop(0.5,"rgba(255,255,255,0)");
    sg.addColorStop(0.72,"rgba(255,255,255,0.5)");
    sg.addColorStop(0.85,"rgba(255,255,255,0)");
    hctx.fillStyle=sg;hctx.fillRect(W*0.33,wsTop-4,W*0.34,H*0.2);
    hctx.globalAlpha=1;
    drawSplats();
    // rain beading on the glass
    if(Game.weather===2){
      const nowR=performance.now();
      if(Math.random()<0.35&&gDrops.length<70)
        gDrops.push({x:W*(0.35+Math.random()*0.30),y:wsTop+Math.random()*(cowlTop-wsTop),
          r:1.4+Math.random()*2.4,t0:nowR});
      for(let i=gDrops.length-1;i>=0;i--){
        const d=gDrops[i];
        d.y+=0.35+d.r*0.20;
        if(nowR-d.t0>5200||d.y>cowlTop){gDrops.splice(i,1);continue;}
        hctx.fillStyle="rgba(200,220,240,0.30)";
        hctx.beginPath();hctx.arc(d.x,d.y,d.r,0,7);hctx.fill();
        hctx.fillStyle="rgba(255,255,255,0.35)";
        hctx.fillRect(d.x-d.r*0.3,d.y-d.r*0.5,d.r*0.5,d.r*0.5);
      }
    }
    hctx.restore();
    // brass frame
    hctx.lineWidth=Math.max(3,H*0.008);
    const fg2=hctx.createLinearGradient(W*0.34,wsTop,W*0.66,cowlTop);
    fg2.addColorStop(0,"#e8c887");fg2.addColorStop(0.5,"#a8823a");fg2.addColorStop(1,"#e0bd76");
    hctx.strokeStyle=fg2;
    hctx.stroke();
    hctx.restore();
  }

  // ---- instrument panel ----
  {
    const pg=hctx.createLinearGradient(0,panelTop,0,H);
    pg.addColorStop(0,"#4a3520"); pg.addColorStop(0.18,"#3a2818"); pg.addColorStop(1,"#241a10");
    hctx.fillStyle=pg;
    hctx.beginPath();
    hctx.moveTo(-40,panelTop+H*0.02);
    hctx.quadraticCurveTo(W*0.5,panelTop-H*0.028,W+40,panelTop+H*0.02);
    hctx.lineTo(W+40,H+40);hctx.lineTo(-40,H+40);
    hctx.closePath();hctx.fill();
    // wood grain
    hctx.save();
    hctx.globalAlpha=0.16;
    hctx.strokeStyle="#7a5a30";hctx.lineWidth=1;
    for(let i=0;i<28;i++){
      const y=panelTop+H*0.02+i*(ph/26);
      hctx.beginPath();
      hctx.moveTo(0,y);
      for(let x=0;x<=W;x+=40) hctx.lineTo(x,y+Math.sin(x*0.012+i)*2.2);
      hctx.stroke();
    }
    hctx.restore();
    // padded leather coaming along the top edge
    hctx.strokeStyle="#1a120a";hctx.lineWidth=Math.max(6,H*0.017);
    hctx.beginPath();
    hctx.moveTo(-40,panelTop+H*0.02);
    hctx.quadraticCurveTo(W*0.5,panelTop-H*0.028,W+40,panelTop+H*0.02);
    hctx.stroke();
    hctx.strokeStyle="rgba(190,160,120,0.30)";hctx.lineWidth=1.4;
    hctx.beginPath();
    hctx.moveTo(-40,panelTop+H*0.012);
    hctx.quadraticCurveTo(W*0.5,panelTop-H*0.036,W+40,panelTop+H*0.012);
    hctx.stroke();
    // stitching
    hctx.fillStyle="rgba(210,180,130,0.45)";
    for(let x=W*0.02;x<W;x+=W*0.035){
      const k=(x/W-0.5)*2;
      hctx.fillRect(x,panelTop+H*0.016-Math.cos(k*1.4)*H*0.020,5,1.5);
    }
  }

  const cy=panelTop+ph*0.50, gr=ph*0.29;
  // ---- gauges ----
  brassGauge(W*0.275,cy,gr,clamp(P.speed/SPEED_MAX,0,1),"A.S.I.",P.speed<40,8);
  brassGauge(W*0.385,cy,gr,clamp(P.y/MAX_Y,0,1),"ALT",P.y-groundH(P.x,P.z)<40,10);
  brassGauge(W*0.615,cy,gr,clamp(G.fuel/100,0,1),"FUEL",G.fuel<25,6);
  const rpm=0.70+Math.sin(t*0.011)*0.012+(P.speed/SPEED_MAX)*0.22;
  brassGauge(W*0.725,cy,gr,rpm,"R.P.M.",false,8);
  // ---- turn & bank, centre of the panel ----
  {
    const x=W*0.50, y=cy, r=gr*1.05;
    const bz=hctx.createLinearGradient(x-r,y-r,x+r,y+r);
    bz.addColorStop(0,"#f0d08a");bz.addColorStop(0.5,"#c8993f");bz.addColorStop(1,"#8a6a2a");
    hctx.fillStyle=bz;hctx.beginPath();hctx.arc(x,y,r*1.10,0,7);hctx.fill();
    hctx.fillStyle="#100e0c";hctx.beginPath();hctx.arc(x,y,r,0,7);hctx.fill();
    // little aeroplane that rolls with you
    hctx.save();
    hctx.translate(x,y-r*0.22);
    hctx.rotate(-P.roll*0.9);
    hctx.strokeStyle="#f4ead4";hctx.lineWidth=Math.max(2,r*0.10);hctx.lineCap="round";
    hctx.beginPath();hctx.moveTo(-r*0.62,0);hctx.lineTo(r*0.62,0);hctx.stroke();
    hctx.beginPath();hctx.moveTo(0,0);hctx.lineTo(0,-r*0.26);hctx.stroke();
    hctx.restore();
    // slip ball in its curved tube
    hctx.strokeStyle="#5a5348";hctx.lineWidth=Math.max(4,r*0.20);
    hctx.beginPath();hctx.arc(x,y-r*0.70,r*1.25,Math.PI*0.30,Math.PI*0.70);hctx.stroke();
    const slip=clamp((P.vx/MAX_VX)-P.roll*2.1,-1,1);
    const ba=Math.PI*0.5+slip*Math.PI*0.18;
    hctx.fillStyle="#20201c";
    hctx.beginPath();
    hctx.arc(x+Math.cos(ba)*r*1.25,y-r*0.70+Math.sin(ba)*r*1.25,r*0.14,0,7);hctx.fill();
    hctx.fillStyle="#e8e0c8";
    hctx.beginPath();
    hctx.arc(x+Math.cos(ba)*r*1.25,y-r*0.70+Math.sin(ba)*r*1.25,r*0.11,0,7);hctx.fill();
    hctx.fillStyle="#9a917e";
    hctx.font="600 "+Math.max(7,r*0.26)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.textAlign="center";hctx.textBaseline="middle";
    hctx.fillText("TURN & BANK",x,y+r*0.62);
  }

  // ---- magnetic compass, mounted on the cowl ----
  {
    const x=W*0.50, y=cowlTop+H*0.055, r=H*0.045;
    hctx.save();
    hctx.fillStyle="#1a1712";
    hctx.beginPath();hctx.arc(x,y,r*1.18,0,7);hctx.fill();
    hctx.strokeStyle="#c8993f";hctx.lineWidth=2.4;
    hctx.beginPath();hctx.arc(x,y,r*1.18,0,7);hctx.stroke();
    hctx.beginPath();hctx.arc(x,y,r,0,7);hctx.clip();
    hctx.fillStyle="#2a2620";hctx.fillRect(x-r,y-r,r*2,r*2);
    const head=(-P.roll*26+Game.wind*0.5+360)%360;       // the card swings as you bank
    hctx.fillStyle="#e8e0c8";
    hctx.font="700 "+Math.max(8,r*0.44)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.textAlign="center";hctx.textBaseline="middle";
    const px=r/16;                                  // pixels per degree on the card
    const marks=[["N",0],["3",30],["6",60],["E",90],["12",120],["15",150],
                 ["S",180],["21",210],["24",240],["W",270],["30",300],["33",330]];
    for(const m of marks){
      const d=((m[1]-head+540)%360)-180;
      if(Math.abs(d)>26) continue;
      hctx.fillText(m[0],x+d*px,y);
    }
    hctx.strokeStyle="rgba(200,190,160,0.5)";hctx.lineWidth=1;
    for(let dg=-30;dg<=30;dg+=10){
      const d=((dg-(head%10)+540)%360)-180;
      hctx.beginPath();hctx.moveTo(x+d*px,y+r*0.55);hctx.lineTo(x+d*px,y+r*0.80);hctx.stroke();
    }
    hctx.restore();
    hctx.strokeStyle="#d2452f";hctx.lineWidth=1.8;
    hctx.beginPath();hctx.moveTo(x,y-r*0.95);hctx.lineTo(x,y+r*0.95);hctx.stroke();
  }

  // ---- chart board on the pilot's knee ----
  {
    const mw=W*0.155, mh=ph*0.80, mx=W*0.020, my=panelTop+ph*0.12;
    hctx.fillStyle="#20180e";hctx.fillRect(mx-5,my-5,mw+10,mh+16);
    hctx.fillStyle="#e8dcc0";hctx.fillRect(mx,my,mw,mh);
    hctx.save();
    hctx.beginPath();hctx.rect(mx,my,mw,mh);hctx.clip();
    const RANGE=1500, HALF=560;
    const map=(wx,wz)=>({x:mx+mw/2+(wx-P.x)/HALF*(mw/2), y:my+mh-((P.z-wz)/RANGE)*mh});
    // pencilled contour hatching
    hctx.strokeStyle="rgba(150,130,95,0.45)";hctx.lineWidth=1;
    for(let i=0;i<7;i++){
      hctx.beginPath();
      for(let j=0;j<=10;j++){
        const wz=P.z-RANGE*(j/10), wx=P.x-HALF+ (i/6)*HALF*2;
        const p=map(wx+Math.sin(wz*0.002+i)*40,wz);
        if(j===0)hctx.moveTo(p.x,p.y);else hctx.lineTo(p.x,p.y);
      }
      hctx.stroke();
    }
    // the course line drawn through the gates
    hctx.strokeStyle="#8a4a2a";hctx.lineWidth=1.6;
    hctx.beginPath();
    for(let j=0;j<=24;j++){
      const wz=P.z-RANGE*(j/24);
      const p=map(coursePathX(wz),wz);
      if(j===0)hctx.moveTo(p.x,p.y);else hctx.lineTo(p.x,p.y);
    }
    hctx.stroke();
    for(const r of Rings.list){                    // gates
      if(!r.active||r.z>P.z||P.z-r.z>RANGE)continue;
      const p=map(r.x,r.z);
      hctx.strokeStyle=r.hit?"#3f8f4f":(r.gold?"#c08a12":"#c33a28");
      hctx.lineWidth=r.gold?2.2:1.6;
      hctx.beginPath();hctx.arc(p.x,p.y,r.gold?3.4:2.6,0,7);hctx.stroke();
    }
    hctx.fillStyle="#2f7f4f";                       // fuel
    for(const f of Fuel.list){
      if(!f.active||f.z>P.z||P.z-f.z>RANGE)continue;
      const p=map(f.x,f.z);
      hctx.fillRect(p.x-2,p.y-2,4,4);
    }
    hctx.fillStyle="#7a2a1a";                       // hazards
    for(const l of [Haz.masts,Haz.turbines,Haz.balloons]){
      for(const h of l){
        if(!h.active||h.z>P.z||P.z-h.z>RANGE)continue;
        const p=map(h.x,h.z);
        hctx.fillRect(p.x-1.5,p.y-1.5,3,3);
      }
    }
    hctx.strokeStyle="#7a2a1a";hctx.lineWidth=1.2;
    for(const h of Haz.lines){
      if(!h.active||h.z>P.z||P.z-h.z>RANGE)continue;
      const a=map(h.x-h.span/2,h.z), b=map(h.x+h.span/2,h.z);
      hctx.beginPath();hctx.moveTo(a.x,a.y);hctx.lineTo(b.x,b.y);hctx.stroke();
    }
    if(af.active&&af.z<P.z&&P.z-af.z<RANGE+af.len){ // the field
      const a=map(af.x,af.z+af.len/2), b=map(af.x,af.z-af.len/2);
      hctx.strokeStyle="#1a1a1a";hctx.lineWidth=3.4;
      hctx.beginPath();hctx.moveTo(a.x,a.y);hctx.lineTo(b.x,b.y);hctx.stroke();
    }
    hctx.fillStyle="#20180e";                       // own ship
    const me=map(P.x,P.z);
    hctx.beginPath();
    hctx.moveTo(me.x,me.y-5);hctx.lineTo(me.x-4,me.y+3);hctx.lineTo(me.x+4,me.y+3);
    hctx.closePath();hctx.fill();
    hctx.restore();
    hctx.strokeStyle="#8a6a3a";hctx.lineWidth=1;hctx.strokeRect(mx,my,mw,mh);
    hctx.fillStyle="rgba(90,70,40,0.65)";                 // pencilled title, on the paper
    hctx.font="600 "+Math.max(7,ph*0.10)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.textAlign="left";hctx.textBaseline="alphabetic";
    hctx.fillText("CHART",mx+4,my+mh-4);
  }

  // ---- readouts, right of the panel ----
  {
    hctx.textAlign="right";hctx.textBaseline="middle";
    hctx.font="700 "+Math.max(11,H*0.026)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.fillStyle="#f2dfa8";
    hctx.fillText("SCORE "+Math.floor(G.score).toLocaleString(),W*0.982,panelTop+ph*0.26);
    hctx.fillStyle="#e8dcc0";
    hctx.font="600 "+Math.max(10,H*0.022)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.fillText("RINGS "+G.ringsHit+"/"+G.rings+(G.combo>1?"   x"+G.combo:""),W*0.982,panelTop+ph*0.50);
    hctx.fillText("S"+G.lvl+"  "+(P.dist/1000).toFixed(2)+" km",W*0.982,panelTop+ph*0.70);
    hctx.fillStyle=P.lives<=1?"#ff7a5e":"#c8e8c0";
    hctx.fillText("AIRFRAME "+"■".repeat(Math.max(0,P.lives))+"□".repeat(Math.max(0,3-P.lives)),
      W*0.982,panelTop+ph*0.90);
    // sector progress along the top of the panel
    const lvlLen=5000+700*G.lvl;
    const prog=clamp(1-(G.levelEnd-P.dist)/lvlLen,0,1);
    hctx.fillStyle="rgba(20,14,8,0.7)";hctx.fillRect(W*0.80,panelTop+ph*0.06,W*0.18,4);
    hctx.fillStyle="#d9a441";hctx.fillRect(W*0.80,panelTop+ph*0.06,W*0.18*prog,4);
  }

  // ---- warning lamps on the panel face ----
  {
    const lamps=[
      ["FUEL","#ffae3a",G.fuel<20&&Math.floor(t/300)%2===0],
      ["TERR","#ff5a4e",Game.warnObst&&Math.floor(t/220)%2===0],
      ["GEAR","#8fe8a0",af.active&&(af.phase===1||af.phase===2||af.phase===4)],
    ];
    const lw=W*0.036, lh=ph*0.16;
    for(let i=0;i<3;i++){
      const lx=W*0.455+ (i-1)*(lw+6), ly=panelTop+ph*0.055;
      hctx.fillStyle=lamps[i][2]?lamps[i][1]:"rgba(30,22,14,0.85)";
      hctx.fillRect(lx,ly,lw,lh);
      hctx.strokeStyle="#15100a";hctx.lineWidth=1;hctx.strokeRect(lx,ly,lw,lh);
      hctx.fillStyle=lamps[i][2]?"#20180e":"#6a5f4c";
      hctx.font="700 "+Math.max(7,lh*0.55)+"px ui-monospace,Menlo,Consolas,monospace";
      hctx.textAlign="center";hctx.textBaseline="middle";
      hctx.fillText(lamps[i][0],lx+lw/2,ly+lh/2+0.5);
    }
  }

  // ---- control column between the knees ----
  {
    const bx=W*0.50, tipX=bx+(P.vx/MAX_VX)*16, tipY=H-ph*0.16-(P.vy/MAX_VY)*8;
    hctx.strokeStyle="#15110c";hctx.lineWidth=9;hctx.lineCap="round";
    hctx.beginPath();hctx.moveTo(bx,H+40);hctx.lineTo(tipX,tipY);hctx.stroke();
    hctx.strokeStyle="#3a3128";hctx.lineWidth=2.5;
    hctx.beginPath();hctx.moveTo(bx+2.5,H+40);hctx.lineTo(tipX+2.5,tipY+2);hctx.stroke();
    hctx.fillStyle="#241a10";
    hctx.beginPath();hctx.ellipse(tipX,tipY-5,8,13,(P.vx/MAX_VX)*0.3,0,7);hctx.fill();
    hctx.fillStyle="#c8993f";
    hctx.beginPath();hctx.arc(tipX,tipY-13,2.6,0,7);hctx.fill();
  }

  // ---- flying scarf, top corner ----
  {
    Game.scarfPhase+=0.05+P.speed*0.0006;
    hctx.save();
    hctx.globalAlpha=0.92;
    hctx.fillStyle="#f4ead4";
    hctx.beginPath();
    hctx.moveTo(W*0.96,-2);
    let px=W*0.96, py=-2;
    for(let i=1;i<=6;i++){
      const k=i/6;
      px=W*(0.96-k*0.26);
      py=H*(0.02+k*0.20)+Math.sin(Game.scarfPhase+i*0.9)*H*0.030*k;
      hctx.lineTo(px,py);
    }
    for(let i=6;i>=1;i--){
      const k=i/6;
      const qx=W*(0.96-k*0.26)+W*0.012;
      const qy=H*(0.02+k*0.20)+Math.sin(Game.scarfPhase+i*0.9)*H*0.030*k+H*0.030;
      hctx.lineTo(qx,qy);
    }
    hctx.lineTo(W*0.985,H*0.02);
    hctx.closePath();hctx.fill();
    hctx.globalAlpha=0.18;hctx.fillStyle="#8a7a5a";
    hctx.fill();
    hctx.restore();
  }

  drawDents();
  hctx.restore();   // end cockpit rigid-body transform

  // ---- floating score popups ----
  const now=performance.now();
  for(let i=popups.length-1;i>=0;i--){
    const age=(now-popups[i].t0)/1500;
    if(age>=1){popups.splice(i,1);continue;}
    hctx.globalAlpha=1-age;
    hctx.fillStyle="#fff0c4";
    hctx.strokeStyle="rgba(40,30,14,0.55)";hctx.lineWidth=3;
    hctx.font="800 "+Math.max(13,H*0.034)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.textAlign="center";hctx.textBaseline="middle";
    const py=H*0.24-(popups.length-1-i)*H*0.045-age*H*0.05;
    hctx.strokeText(popups[i].txt,W/2,py);
    hctx.fillText(popups[i].txt,W/2,py);
    hctx.globalAlpha=1;
  }
  // ---- hedge-hopping bonus ----
  if(Game.state===S.PLAY&&!af.active&&P.y-groundH(P.x,P.z)<45){
    hctx.globalAlpha=0.55+0.45*Math.sin(t*0.012);
    hctx.fillStyle="#c9ffd0";
    hctx.font="700 "+Math.max(10,H*0.024)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.textAlign="center";
    hctx.fillText("HEDGE HOPPING",W/2,H*0.36);
    hctx.globalAlpha=1;
  }
  // ---- next gate marker ----
  if(Game.state===S.PLAY&&!af.active){
    const g=Rings.nextGate();
    if(g){
      _mark.set(g.x,g.g.position.y,g.z).project(camera);
      if(_mark.z<1){
        let sx=(_mark.x*0.5+0.5)*W, sy=(1-(_mark.y*0.5+0.5))*H;
        const off=sx<W*0.07||sx>W*0.93||sy<H*0.16||sy>H*0.52;
        sx=clamp(sx,W*0.07,W*0.93); sy=clamp(sy,H*0.16,H*0.52);
        const rr=Math.max(14,H*0.038)*(1+0.10*Math.sin(t*0.008))*(g.gold?1.18:1);
        const col=g.gold?"#ffd24a":(off?"#ffae3a":"#fff0c4");
        hctx.strokeStyle=col;hctx.lineWidth=g.gold?3.4:2.6;
        hctx.beginPath();
        hctx.moveTo(sx,sy-rr);hctx.lineTo(sx+rr,sy);
        hctx.lineTo(sx,sy+rr);hctx.lineTo(sx-rr,sy);
        hctx.closePath();hctx.stroke();
        if(g.gold){                       // second ring, so it reads at a glance
          hctx.lineWidth=1.4;
          hctx.beginPath();
          hctx.moveTo(sx,sy-rr*0.62);hctx.lineTo(sx+rr*0.62,sy);
          hctx.lineTo(sx,sy+rr*0.62);hctx.lineTo(sx-rr*0.62,sy);
          hctx.closePath();hctx.stroke();
        }
        hctx.fillStyle=col;
        hctx.font="700 "+Math.max(10,H*0.022)+"px ui-monospace,Menlo,Consolas,monospace";
        hctx.textAlign="center";hctx.textBaseline="middle";
        hctx.fillText((g.gold?"GOLD ":"GATE ")+Math.max(0,Math.round(P.z-g.z))+"m",sx,sy+rr+H*0.028);
      }
    }
  }
  // ---- take-off guidance ----
  if(Game.state===S.TAKEOFF){
    hctx.textAlign="center";hctx.textBaseline="middle";
    hctx.globalAlpha=0.9;
    hctx.fillStyle="#fff0c4";
    hctx.font="800 "+Math.max(11,H*0.026)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.fillText(Game.readyT>0?"HOLDING — RUNWAY 18":(TO.lifted?"POSITIVE CLIMB":"TAKE-OFF ROLL"),W/2,H*0.075);
    hctx.globalAlpha=1;
    if(!TO.lifted){
      // centreline bar, same instrument the landing uses
      const bx=W*0.5, bw=W*0.24, by=H*0.135;
      hctx.strokeStyle="rgba(20,16,10,0.45)";hctx.lineWidth=8;
      hctx.beginPath();hctx.moveTo(bx-bw/2,by);hctx.lineTo(bx+bw/2,by);hctx.stroke();
      hctx.strokeStyle="#e8dcc0";hctx.lineWidth=2;
      hctx.beginPath();hctx.moveTo(bx,by-7);hctx.lineTo(bx,by+7);hctx.stroke();
      const dx=P.x-af.x;
      const px2=bx+clamp(dx/50,-1,1)*(bw/2);
      hctx.fillStyle=Math.abs(dx)<10?"#8fe8a0":"#ffae3a";
      hctx.beginPath();hctx.arc(px2,by,6,0,7);hctx.fill();
      // speed building toward Vr
      const sw=W*0.30, sx=W*0.5-sw/2, sy=H*0.175;
      hctx.fillStyle="rgba(20,16,10,0.45)";hctx.fillRect(sx,sy,sw,7);
      hctx.fillStyle="#d9a441";hctx.fillRect(sx,sy,sw*clamp(P.speed/TO.vr,0,1),7);
      hctx.fillStyle="#e8dcc0";hctx.fillRect(sx+sw-2,sy-4,2,15);
      hctx.font="700 "+Math.max(10,H*0.022)+"px ui-monospace,Menlo,Consolas,monospace";
      hctx.fillStyle="#fff0c4";
      const runLeft=Math.max(0,Math.round(P.z-(af.z-af.len*0.5)));
      hctx.fillText(P.speed>=TO.vr?"Vr — EASE BACK":"Vr "+Math.round(TO.vr*3.6)+" km/h   STRIP "+runLeft+" m",
        W/2,sy+H*0.045);
      if(P.speed>=TO.vr&&Math.floor(t/220)%2===0){
        hctx.fillStyle="#8fe8a0";
        hctx.font="800 "+Math.max(16,H*0.048)+"px ui-monospace,Menlo,Consolas,monospace";
        hctx.fillText("ROTATE",W/2,H*0.30);
      }
    }
  }
  // ---- landing guidance ----
  if((Game.state===S.PLAY||Game.state===S.ROLLOUT)&&af.active&&af.phase<3){
    hctx.textAlign="center";hctx.textBaseline="middle";
    hctx.globalAlpha=0.85;
    hctx.fillStyle="#fff0c4";
    hctx.font="800 "+Math.max(11,H*0.026)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.fillText(Game.state===S.ROLLOUT?"ROLLOUT — HOLD THE CENTRELINE":"FINAL APPROACH — RUNWAY 18",W/2,H*0.075);
    hctx.globalAlpha=1;
    if(Game.state===S.PLAY){
      const err=Airfield.glideError();
      const dz=Math.max(0,Math.round(P.z-af.z-af.len*0.5));
      const dx=P.x-af.x;
      // glide slope ladder on the right
      const lx=W*0.90, ly=H*0.33, lh=H*0.22;
      hctx.strokeStyle="rgba(20,16,10,0.45)";hctx.lineWidth=8;
      hctx.beginPath();hctx.moveTo(lx,ly-lh/2);hctx.lineTo(lx,ly+lh/2);hctx.stroke();
      hctx.strokeStyle="#e8dcc0";hctx.lineWidth=2;
      for(let i=-2;i<=2;i++){
        const y=ly+i*(lh/4), w2=i===0?16:9;
        hctx.beginPath();hctx.moveTo(lx-w2,y);hctx.lineTo(lx+w2,y);hctx.stroke();
      }
      const ey=ly+clamp(-err/45,-1,1)*(lh/2);
      hctx.fillStyle=Math.abs(err)<14?"#8fe8a0":"#ffae3a";
      hctx.beginPath();
      hctx.moveTo(lx-20,ey);hctx.lineTo(lx-8,ey-6);hctx.lineTo(lx-8,ey+6);
      hctx.closePath();hctx.fill();
      hctx.font="600 "+Math.max(9,H*0.020)+"px ui-monospace,Menlo,Consolas,monospace";
      hctx.fillStyle="#e8dcc0";
      hctx.fillText(err>14?"HIGH":(err<-14?"LOW":"ON SLOPE"),lx,ly+lh/2+H*0.030);
      // centreline bar along the top
      const bx=W*0.5, bw=W*0.24;
      hctx.strokeStyle="rgba(20,16,10,0.45)";hctx.lineWidth=8;
      hctx.beginPath();hctx.moveTo(bx-bw/2,H*0.135);hctx.lineTo(bx+bw/2,H*0.135);hctx.stroke();
      hctx.strokeStyle="#e8dcc0";hctx.lineWidth=2;
      hctx.beginPath();hctx.moveTo(bx,H*0.135-7);hctx.lineTo(bx,H*0.135+7);hctx.stroke();
      const px2=bx+clamp(dx/90,-1,1)*(bw/2);
      hctx.fillStyle=Math.abs(dx)<12?"#8fe8a0":"#ffae3a";
      hctx.beginPath();hctx.arc(px2,H*0.135,6,0,7);hctx.fill();
      hctx.fillStyle="#fff0c4";
      hctx.font="700 "+Math.max(10,H*0.022)+"px ui-monospace,Menlo,Consolas,monospace";
      hctx.fillText("THRESHOLD "+dz+" m   SINK "+Math.round(Math.max(0,-P.vy))+" m/s",W/2,H*0.175);
    }
  }
  // ---- mayday ----
  if(Game.state===S.DYING&&Math.floor(t/180)%2===0){
    hctx.fillStyle="#ff5a4e";
    hctx.font="800 "+Math.max(18,H*0.055)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.textAlign="center";
    hctx.fillText("MAYDAY  MAYDAY",W/2,H*0.30);
  }
  // ---- 3-2-1 ----
  if(Game.state===S.PLAY&&Game.readyT>0){
    const n=Math.ceil(Game.readyT*1.5);
    const frac=(Game.readyT*1.5)%1||1;
    hctx.save();
    hctx.globalAlpha=Math.min(1,frac*2);
    hctx.fillStyle="#fff0c4";
    hctx.strokeStyle="rgba(40,30,14,0.6)";hctx.lineWidth=5;
    hctx.font="800 "+Math.max(40,H*0.16*(0.8+0.3*frac))+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.textAlign="center";hctx.textBaseline="middle";
    hctx.strokeText(String(n),W/2,H*0.34);
    hctx.fillText(String(n),W/2,H*0.34);
    hctx.restore();
  }
  // ---- tilt status ----
  // Only worth saying on a device that could have tilted; on a desktop the
  // keys are the expected controls, not a fallback.
  if(Game.state===S.PLAY&&!haveTilt&&CAN_TILT){
    hctx.fillStyle="#ffd98a";
    hctx.font="600 "+Math.max(9,H*0.020)+"px ui-monospace,Menlo,Consolas,monospace";
    hctx.textAlign="left";hctx.textBaseline="middle";
    hctx.fillText(permState==="denied"?"TILT DENIED — DRAG OR KEYS":"NO TILT — DRAG OR KEYS",W*0.02,H*0.035);
  }
}

export { drawHUD };

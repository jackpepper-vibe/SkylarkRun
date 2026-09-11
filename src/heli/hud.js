// Rotor — the cockpit.
//
// A different instrument set from the aeroplane's brass gauges: radar altitude
// against the rooftops, a torque and fuel stack, the pad director on approach,
// and cracks spreading across the windscreen as she takes hits.
/* global THREE */
import { hash, clamp, lerp, roundedPoly } from '../util.js';
import { S, Game, P, G, popups } from '../state.js';
import { hctx, W, H, camera } from '../view.js';
import { CAN_TILT, haveTilt, permState } from '../input.js';
import { gDrops } from '../weather.js';
import { cracks } from '../damage.js';
import { AMBER, AV, DANGER, FOGC, LANES, LAT_CLAMP, MAX_VX, MAX_VY, MAX_Y, MIN_Y, PR, ROW_SPACING, SPEED0, SPEED_MAX, SPEED_RAMP, STREETS, VIEW } from './config.js';
import { pad, activeB, diceAngle, rings, fuels, cranes, cables, drones } from './world.js';

// ---------- HUD (cockpit overlay) ----------
const _padV=new THREE.Vector3();
function drawCracks(){
  hctx.save();
  hctx.strokeStyle="rgba(230,235,255,0.55)";
  hctx.lineWidth=1.2;
  for(const c of cracks){
    for(let a=0;a<c.arms;a++){
      const ang=c.seed*7+a*(Math.PI*2/c.arms)+hash(c.seed+a)*0.8;
      const len=18+hash(c.seed*3+a)*38;
      const seg=3+Math.floor(hash(c.seed+a*7)*3);
      hctx.beginPath();hctx.moveTo(c.x,c.y);
      for(let s=1;s<=seg;s++){
        const rr=len*s/seg;
        hctx.lineTo(c.x+Math.cos(ang)*rr+(hash(c.seed*13+a+s)-0.5)*8,
                    c.y+Math.sin(ang)*rr+(hash(c.seed*17+a+s)-0.5)*8);
      }
      hctx.stroke();
    }
    hctx.globalAlpha=0.35;
    hctx.fillStyle="#e6ebff";
    hctx.beginPath();hctx.arc(c.x,c.y,3.5,0,7);hctx.fill();
    hctx.globalAlpha=1;
  }
  hctx.restore();
}
function gauge(x,y,r,val,label,warn){
  hctx.save();
  hctx.fillStyle="#0d0b09";
  hctx.beginPath();hctx.arc(x,y,r,0,7);hctx.fill();
  hctx.strokeStyle="#3a332c";hctx.lineWidth=3;
  hctx.beginPath();hctx.arc(x,y,r,0,7);hctx.stroke();
  hctx.strokeStyle="rgba(255,255,255,0.08)";hctx.lineWidth=r*0.18; // glass glint
  hctx.beginPath();hctx.arc(x,y,r*0.8,Math.PI*1.05,Math.PI*1.55);hctx.stroke();
  const a0=Math.PI*0.75, sweep=Math.PI*1.5;
  hctx.strokeStyle="#5a5248";hctx.lineWidth=1.5;
  for(let i=0;i<=6;i++){
    const a=a0+sweep*i/6;
    hctx.beginPath();
    hctx.moveTo(x+Math.cos(a)*r*0.72,y+Math.sin(a)*r*0.72);
    hctx.lineTo(x+Math.cos(a)*r*0.90,y+Math.sin(a)*r*0.90);
    hctx.stroke();
  }
  hctx.strokeStyle=DANGER;hctx.lineWidth=3; // redline arc
  hctx.beginPath();hctx.arc(x,y,r*0.81,a0+sweep*0.85,a0+sweep);hctx.stroke();
  const a=a0+sweep*Math.max(0,Math.min(1,val));
  hctx.strokeStyle=warn?DANGER:AMBER;hctx.lineWidth=2.5;
  hctx.beginPath();
  hctx.moveTo(x-Math.cos(a)*r*0.15,y-Math.sin(a)*r*0.15);
  hctx.lineTo(x+Math.cos(a)*r*0.78,y+Math.sin(a)*r*0.78);
  hctx.stroke();
  hctx.fillStyle="#3a332c";hctx.beginPath();hctx.arc(x,y,3,0,7);hctx.fill();
  hctx.fillStyle="#8a8072";
  hctx.font=`600 ${Math.max(8,r*0.34)}px ui-monospace,Menlo,Consolas,monospace`;
  hctx.textAlign="center";hctx.textBaseline="middle";
  hctx.fillText(label,x,y+r*0.52);
  hctx.restore();
}
function drawHUD(bank,t){
  hctx.clearRect(0,0,W,H);
  // vignette grade
  const vg=hctx.createRadialGradient(W/2,H*0.42,H*0.35,W/2,H*0.5,H*0.95);
  vg.addColorStop(0,"rgba(0,0,0,0)");vg.addColorStop(1,"rgba(10,5,20,0.42)");
  hctx.fillStyle=vg;hctx.fillRect(0,0,W,H);

  // smog layer: visibility collapses above ~195 m — high flying is not free
  if(P.y>195){
    const s=Math.min(1,(P.y-195)/55);
    hctx.fillStyle=`rgba(196,140,120,${(s*0.65).toFixed(3)})`;
    hctx.fillRect(0,0,W,H);
  }
  // lightning Game.flash
  if(Game.weather===1){
    const lf=Math.max(0,1-(t-boltT)/300);
    if(lf>0){
      hctx.fillStyle=`rgba(222,230,255,${(lf*0.55).toFixed(3)})`;
      hctx.fillRect(0,0,W,H);
    }
  }

  // windscreen glass sheen (two faint diagonal reflections)
  hctx.save();
  hctx.globalAlpha=0.05;
  const sg=hctx.createLinearGradient(0,0,W,H);
  sg.addColorStop(0.18,"rgba(255,255,255,0)");
  sg.addColorStop(0.28,"rgba(255,255,255,1)");
  sg.addColorStop(0.34,"rgba(255,255,255,0)");
  sg.addColorStop(0.55,"rgba(255,255,255,0)");
  sg.addColorStop(0.62,"rgba(255,255,255,0.7)");
  sg.addColorStop(0.70,"rgba(255,255,255,0)");
  hctx.fillStyle=sg;
  hctx.beginPath();
  hctx.moveTo(W*0.14,0);hctx.lineTo(W*0.86,0);
  hctx.lineTo(W*0.955,H*0.845);hctx.lineTo(W*0.045,H*0.845);
  hctx.closePath();hctx.fill();
  hctx.restore();

  if(Game.state===S.PLAY&&P.invuln>0&&Math.floor(t/120)%2===0){
    hctx.strokeStyle="#ff5a4e88";hctx.lineWidth=10;
    hctx.strokeRect(5,5,W-10,H-10);
  }
  if(Game.flash>0){hctx.fillStyle=`rgba(255,60,40,${Game.flash*0.4})`;hctx.fillRect(0,0,W,H);}

  // ---- cockpit rigid body: smooth head-lag sway (no vibration) ----
  const ox=Math.max(-24,Math.min(24,P.vx*0.28));
  const oy=Math.max(-18,Math.min(18,-P.vy*0.22));
  hctx.save();
  hctx.translate(ox,oy);
  const ph=H*0.155;

  // main rotor blades sweeping overhead
  {
    const R=H*1.1, ang=t*0.0012*Math.PI*2*6.5; // ~6.5 rev/s strobe
    hctx.save();
    hctx.translate(W/2,-H*0.62);
    for(let b2=0;b2<2;b2++){
      hctx.save();
      hctx.rotate(ang+b2*Math.PI);
      hctx.globalAlpha=0.14;
      hctx.fillStyle="#0a0806";
      hctx.beginPath();
      hctx.moveTo(0,-6);hctx.lineTo(R,-R*0.052);
      hctx.lineTo(R,R*0.052);hctx.lineTo(0,6);
      hctx.closePath();hctx.fill();
      hctx.globalAlpha=0.05; // trailing motion blur
      hctx.rotate(-0.10);
      hctx.beginPath();
      hctx.moveTo(0,-6);hctx.lineTo(R,-R*0.07);
      hctx.lineTo(R,R*0.07);hctx.lineTo(0,6);
      hctx.closePath();hctx.fill();
      hctx.restore();
    }
    hctx.globalAlpha=0.035;hctx.fillStyle="#000"; // faint rotor disc
    hctx.beginPath();hctx.arc(0,0,R,0,7);hctx.fill();
    hctx.restore();
  }

  // accumulated windscreen damage
  if(cracks.length) drawCracks();

  // rain on the glass + wiper
  if(Game.weather===1){
    const nowR=performance.now();
    const wpx=W*0.52, wpy=H-ph+8, wlen=H*0.60;
    const cyc=(nowR/3300)%1;
    let wang=-2.45;
    if(cyc<0.27){const k2=cyc/0.27; wang=-2.45+1.75*(k2<0.5?k2*2:2-k2*2);}
    for(let i=gDrops.length-1;i>=0;i--){
      const d2=gDrops[i];
      const da=Math.atan2(d2.y-wpy,d2.x-wpx);
      if(Math.abs(da-wang)<0.14){gDrops.splice(i,1);continue;} // wiped
      if(nowR-d2.t0>6500){gDrops.splice(i,1);continue;}
      hctx.fillStyle="rgba(190,210,235,0.28)";
      hctx.beginPath();hctx.arc(d2.x,d2.y,d2.r,0,7);hctx.fill();
      hctx.fillStyle="rgba(255,255,255,0.35)";
      hctx.fillRect(d2.x-d2.r*0.3,d2.y-d2.r*0.5,d2.r*0.5,d2.r*0.5);
    }
    // wiper arm + blade
    hctx.strokeStyle="#0d0b09";hctx.lineWidth=5;hctx.lineCap="round";
    hctx.beginPath();hctx.moveTo(wpx,wpy);
    hctx.lineTo(wpx+Math.cos(wang)*wlen,wpy+Math.sin(wang)*wlen);hctx.stroke();
    hctx.strokeStyle="#2a2521";hctx.lineWidth=2;
    hctx.beginPath();
    hctx.moveTo(wpx+Math.cos(wang)*wlen*0.35,wpy+Math.sin(wang)*wlen*0.35);
    hctx.lineTo(wpx+Math.cos(wang)*wlen,wpy+Math.sin(wang)*wlen);
    hctx.stroke();
  }

  // cockpit frame (oversized so the sway never reveals gaps)
  hctx.fillStyle="#14110f";
  hctx.beginPath();
  hctx.moveTo(-40,-40);hctx.lineTo(W*0.14,-40);hctx.lineTo(W*0.045,H-ph);hctx.lineTo(-40,H-ph);hctx.closePath();hctx.fill();
  hctx.beginPath();
  hctx.moveTo(W+40,-40);hctx.lineTo(W*0.86,-40);hctx.lineTo(W*0.955,H-ph);hctx.lineTo(W+40,H-ph);hctx.closePath();hctx.fill();
  hctx.fillRect(-40,-40,W+80,H*0.055+40);
  // sector progress bar
  {
    const lvlLen=4500+600*G.lvl, prog=Math.max(0,Math.min(1,1-(G.levelEnd-P.dist)/lvlLen));
    hctx.fillStyle="#241f1a";hctx.fillRect(W*0.055,H*0.036,W*0.14,4);
    hctx.fillStyle=AMBER;hctx.fillRect(W*0.055,H*0.036,W*0.14*prog,4);
  }
  // pillar inner-edge highlights (fake depth)
  hctx.strokeStyle="#3a332c";hctx.lineWidth=3;
  hctx.beginPath();hctx.moveTo(W*0.14,-2);hctx.lineTo(W*0.045,H-ph);hctx.stroke();
  hctx.beginPath();hctx.moveTo(W*0.86,-2);hctx.lineTo(W*0.955,H-ph);hctx.stroke();
  hctx.strokeStyle="#050403";hctx.lineWidth=1.5;
  hctx.beginPath();hctx.moveTo(W*0.148,-2);hctx.lineTo(W*0.053,H-ph);hctx.stroke();
  hctx.beginPath();hctx.moveTo(W*0.852,-2);hctx.lineTo(W*0.947,H-ph);hctx.stroke();
  hctx.fillStyle="#2a2521";
  for(let i=0;i<8;i++){
    hctx.beginPath();hctx.arc(W*0.10-i*1.2,H*0.12+i*(H-ph-H*0.12)/8,2.6,0,7);hctx.fill();
    hctx.beginPath();hctx.arc(W*0.90+i*1.2,H*0.12+i*(H-ph-H*0.12)/8,2.6,0,7);hctx.fill();
  }
  // lucky dice swinging from the frame
  {
    const px3=W*0.80, py3=H*0.052, L=H*0.075;
    const dx=px3+Math.sin(diceAngle())*L, dy=py3+Math.cos(diceAngle())*L;
    hctx.strokeStyle="#8a8072";hctx.lineWidth=1.2;
    hctx.beginPath();hctx.moveTo(px3,py3);hctx.lineTo(dx,dy);hctx.stroke();
    hctx.save();
    hctx.translate(dx,dy);hctx.rotate(diceAngle()*0.6);
    const ds=Math.max(6,H*0.016);
    hctx.fillStyle="#ff4fd8";
    hctx.fillRect(-ds/2,-ds/2,ds,ds);
    hctx.fillStyle="#fff";
    hctx.beginPath();hctx.arc(0,0,ds*0.12,0,7);hctx.fill();
    hctx.beginPath();hctx.arc(-ds*0.25,-ds*0.25,ds*0.12,0,7);hctx.fill();
    hctx.beginPath();hctx.arc(ds*0.25,ds*0.25,ds*0.12,0,7);hctx.fill();
    hctx.restore();
  }
  // door sills intruding at the lower corners
  hctx.fillStyle="#100d0b";
  hctx.beginPath();
  hctx.moveTo(-40,H-ph);hctx.quadraticCurveTo(W*0.10,H-ph-H*0.02,W*0.045,H-ph-H*0.16);
  hctx.lineTo(-40,H-ph-H*0.20);hctx.closePath();hctx.fill();
  hctx.beginPath();
  hctx.moveTo(W+40,H-ph);hctx.quadraticCurveTo(W*0.90,H-ph-H*0.02,W*0.955,H-ph-H*0.16);
  hctx.lineTo(W+40,H-ph-H*0.20);hctx.closePath();hctx.fill();
  // overhead console: toggle switches + caution lights
  const ocw=W*0.30, och=H*0.085, ocx=W/2-ocw/2;
  hctx.fillStyle="#181410";
  hctx.beginPath();
  hctx.moveTo(ocx,0);hctx.lineTo(ocx+ocw,0);
  hctx.lineTo(ocx+ocw-14,och);hctx.lineTo(ocx+14,och);
  hctx.closePath();hctx.fill();
  hctx.strokeStyle="#2a2521";hctx.lineWidth=2;hctx.stroke();
  const swOn=[pad.active,Game.weather===1,false]; // landing light, wiper, spare
  for(let i=0;i<3;i++){
    const sx=ocx+ocw*0.13+i*ocw*0.10, sy=och*0.52;
    hctx.strokeStyle="#3a332c";hctx.lineWidth=2;
    hctx.strokeRect(sx-4,sy-och*0.26,8,och*0.52);
    hctx.fillStyle=swOn[i]?"#7ef0d0":"#8a8072";
    hctx.beginPath();hctx.arc(sx,sy+(swOn[i]?och*0.14:-och*0.14),3.4,0,7);hctx.fill();
  }
  const lampW=ocw*0.115,lampH=och*0.30;
  const lamps=[
    ["ENG","#39d98a",true],
    ["FUEL","#ffae3a",G.fuel<20&&Math.floor(t/300)%2===0],
    ["ALT",DANGER,P.y<25&&Math.floor(t/260)%2===0],
    ["OBST","#ffae3a",Game.warnObst&&Math.floor(t/200)%2===0],
  ];
  hctx.font=`700 ${Math.max(7,lampH*0.5)}px ui-monospace,Menlo,Consolas,monospace`;
  hctx.textAlign="center";hctx.textBaseline="middle";
  for(let i=0;i<4;i++){
    const lx=ocx+ocw*0.44+(i%2)*(lampW+5), ly=och*0.16+Math.floor(i/2)*(lampH+5);
    const [txt,col,on]=lamps[i];
    hctx.fillStyle=on?col:"#241f1a";
    hctx.fillRect(lx,ly,lampW,lampH);
    hctx.strokeStyle="#0a0806";hctx.lineWidth=1;hctx.strokeRect(lx,ly,lampW,lampH);
    hctx.fillStyle=on?"#14110f":"#4a4238";
    hctx.fillText(txt,lx+lampW/2,ly+lampH/2+0.5);
  }
  // tilt status, tucked into the top frame left of the console
  hctx.font=`600 ${Math.max(10,H*0.024)}px ui-monospace,Menlo,Consolas,monospace`;
  // Only worth saying on a device that could have tilted. On a desktop the
  // keyboard is the expected control, not a fallback to apologise for.
  if(haveTilt){hctx.fillStyle=AV;hctx.fillText("TILT \u2713",W*0.245,H*0.028);}
  else if(CAN_TILT){
    hctx.fillStyle=AMBER;hctx.textAlign="right";
    hctx.fillText(permState==="denied"?"TILT DENIED \u2014 DRAG":"NO TILT \u2014 DRAG",ocx-10,H*0.028);
    hctx.textAlign="center";
  }

  // nose hull + pitot tube, visible beyond the glass
  hctx.fillStyle="#23202c";
  hctx.beginPath();
  hctx.moveTo(W*0.16,H-ph+6);
  hctx.quadraticCurveTo(W/2,H-ph-30,W*0.84,H-ph+6);
  hctx.closePath();hctx.fill();
  hctx.strokeStyle="#3a3650";hctx.lineWidth=1.5; // panel seam
  hctx.beginPath();
  hctx.moveTo(W*0.30,H-ph-2);hctx.quadraticCurveTo(W/2,H-ph-22,W*0.70,H-ph-2);
  hctx.stroke();
  hctx.strokeStyle="#181522";hctx.lineWidth=3;
  hctx.beginPath();hctx.moveTo(W/2,H-ph-15);hctx.lineTo(W/2,H-ph-32);hctx.stroke();
  hctx.beginPath();hctx.moveTo(W/2,H-ph-32);hctx.lineTo(W*0.515,H-ph-36);hctx.stroke();

  // centre windscreen strut, console down to glareshield
  hctx.fillStyle="#14110f";
  hctx.beginPath();
  hctx.moveTo(W/2-4,och);hctx.lineTo(W/2+4,och);
  hctx.lineTo(W/2+6,H-ph-8);hctx.lineTo(W/2-6,H-ph-8);
  hctx.closePath();hctx.fill();
  hctx.strokeStyle="#3a332c";hctx.lineWidth=1;
  hctx.beginPath();hctx.moveTo(W/2-4,och);hctx.lineTo(W/2-5.5,H-ph-8);hctx.stroke();
  hctx.fillStyle="#2a2521";
  for(let i=1;i<=3;i++){
    hctx.beginPath();hctx.arc(W/2,och+(H-ph-8-och)*i/4,2,0,7);hctx.fill();
  }

  // dash
  const g=hctx.createLinearGradient(0,H-ph,0,H);
  g.addColorStop(0,"#1c1815");g.addColorStop(1,"#0d0b09");
  hctx.fillStyle=g;hctx.fillRect(-40,H-ph,W+80,ph+60);
  hctx.strokeStyle="#3a332c";hctx.lineWidth=2;
  hctx.beginPath();hctx.moveTo(0,H-ph);hctx.lineTo(W,H-ph);hctx.stroke();

  // glareshield cowl over the instruments
  hctx.fillStyle="#100d0b";
  hctx.beginPath();
  hctx.moveTo(-40,H-ph+3);
  hctx.quadraticCurveTo(W/2,H-ph-13,W+40,H-ph+3);
  hctx.lineTo(W+40,H-ph+14);hctx.lineTo(-40,H-ph+14);
  hctx.closePath();hctx.fill();
  hctx.strokeStyle="#4a4238";hctx.lineWidth=1;
  hctx.beginPath();
  hctx.moveTo(-40,H-ph+3);hctx.quadraticCurveTo(W/2,H-ph-13,W+40,H-ph+3);
  hctx.stroke();

  // night instrument backlighting
  if(Game.curTod===1||Game.curTod===2){
    const nb=hctx.createLinearGradient(0,H-ph,0,H);
    nb.addColorStop(0,"rgba(255,140,80,0.10)");
    nb.addColorStop(1,"rgba(255,140,80,0.02)");
    hctx.fillStyle=nb;hctx.fillRect(-40,H-ph,W+80,ph+60);
  }
  // last hull point: MASTER CAUTION + smoke from the dash
  if((Game.state===S.PLAY||Game.state===S.DYING)&&P.lives<=1){
    if(Math.floor(t/350)%2===0){
      const cw2=W*0.115,ch2=ph*0.24,cx2=W*0.615,cy2=H-ph-ch2-8;
      hctx.fillStyle="#ffae3a";hctx.fillRect(cx2,cy2,cw2,ch2);
      hctx.fillStyle="#14110f";
      hctx.font=`800 ${Math.max(7,ch2*0.5)}px ui-monospace,Menlo,Consolas,monospace`;
      hctx.textAlign="center";hctx.textBaseline="middle";
      hctx.fillText("MASTER CAUTION",cx2+cw2/2,cy2+ch2/2);
    }
    for(let i=0;i<4;i++){
      const k=((t*0.00035)+i*0.25)%1;
      const sx3=W*0.60+i*W*0.012+Math.sin(k*6+i)*8;
      const sy3=H-ph-k*H*0.16;
      hctx.fillStyle=`rgba(120,120,130,${(0.16*(1-k)).toFixed(3)})`;
      hctx.beginPath();hctx.arc(sx3,sy3,4+k*10,0,7);hctx.fill();
    }
  }

  // curved fillets where the pillars meet the dash
  hctx.fillStyle="#14110f";
  hctx.beginPath();
  hctx.moveTo(W*0.045,H-ph);hctx.quadraticCurveTo(W*0.10,H-ph,W*0.115,H-ph-H*0.06);
  hctx.lineTo(W*0.045,H-ph-H*0.09);hctx.closePath();hctx.fill();
  hctx.beginPath();
  hctx.moveTo(W*0.955,H-ph);hctx.quadraticCurveTo(W*0.90,H-ph,W*0.885,H-ph-H*0.06);
  hctx.lineTo(W*0.955,H-ph-H*0.09);hctx.closePath();hctx.fill();
  // instrument glow spilling onto the glass
  const iglow=hctx.createLinearGradient(0,H-ph-18,0,H-ph);
  iglow.addColorStop(0,"rgba(255,190,110,0)");iglow.addColorStop(1,"rgba(255,190,110,0.10)");
  hctx.fillStyle=iglow;hctx.fillRect(W*0.05,H-ph-18,W*0.90,18);
  // dash screws
  hctx.fillStyle="#3a332c";
  for(const fx of [0.06,0.35,0.65,0.94]){
    hctx.beginPath();hctx.arc(W*fx,H-ph+8,2.4,0,7);hctx.fill();
  }

  const cy=H-ph/2;
  hctx.font=`600 ${Math.max(11,H*0.028)}px ui-monospace,Menlo,Consolas,monospace`;
  hctx.textAlign="left";hctx.fillStyle=AV;
  hctx.fillText("SPD "+Math.round(P.speed*3.6).toString().padStart(3," ")+" km/h",W*0.075,cy-ph*0.18);
  hctx.fillStyle=P.y<25?DANGER:AV;
  hctx.fillText("ALT "+Math.round(P.y).toString().padStart(3," ")+" m",W*0.075,cy+ph*0.18);
  hctx.textAlign="right";hctx.fillStyle=AMBER;
  hctx.fillText("SCORE "+Math.floor(G.score).toLocaleString(),W*0.925,cy-ph*0.18);
  hctx.fillText("L"+G.lvl+" "+(P.dist/1000).toFixed(2)+"km  HULL "+"\u25A0".repeat(Math.max(0,P.lives))+"\u25A1".repeat(Math.max(0,3-P.lives)),W*0.925,cy+ph*0.18);

  // artificial horizon
  const r=ph*0.42,ix=W/2,iy=cy;
  hctx.save();
  hctx.beginPath();hctx.arc(ix,iy,r,0,7);hctx.clip();
  hctx.translate(ix,iy);hctx.rotate(-bank);
  const py=P.vy/MAX_VY*r*0.5;
  hctx.fillStyle="#2f5b8f";hctx.fillRect(-r*1.6,-r*1.6,r*3.2,r*1.6+py);
  hctx.fillStyle="#6e4a2c";hctx.fillRect(-r*1.6,py,r*3.2,r*1.6);
  hctx.strokeStyle="#f2ead9";hctx.lineWidth=1.5;
  hctx.beginPath();hctx.moveTo(-r*1.6,py);hctx.lineTo(r*1.6,py);hctx.stroke();
  hctx.restore();
  hctx.strokeStyle="#3a332c";hctx.lineWidth=4;
  hctx.beginPath();hctx.arc(ix,iy,r,0,7);hctx.stroke();
  hctx.strokeStyle=AMBER;hctx.lineWidth=2;
  hctx.beginPath();
  hctx.moveTo(ix-r*0.5,iy);hctx.lineTo(ix-r*0.15,iy);
  hctx.moveTo(ix+r*0.15,iy);hctx.lineTo(ix+r*0.5,iy);
  hctx.moveTo(ix,iy);hctx.arc(ix,iy,2,0,7);
  hctx.stroke();

  // instruments flanking the horizon: fuel (the clock) and rotor RPM
  const gr=ph*0.30;
  gauge(ix-ph*1.5,cy,gr,G.fuel/100,"FUEL",G.fuel<25);
  const rpm=0.72+Math.sin(t*0.013)*0.012+(P.vx/MAX_VX)*0.02;
  gauge(ix+ph*1.5,cy,gr,rpm,"RPM",false);

  // NAV unit on the glareshield: live moving map
  {
    const mw=ph*1.75, mh=ph*0.78, mx=W*0.295-mw/2, my=H-ph-mh-6;
    hctx.fillStyle="#0a0806";hctx.fillRect(mx-4,my-4,mw+8,mh+12);
    hctx.strokeStyle="#3a332c";hctx.lineWidth=2;hctx.strokeRect(mx-4,my-4,mw+8,mh+12);
    hctx.fillStyle="#04140e";hctx.fillRect(mx,my,mw,mh);
    hctx.save();
    hctx.beginPath();hctx.rect(mx,my,mw,mh);hctx.clip();
    const RANGE=520, HALFW=175;
    const map=(wx,wz)=>({x:mx+mw/2+(wx-P.x)/HALFW*(mw/2),
                         y:my+mh-((P.z-wz)/RANGE)*mh});
    hctx.fillStyle="#123528"; // buildings
    for(const b of activeB){
      if(b.z>P.z||P.z-b.z>RANGE)continue;
      const p=map(b.x,b.z);
      const bw2=b.w/HALFW*(mw/2), bd2=b.d/RANGE*mh;
      hctx.fillRect(p.x-bw2/2,p.y-bd2/2,Math.max(1.5,bw2),Math.max(1.5,bd2));
    }
    hctx.fillStyle=AMBER; // rings
    for(const r2 of rings){
      if(!r2.active)continue;const d2=r2.m.position;
      if(d2.z>P.z||P.z-d2.z>RANGE)continue;const p=map(d2.x,d2.z);
      hctx.beginPath();hctx.arc(p.x,p.y,2,0,7);hctx.fill();
    }
    hctx.fillStyle=AV; // fuel
    for(const f2 of fuels){
      if(!f2.active)continue;const d2=f2.m.position;
      if(d2.z>P.z||P.z-d2.z>RANGE)continue;const p=map(d2.x,d2.z);
      hctx.fillRect(p.x-2,p.y-2,4,4);
    }
    hctx.fillStyle=DANGER; // hazards
    for(const c2 of cranes){
      if(!c2.g.visible||c2.z>P.z||P.z-c2.z>RANGE)continue;
      const p=map(c2.x,c2.z);hctx.fillRect(p.x-1.5,p.y-1.5,3,3);
    }
    for(const d3 of drones){
      if(!d3.g.visible||d3.z>P.z||P.z-d3.z>RANGE)continue;
      const p=map(d3.x,d3.z);hctx.fillRect(p.x-1.5,p.y-1.5,3,3);
    }
    if(pad.active&&pad.z<P.z&&P.z-pad.z<RANGE){ // landing pad
      const p=map(pad.x,pad.z);
      hctx.strokeStyle="#39d98a";hctx.lineWidth=1.5;
      hctx.beginPath();hctx.arc(p.x,p.y,4,0,7);hctx.stroke();
    }
    hctx.fillStyle="#f2ead9"; // own-ship chevron
    hctx.beginPath();
    hctx.moveTo(mx+mw/2,my+mh-7);
    hctx.lineTo(mx+mw/2-4,my+mh-1);
    hctx.lineTo(mx+mw/2+4,my+mh-1);
    hctx.closePath();hctx.fill();
    hctx.restore();
    hctx.fillStyle="#5a5248";
    hctx.font=`600 ${Math.max(7,ph*0.14)}px ui-monospace,Menlo,Consolas,monospace`;
    hctx.textAlign="left";hctx.textBaseline="middle";
    hctx.fillText("NAV",mx+2,my+mh+5);
  }

  // cyclic stick, leaning with your input
  const sBx=W*0.447, sTipX=sBx+(P.vx/MAX_VX)*13, sTipY=H-ph*0.92-(P.vy/MAX_VY)*6;
  hctx.strokeStyle="#0d0b09";hctx.lineWidth=7;hctx.lineCap="round";
  hctx.beginPath();hctx.moveTo(sBx,H+30);hctx.lineTo(sTipX,sTipY);hctx.stroke();
  hctx.strokeStyle="#2a2521";hctx.lineWidth=2;
  hctx.beginPath();hctx.moveTo(sBx+2,H+30);hctx.lineTo(sTipX+2,sTipY+2);hctx.stroke();
  hctx.fillStyle="#1c1815"; // grip
  hctx.beginPath();hctx.ellipse(sTipX,sTipY-4,6,10,(P.vx/MAX_VX)*0.3,0,7);hctx.fill();
  hctx.fillStyle="#3a332c";
  hctx.beginPath();hctx.arc(sTipX,sTipY-10,2.2,0,7);hctx.fill();

  hctx.restore(); // end cockpit rigid-body transform

  // floating score popups
  const now=performance.now();
  for(let i=popups.length-1;i>=0;i--){
    const age=(now-popups[i].t0)/1400;
    if(age>=1){popups.splice(i,1);continue;}
    hctx.globalAlpha=1-age;
    hctx.fillStyle=AMBER;
    hctx.font=`800 ${Math.max(13,H*0.034)}px ui-monospace,Menlo,Consolas,monospace`;
    hctx.textAlign="center";hctx.textBaseline="middle";
    hctx.fillText(popups[i].txt,W/2,H*0.30-(popups.length-1-i)*H*0.045-age*H*0.05);
    hctx.globalAlpha=1;
  }
  // deck-run bonus indicator
  if(Game.state===S.PLAY&&P.y<42){
    hctx.globalAlpha=0.6+0.4*Math.sin(t*0.012);
    hctx.fillStyle=AV;
    hctx.font=`700 ${Math.max(10,H*0.024)}px ui-monospace,Menlo,Consolas,monospace`;
    hctx.textAlign="center";
    hctx.fillText("DECK RUN BONUS",W/2,H*0.40);
    hctx.globalAlpha=1;
  }
  // landing approach: tracking pad marker with glide guidance
  if(Game.state===S.PLAY&&pad.active){
    hctx.globalAlpha=0.75+0.25*Math.sin(t*0.010);
    hctx.fillStyle=AMBER;
    hctx.font=`800 ${Math.max(11,H*0.026)}px ui-monospace,Menlo,Consolas,monospace`;
    hctx.textAlign="center";hctx.textBaseline="middle";
    hctx.fillText("APPROACH",W/2,H*0.16);
    hctx.globalAlpha=1;
    _padV.set(pad.x,pad.h+2,pad.z).project(camera);
    if(_padV.z<1){
      let sx4=(_padV.x*0.5+0.5)*W, sy4=(1-(_padV.y*0.5+0.5))*H;
      sx4=Math.max(W*0.08,Math.min(W*0.92,sx4));
      sy4=Math.max(H*0.10,Math.min(H*0.70,sy4));
      const rr=Math.max(16,H*0.045)*(1+0.12*Math.sin(t*0.008));
      hctx.strokeStyle="#39d98a";hctx.lineWidth=3;
      hctx.beginPath();
      hctx.moveTo(sx4,sy4-rr);hctx.lineTo(sx4+rr,sy4);
      hctx.lineTo(sx4,sy4+rr);hctx.lineTo(sx4-rr,sy4);
      hctx.closePath();hctx.stroke();
      hctx.fillStyle="#39d98a";
      hctx.beginPath();hctx.arc(sx4,sy4,3,0,7);hctx.fill();
      hctx.font=`800 ${Math.max(11,H*0.028)}px ui-monospace,Menlo,Consolas,monospace`;
      hctx.fillText("PAD "+Math.max(0,Math.round(P.z-pad.z))+"m",sx4,sy4+rr+H*0.032);
      const dy2=P.y-(pad.h+2);
      if(dy2>25) hctx.fillText("\u25BC DESCEND",sx4,sy4+rr+H*0.066);
      else if(dy2<-2) hctx.fillText("\u25B2 CLIMB",sx4,sy4+rr+H*0.066);
    }
  }
  // mayday
  if(Game.state===S.DYING&&Math.floor(t/180)%2===0){
    hctx.fillStyle=DANGER;
    hctx.font=`800 ${Math.max(18,H*0.055)}px ui-monospace,Menlo,Consolas,monospace`;
    hctx.textAlign="center";
    hctx.fillText("MAYDAY  MAYDAY",W/2,H*0.34);
  }
  // 3-2-1 countdown
  if(Game.state===S.PLAY&&Game.readyT>0){
    const n=Math.ceil(Game.readyT*1.5);
    const frac=(Game.readyT*1.5)%1||1;
    hctx.save();
    hctx.globalAlpha=Math.min(1,frac*2);
    hctx.fillStyle=AMBER;
    hctx.font=`800 ${Math.max(40,H*0.16*(0.8+0.3*frac))}px ui-monospace,Menlo,Consolas,monospace`;
    hctx.textAlign="center";hctx.textBaseline="middle";
    hctx.fillText(String(n),W/2,H*0.36);
    hctx.restore();
  }
}


export { drawHUD as drawHeliHUD };

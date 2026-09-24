// Skylark Run — the 2D layer over the cockpit.
//
// The cockpit itself is geometry (cockpit.js). What is drawn here is what no
// real cockpit has: the gate marker, take-off and landing guidance, score
// popups, the countdown and the flashes — plus the slipstream, which reads
// better as flat streaks tearing past the edge of the view.
import * as THREE from 'three';
import { H, W, camera, hctx } from '../view.js';
import { clamp } from '../util.js';
import { G, Game, P, S, TO, popups } from '../state.js';
import { Airfield, Rings, af, groundH } from './world.js';
import { CAN_TILT, haveTilt, permState } from '../input.js';

// ---------- HUD ----------
const _mark=new THREE.Vector3();

function drawHUD(t){
  hctx.clearRect(0,0,W,H);

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

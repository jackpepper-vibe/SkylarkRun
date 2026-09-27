// Dragonfly — the front seat of a flex-wing microlight trike.
//
// There is almost nothing in front of you, which is the point. Your gloved
// hands are on the base bar; its two uprights rise either side of the view to
// the hang point above your head, with flying wires running out to the wing
// and forward to the keel. Overhead the sail's nose and leading edges show at
// the top of the view, bright panels of dacron glowing when the sun is behind
// them. Below, the pod's glassfibre nose and its little screen, a compact
// EFIS on the dash, and a phone clamped to the right upright showing the map
// and the run. The engine is a pusher behind the seat, so there is no
// propeller ahead — only the buzz.
//
// The wing hangs from its own pivot and answers the bar a little ahead of the
// pod, as a trike's does: it leads the roll and noses up as you push out.
import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from '../../util.js';
import { G, Game, P, S } from '../../state.js';
import { Aircraft } from '../aircraft.js';
import { SANS, V3, bakeStatics, canvasTex, cowlDamage, drawMap, fuselageSkin, glassMaterial,
         grime, LAMPS, read, std, strut, surface, tube } from './kit.js';

const APEX=V3(0,0.95,0.02);                      // the hang point: the A-frame's apex under the keel
const BAR={y:-0.17,z:-0.74,half:0.62};          // the base bar
const NOSE=V3(0,0.98,-2.20), TAIL=V3(0,1.04,1.60);
const TIP={x:4.9,y:1.12,le:0.30,te:0.66};
const leAt=u=>V3(u*TIP.x, lerp(NOSE.y,TIP.y,Math.abs(u)), lerp(NOSE.z,TIP.le,Math.abs(u)));

function paintSail(x,w,h){
  // u across the span (0 = left tip, 1 = right tip), v from leading edge (0) to trailing edge (1).
  // Canvas rows run from v=1 at the top (flipY), so the leading edge is at the bottom.
  x.fillStyle="#f4f2ec"; x.fillRect(0,0,w,h);
  const vy=v=>(1-v)*h;
  // chevrons of colour swept back from the keel
  const bands=[["#f07a1e",0.18,0.40],["#1f4f9a",0.46,0.58],["#f2c43a",0.64,0.72]];
  for(const [col,a,b] of bands){
    x.fillStyle=col; x.beginPath();
    x.moveTo(0,vy(a+0.25)); x.lineTo(w/2,vy(a)); x.lineTo(w,vy(a+0.25));
    x.lineTo(w,vy(b+0.25)); x.lineTo(w/2,vy(b)); x.lineTo(0,vy(b+0.25)); x.closePath(); x.fill();
  }
  // tip panels
  x.fillStyle="#c8321f"; x.fillRect(0,0,w*0.05,h); x.fillRect(w*0.95,0,w*0.05,h);
  // battens: dark lines chordwise, showing through the cloth
  for(let i=1;i<18;i++){
    const u=i/18; if(Math.abs(u-0.5)<0.02) continue;
    x.fillStyle="rgba(40,40,50,0.28)"; x.fillRect(u*w-2,vy(0.95),4,vy(0.10)-vy(0.95));
  }
  // seams and a little weathering
  x.strokeStyle="rgba(0,0,0,0.12)"; x.lineWidth=2;
  for(const v of [0.2,0.5,0.8]){ x.beginPath(); x.moveTo(0,vy(v+0.2)); x.lineTo(w/2,vy(v)); x.lineTo(w,vy(v+0.2)); x.stroke(); }
  const rng=mulberry32(3);
  for(let i=0;i<200;i++){ x.fillStyle=`rgba(80,70,50,${rng()*0.04})`; x.fillRect(rng()*w,rng()*h,10+rng()*50,2+rng()*6); }
  // the leading-edge pocket in dark Mylar
  x.fillStyle="#1c2a44"; x.fillRect(0,vy(0.08),w,vy(0)-vy(0.08));
}
function paintPod(x,w,h){
  x.fillStyle="#f3f2ee"; x.fillRect(0,0,w,h);
  // a swoosh along each side
  for(const s of [1,-1]){
    const v0=s>0?0.22:0.78;
    x.fillStyle="#1f4f9a"; x.beginPath();
    x.moveTo(0,(v0-0.03*s)*h); x.quadraticCurveTo(w*0.5,(v0+0.12*s)*h,w,(v0+0.02*s)*h);
    x.lineTo(w,(v0+0.09*s)*h); x.quadraticCurveTo(w*0.5,(v0+0.18*s)*h,0,(v0+0.05*s)*h); x.closePath(); x.fill();
    x.fillStyle="#f07a1e"; x.fillRect(0,(v0+0.065*s)*h-3,w,6);
  }
  x.strokeStyle="rgba(60,60,64,0.35)"; x.lineWidth=2;
  x.beginPath(); x.moveTo(w*0.5,h*0.35); x.lineTo(w*0.5,h*0.65); x.stroke();
}

export function build(){
  const root=new THREE.Group();
  const alu=std({color:"#dfe3e8",metalness:0.85,roughness:0.38});
  const anod=std({color:"#2a2c30",metalness:0.6,roughness:0.4});
  const wireMat=std({color:"#b8bcc0",metalness:1,roughness:0.3});
  const foam=std({color:"#141416",roughness:0.95});
  const glove=std({color:"#2a2522",roughness:0.8});
  const sleeve=std({color:"#2e3f5c",roughness:0.85});
  const glass=glassMaterial(0.04);

  // ---------- the wing: sail, leading edges, keel; the A-frame and its wires ----------
  const wing=new THREE.Group();
  const sailArt=canvasTex(1024,512,paintSail);
  const sailMat=std({map:sailArt.tex,roughness:0.85,side:THREE.DoubleSide,
    emissive:"#fff4e0",emissiveMap:sailArt.tex,emissiveIntensity:0});
  {
    const geo=surface(28,10,(u,v)=>{
      const s=u*2-1, a=Math.abs(s);
      const le=leAt(s), te=V3(s*TIP.x, lerp(TAIL.y,TIP.y-0.02,a), lerp(TAIL.z,TIP.te,a));
      const p=le.clone().lerp(te,v);
      p.y+=Math.sin(v*Math.PI)*0.14*(1-a*0.6);               // billow between the battens
      return p;
    });
    const sail=new THREE.Mesh(geo,sailMat);
    sail.castShadow=true; sail.receiveShadow=true;
    wing.add(sail);
    for(const s of [-1,1]){
      const pts=[]; for(let i=0;i<=10;i++) pts.push(leAt(s*i/10).add(V3(0,-0.02,0)));
      tube(wing,pts,0.055,std({color:"#1c2a44",roughness:0.45}),false,40);
      const tipCap=new THREE.Mesh(new THREE.SphereGeometry(0.06,12,8),anod); tipCap.position.copy(leAt(s)); wing.add(tipCap);
    }
    tube(wing,[NOSE.clone().add(V3(0,-0.05,0)),V3(0,1.00,0),TAIL.clone().add(V3(0,-0.05,0))],0.028,alu,false,24);
    const noseCone=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.22,14),std({color:"#1c2a44",roughness:0.4}));
    noseCone.rotation.x=-Math.PI/2; noseCone.position.copy(NOSE).add(V3(0,-0.03,-0.08)); wing.add(noseCone);
  }
  const bar=[V3(-BAR.half,BAR.y,BAR.z),V3(BAR.half,BAR.y,BAR.z)];
  for(const b of bar){
    strut(wing,b,APEX.clone().add(V3(Math.sign(b.x)*0.05,0,0)),0.024,0.013,alu,14);   // the uprights
    const knuckle=new THREE.Mesh(new THREE.SphereGeometry(0.03,12,10),anod); knuckle.position.copy(b); wing.add(knuckle);
    strut(wing,b,NOSE.clone().add(V3(0,-0.04,0.10)),0.0022,0.0022,wireMat,6);           // front wire
    strut(wing,b,leAt(Math.sign(b.x)*0.58).add(V3(0,-0.05,0.04)),0.0022,0.0022,wireMat,6);  // side wire
    strut(wing,b,TAIL.clone().add(V3(0,-0.05,-0.2)),0.0022,0.0022,wireMat,6);           // rear wire
  }
  strut(wing,bar[0],bar[1],0.016,0.016,alu,14);                                          // the base bar
  for(const s of [-1,1]) strut(wing,V3(s*0.42,BAR.y,BAR.z),V3(s*0.18,BAR.y,BAR.z),0.024,0.024,foam,14);
  // the pilot's hands on the bar, and the sleeves back to the shoulders
  for(const s of [-1,1]){
    const g=new THREE.Mesh(new THREE.CapsuleGeometry(0.034,0.07,6,12),glove);
    g.rotation.z=Math.PI/2; g.scale.set(1,1,0.8); g.position.set(s*0.29,BAR.y+0.012,BAR.z+0.01);
    g.castShadow=true; wing.add(g);
    const thumb=new THREE.Mesh(new THREE.CapsuleGeometry(0.012,0.03,4,8),glove);
    thumb.position.set(s*0.24,BAR.y+0.03,BAR.z+0.03); thumb.rotation.set(0.9,0,-s*0.6); wing.add(thumb);
    // cuff, forearm and on down out of sight toward the elbow
    tube(wing,[V3(s*0.30,BAR.y+0.005,BAR.z+0.05),V3(s*0.33,BAR.y-0.10,BAR.z+0.20),V3(s*0.37,BAR.y-0.36,BAR.z+0.42)],0.028,sleeve,false,16);
    const cuff=new THREE.Mesh(new THREE.CylinderGeometry(0.036,0.036,0.03,14),foam);
    cuff.position.set(s*0.305,BAR.y-0.005,BAR.z+0.06); cuff.rotation.x=-0.75; wing.add(cuff);
  }
  bakeStatics(wing);
  wing.userData.dynamic=true;
  // the wing pivots about the hang point
  const pivot=new THREE.Group(); pivot.position.copy(APEX); pivot.userData.dynamic=true;
  wing.position.copy(APEX).multiplyScalar(-1);
  pivot.add(wing); root.add(pivot);
  // the mast from the hang point down behind the seat
  strut(root,APEX,V3(0,-0.9,0.45),0.03,0.03,alu,12);

  // ---------- the pod: glassfibre nose, a small screen, the dash ----------
  const podArt=canvasTex(512,256,paintPod);
  {
    const pod=new THREE.Mesh(fuselageSkin(-0.40,-1.38,k=>lerp(0.34,0.10,Math.pow(k,1.2)),
      k=>lerp(-0.33,-0.80,Math.pow(k,1.8)),0.45,-1.15,30,28),
      new THREE.MeshPhysicalMaterial({map:podArt.tex,roughness:0.3,clearcoat:0.8,clearcoatRoughness:0.1}));
    pod.castShadow=true; pod.receiveShadow=true; root.add(pod);
  }
  const damage=cowlDamage(podArt,()=>paintPod(podArt.ctx,512,256),{w:512,h:256,style:"gel",region:[0.2,0.6,0.40,0.60]});
  const dirt=grime(384,128);
  {
    const shape=(u,v)=>{ const phi=(u-0.5)*1.5; return V3(0.30*Math.sin(phi),-0.36+v*0.19,-0.36-0.30*Math.cos(phi)+v*0.10); };
    const geo=surface(16,4,shape);
    root.add(new THREE.Mesh(geo,glass));
    const tint=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:"#20303e",transparent:true,opacity:0.22,depthWrite:false,side:THREE.DoubleSide}));
    root.add(tint);
    const gm=new THREE.Mesh(geo,dirt.mat); gm.renderOrder=1; gm.userData.dynamic=true; root.add(gm);
    const edge=[]; for(let i=0;i<=16;i++) edge.push(shape(i/16,1));
    tube(root,edge,0.004,anod,false,32);
  }
  // the EFIS on the dash, tilted up at the pilot
  const efis=canvasTex(384,256,null);
  {
    const g=new THREE.Group(); g.position.set(0,-0.285,-0.50); g.rotation.x=-0.55;
    const box=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.105,0.04),anod); box.position.z=-0.02; box.castShadow=true;
    const face=new THREE.Mesh(new THREE.PlaneGeometry(0.132,0.088),std({color:0x000000,roughness:0.15,
      emissive:0xffffff,emissiveMap:efis.tex,emissiveIntensity:0.95}));
    face.position.z=0.0005; face.userData.dynamic=true;
    const hood=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.006,0.04),anod); hood.position.set(0,0.055,0.0);
    g.add(box,face,hood); root.add(g);
  }
  // the phone on its mount, clamped to the right upright
  const phone=canvasTex(256,512,null);
  const phoneGroup=new THREE.Group();
  {
    const g=phoneGroup; g.position.set(0.44,-0.055,-0.62);
    const body=new THREE.Mesh(new THREE.BoxGeometry(0.074,0.150,0.009),std({color:"#15161a",roughness:0.4})); body.position.z=-0.005;
    const face=new THREE.Mesh(new THREE.PlaneGeometry(0.066,0.140),std({color:0x000000,roughness:0.08,
      emissive:0xffffff,emissiveMap:phone.tex,emissiveIntensity:1.0}));
    face.userData.dynamic=true;
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.007,0.007,0.08,10),anod);
    arm.rotation.z=Math.PI/2; arm.position.set(0.05,0,-0.02);
    g.add(body,face,arm);
    g.lookAt(0,0.02,0.1);
    // it rides on the upright; at rest the wing's frame is the cockpit's, so
    // the position carries over unchanged
    wing.add(g);
  }

  bakeStatics(root);

  function drawEfis(t){
    const x=efis.ctx, w=384, h=256, spec=Aircraft.spec;
    x.fillStyle="#03060a"; x.fillRect(0,0,w,h);
    x.fillStyle="#6f8aa0"; x.font="700 18px "+SANS; x.textBaseline="alphabetic"; x.textAlign="left";
    x.fillText("KM/H",16,30); x.textAlign="right"; x.fillText("ALT M",w-16,30);
    x.fillStyle="#fff"; x.font="700 64px "+SANS; x.textAlign="left"; x.fillText(String(Math.round(P.speed*3.6)),12,92);
    x.textAlign="right"; x.fillText(String(Math.round(P.y)),w-12,92);
    // the rev counter as an arc across the middle
    const rpm=clamp(read.rpm(t),0,1), cx=w/2, cy=150, r=62;
    x.lineWidth=12; x.strokeStyle="#1e2830"; x.beginPath(); x.arc(cx,cy,r,Math.PI*0.9,Math.PI*2.1); x.stroke();
    x.strokeStyle=rpm>0.9?"#ff4d4d":"#3fe07a"; x.beginPath(); x.arc(cx,cy,r,Math.PI*0.9,Math.PI*(0.9+1.2*rpm)); x.stroke();
    x.fillStyle="#fff"; x.font="700 26px "+SANS; x.textAlign="center"; x.fillText(String(Math.round(rpm*6800/10)*10),cx,cy+10);
    x.fillStyle="#6f8aa0"; x.font="700 14px "+SANS; x.fillText("RPM",cx,cy+30);
    // fuel
    x.fillStyle="#6f8aa0"; x.font="700 16px "+SANS; x.textAlign="left"; x.fillText("FUEL",16,200);
    x.fillStyle="#1e2830"; x.fillRect(16,208,110,14);
    x.fillStyle=G.fuel<20?"#ff4d4d":"#4fd8ff"; x.fillRect(16,208,110*clamp(G.fuel/100,0,1),14);
    // the three warnings as on-screen badges
    LAMPS.forEach(([label,col,on,blink],i)=>{
      const lit=on()&&(!blink||Math.floor(t/260)%2===0);
      x.fillStyle=lit?col:"#10161c"; x.fillRect(w-190+i*60,200,52,26);
      x.fillStyle=lit?"#000":"#34424e"; x.font="800 15px "+SANS; x.textAlign="center"; x.fillText(label,w-164+i*60,219);
    });
    efis.tex.needsUpdate=true;
  }
  function drawPhone(){
    const x=phone.ctx, w=256, h=512, lives=Aircraft.spec.lives;
    x.save(); x.translate(0,118); drawMap(x,w,h-118,"glass"); x.restore();
    x.fillStyle="#0b1016"; x.fillRect(0,0,w,118);
    x.fillStyle="#9fd4ff"; x.font="700 16px "+SANS; x.textAlign="left"; x.textBaseline="alphabetic";
    x.fillText("SCORE",12,24); x.textAlign="right"; x.fillText("S"+G.lvl,w-12,24);
    x.fillStyle="#fff"; x.font="700 40px "+SANS; x.textAlign="left"; x.fillText(Math.floor(G.score).toLocaleString(),10,66);
    x.font="700 20px "+SANS; x.fillText("RINGS "+G.ringsHit+"/"+G.rings+(G.combo>1?"  x"+G.combo:""),12,96);
    for(let i=0;i<lives;i++){ x.fillStyle=i<P.lives?(P.lives<=1?"#ff4d4d":"#3fe07a"):"#1e2830"; x.fillRect(w-16-(lives-i)*22,82,18,12); }
    x.fillStyle="#4fd8ff"; x.fillRect(0,112,w*(1-(G.levelEnd-P.dist)/G.levelLen),5);
    phone.tex.needsUpdate=true;
  }

  let efisT=0, phoneT=0, rel={roll:0,pitch:0};
  return {
    root,
    shadow:{center:[0,0.3,-0.6],half:5.2},
    envIntensity:0.8,
    rumble:0.0007,
    update(t,dt,f){
      // translucent dacron: the sun behind the sail lights it up
      sailMat.emissiveIntensity=0.10+Math.max(0,f.sunL.y)*0.75;
      // the wing leads the pod: rolls ahead of it into a turn, noses up as the bar goes out
      const spec=Aircraft.spec, k=1-Math.exp(-dt*5);
      const flying=Game.state!==S.MENU||Game.hangar;
      rel.roll+=((flying?clamp(P.vx/spec.maxVx,-1,1)*0.10:0)-rel.roll)*k;
      rel.pitch+=((flying?clamp(P.vy/spec.maxVy,-1,1)*0.07:0)-rel.pitch)*k;
      pivot.rotation.set(rel.pitch,0,-rel.roll);
      damage.update();
      dirt.update(t,dt);
      efisT-=dt; phoneT-=dt;
      if(efisT<=0){ drawEfis(t); efisT=1/15; }
      if(phoneT<=0){ drawPhone(); phoneT=0.15; }
    }
  };
}

// Linnet — the rear cockpit of a tandem open-cockpit biplane trainer.
//
// Flown solo from the back seat, as trainers are: ahead is a long yellow
// fabric decking with the empty front cockpit let into it and its own little
// windscreen, then a polished aluminium engine cowling and a wooden propeller.
// Overhead the top wing stands on its cabane struts with the fuel tank in the
// centre section and a float gauge hanging under it; out to either side the
// interplane struts and a cross of flying and landing wires tie it to the
// bottom wing. The panel is black-painted plywood with a handful of dials and
// three jewel lamps; a chart is clipped on the left, the logbook card on the right.
import * as THREE from 'three';
import { clamp, lerp, smooth, mulberry32 } from '../../util.js';
import { G, P } from '../../state.js';
import { MAX_VX } from '../config.js';
import { MONO, V3, airfoilWing, bakeStatics, canvasTex, cowlDamage, dialSet, drawMap, drawRun,
         fuselageSkin, glassMaterial, grime, LAMPS, propeller, read, runKey, std, strut, surface,
         tube, updateLamps } from './kit.js';

const YELLOW="#dfa92e";
const Z_COAM=-0.45, Z_NOSE=-3.05;
const K_FRONT0=0.27, K_FRONT1=0.50, K_COWL=0.69;   // front cockpit, and where the metal cowling starts
const PROP_Y=-0.42, PROP_Z=-3.14;
const PANEL_Z=-0.48, PW=0.31;
const UP={y:0.74, le:-1.90, c:1.30, span:4.4};       // the top wing
const LO={y:-0.97, le:-1.62, c:1.30, span:4.2};      // the bottom wing
const BAY=2.55;                                       // interplane struts, from the centreline

const hw=k=>k<0.5?lerp(0.33,0.36,smooth(k/0.5)):lerp(0.36,0.25,smooth((k-0.5)/0.5));
const top=k=>lerp(-0.205,-0.37,Math.pow(k,1.25));
const zAt=k=>lerp(Z_COAM,Z_NOSE,k);

function paintFuselage(x,w,h){
  x.fillStyle=YELLOW; x.fillRect(0,0,w,h);
  const rng=mulberry32(31);
  for(let i=0;i<1400;i++){                                       // doped fabric, gently uneven
    x.fillStyle=`rgba(${rng()<0.5?"120,80,10":"255,235,170"},${0.03+rng()*0.04})`;
    x.fillRect(rng()*w,rng()*h,6+rng()*40,2+rng()*6);
  }
  // stringers showing through the fabric along the decking
  for(const v of [0.30,0.38,0.46,0.54,0.62,0.70]){
    x.fillStyle="rgba(120,80,20,0.14)"; x.fillRect(0,v*h-2,w*K_COWL,4);
    x.fillStyle="rgba(255,240,190,0.16)"; x.fillRect(0,v*h+2,w*K_COWL,2);
  }
  // the front cockpit: a dark hole in the decking
  const cu=(K_FRONT0+K_FRONT1)/2*w, du=(K_FRONT1-K_FRONT0)/2*w;
  const g=x.createRadialGradient(cu,h*0.5,4,cu,h*0.5,du);
  g.addColorStop(0,"#0c0a08"); g.addColorStop(0.85,"#1e1812"); g.addColorStop(1,"#2e2418");
  x.fillStyle=g; x.beginPath(); x.ellipse(cu,h*0.5,du,h*0.12,0,0,7); x.fill();
  // the aluminium engine cowling: panels, fasteners, louvres
  const uc=K_COWL*w;
  const mg=x.createLinearGradient(0,0,0,h);
  mg.addColorStop(0,"#8f9396"); mg.addColorStop(0.5,"#d4d7d9"); mg.addColorStop(1,"#8f9396");
  x.fillStyle=mg; x.fillRect(uc,0,w-uc,h);
  for(let i=0;i<500;i++){ x.fillStyle=`rgba(255,255,255,${rng()*0.05})`; x.fillRect(uc+rng()*(w-uc),rng()*h,20+rng()*60,1); }
  x.strokeStyle="rgba(40,42,44,0.7)"; x.lineWidth=2;
  x.beginPath(); x.moveTo(uc,0); x.lineTo(uc,h); x.stroke();
  for(const v of [0.34,0.66]){ x.beginPath(); x.moveTo(uc,v*h); x.lineTo(w,v*h); x.stroke(); }
  x.fillStyle="rgba(40,42,44,0.8)";
  for(let u=uc+10;u<w;u+=18) for(const v of [0.32,0.68]){ x.beginPath(); x.arc(u,v*h,1.8,0,7); x.fill(); }
  for(const vc of [0.18,0.82]) for(let i=0;i<9;i++){
    const u=uc+30+i*22;
    x.fillStyle="rgba(10,10,10,0.8)"; x.fillRect(u,vc*h-22,8,44);
    x.fillStyle="rgba(255,255,255,0.4)"; x.fillRect(u+8,vc*h-22,2,44);
  }
  // oil and exhaust stain streaming back from the cowling on the left
  const sg=x.createLinearGradient(uc+40,0,uc-260,0);
  sg.addColorStop(0,"rgba(30,24,16,0.45)"); sg.addColorStop(1,"rgba(30,24,16,0)");
  x.fillStyle=sg; x.fillRect(uc-260,h*0.08,300,h*0.14);
}

function paintWing(x,w,h,label){
  // u along the span, v round the section (the underside is v > 0.5)
  x.fillStyle=YELLOW; x.fillRect(0,0,w,h);
  const rng=mulberry32(label.length*7);
  for(let u=0;u<w;u+=w/28){                                      // rib tapes, stitched
    x.fillStyle="rgba(130,90,20,0.22)"; x.fillRect(u-3,0,6,h);
    x.fillStyle="rgba(255,240,190,0.22)"; x.fillRect(u-1,0,2,h);
    x.fillStyle="rgba(100,70,20,0.3)"; for(let v=4;v<h;v+=10) x.fillRect(u-0.5,v,1,3);
  }
  for(const v of [0.30,0.70,0.58,0.42]){ x.fillStyle="rgba(120,80,20,0.12)"; x.fillRect(0,v*h-6,w,12); }
  for(let i=0;i<260;i++){ x.fillStyle=`rgba(90,60,10,${rng()*0.05})`; x.fillRect(rng()*w,rng()*h,10+rng()*60,2+rng()*6); }
  // the leading-edge tape and the red wingtips
  x.fillStyle="rgba(150,100,20,0.3)"; x.fillRect(0,h*0.46,w,h*0.08);
  // u runs root to tip on every panel, so the tip is always the far end
  x.fillStyle="#b8321f"; x.fillRect(w-w*0.035,0,w*0.035,h);
}

export function build(){
  const root=new THREE.Group();
  const steel=std({color:"#b8bcbe",metalness:1,roughness:0.28});
  const leather=std({color:"#4a2c16",roughness:0.6});
  const strutWood=std({color:"#6a4424",roughness:0.45});
  const wireMat=std({color:"#c8ccce",metalness:1,roughness:0.25});
  const panelBlack=std({color:"#141312",roughness:0.75});
  const boardMat=std({color:"#3a2a18",roughness:0.6});
  const glass=glassMaterial();

  // ---------- the fuselage: fabric decking, the front cockpit, the metal cowling ----------
  const skinArt=canvasTex(2048,512,paintFuselage);
  const skin=new THREE.Mesh(fuselageSkin(Z_COAM,Z_NOSE,hw,top,0.52),
    std({map:skinArt.tex,roughness:0.62,metalness:0.08}));
  skin.castShadow=true; skin.receiveShadow=true;
  root.add(skin);
  const damage=cowlDamage(skinArt,()=>paintFuselage(skinArt.ctx,2048,512),
    {w:2048,h:512,style:"fabric",region:[0.04,0.24,0.40,0.60]});
  // the front cockpit's leather rim, and its own little windscreen
  {
    const zc=zAt((K_FRONT0+K_FRONT1)/2), dz=(zAt(K_FRONT0)-zAt(K_FRONT1))/2;
    const pts=[];
    for(let i=0;i<24;i++){
      const a=i/24*Math.PI*2, z=zc+Math.cos(a)*dz, k=(z-Z_COAM)/(Z_NOSE-Z_COAM);
      pts.push(V3(Math.sin(a)*hw(k)*0.66,top(k)+0.012,z));
    }
    tube(root,pts,0.018,leather,true,64);
    const zs=zAt(K_FRONT0)-0.02, ks=(zs-Z_COAM)/(Z_NOSE-Z_COAM), yb=top(ks);
    const shape=(u,v)=>{ const phi=(u-0.5)*1.2; return V3(0.22*Math.sin(phi),yb+v*0.11,zs+0.22-0.22*Math.cos(phi)+v*0.05); };
    root.add(new THREE.Mesh(surface(12,3,shape),glass));
    tube(root,[shape(0,1),shape(0.25,1),shape(0.5,1),shape(0.75,1),shape(1,1)],0.005,steel);
  }
  // the sides alongside the pilot
  {
    const side=std({color:YELLOW,roughness:0.6});
    const inner=std({color:"#3a2c1c",roughness:0.9});
    for(const sx of [-1,1]){
      const o=new THREE.Mesh(new THREE.PlaneGeometry(1.3,0.85),side);
      o.position.set(sx*0.34,-0.66,0.18); o.rotation.y=sx*Math.PI/2; o.receiveShadow=true; root.add(o);
      const w=new THREE.Mesh(new THREE.PlaneGeometry(1.2,0.8),inner);
      w.position.set(sx*0.30,-0.64,0.16); w.rotation.y=-sx*Math.PI/2; w.receiveShadow=true; root.add(w);
    }
    const pts=[];                                                // the leather coaming round the pilot
    for(let i=0;i<=12;i++){ const x=-PW+i/12*2*PW, k=x/PW; pts.push(V3(x,-0.196-0.03*k*k,PANEL_Z+0.012)); }
    pts.push(V3(0.335,-0.265,-0.30),V3(0.345,-0.285,0.10),V3(0.30,-0.29,0.55),V3(0,-0.29,0.70),
      V3(-0.30,-0.29,0.55),V3(-0.345,-0.285,0.10),V3(-0.335,-0.265,-0.30));
    tube(root,pts,0.020,leather,true,140);
  }
  // the long exhaust pipe down the left side of the nose
  {
    const ex=std({color:"#6a4a36",metalness:0.7,roughness:0.5});
    const k0=0.92, k1=0.30;
    tube(root,[V3(-hw(k0)-0.04,top(k0)-0.10,zAt(k0)),V3(-hw(0.7)-0.05,top(0.7)-0.08,zAt(0.7)),
               V3(-hw(k1)-0.05,top(k1)-0.09,zAt(k1))],0.028,ex,false,24);
  }

  // ---------- the wings ----------
  const wingMats={};
  for(const label of ["upperL","upperR","lowerL","lowerR"]){
    const art=canvasTex(1024,256,(x,w,h)=>paintWing(x,w,h,label));
    wingMats[label]=std({map:art.tex,roughness:0.8,emissive:"#fff0c0",emissiveMap:art.tex,emissiveIntensity:0});
  }
  for(const sx of [-1,1]){
    const up=new THREE.Mesh(airfoilWing({x0:0,x1:sx*UP.span,y0:UP.y,y1:UP.y+0.06,le0:UP.le,le1:UP.le+0.06,
      c0:UP.c,c1:UP.c-0.08,t0:0.11,t1:0.10,camber:0.035,NS:14}),wingMats[sx<0?"upperL":"upperR"]);
    const lo=new THREE.Mesh(airfoilWing({x0:sx*0.33,x1:sx*LO.span,y0:LO.y,y1:LO.y+0.10,le0:LO.le,le1:LO.le+0.06,
      c0:LO.c,c1:LO.c-0.08,t0:0.11,t1:0.10,camber:0.035,NS:12}),wingMats[sx<0?"lowerL":"lowerR"]);
    for(const m of [up,lo]){ m.castShadow=true; m.receiveShadow=true; root.add(m); }
  }
  // the fuel tank in the top wing's centre section, and its float gauge hanging under it
  const Gauge={};
  {
    const tank=new THREE.Mesh(new THREE.CapsuleGeometry(0.16,0.7,6,16),std({color:"#c8c2b0",metalness:0.6,roughness:0.35}));
    tank.rotation.z=Math.PI/2; tank.position.set(0,UP.y+0.14,UP.le+0.55); tank.castShadow=true;
    root.add(tank);
    const g=new THREE.Group(); g.position.set(0.14,UP.y-0.02,UP.le+0.70);
    const tubeG=new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,0.16,12,1,true),glass);
    tubeG.position.y=-0.08;
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(0.017,0.017,0.012,12),steel); cap.position.y=-0.165;
    const guard=new THREE.Mesh(new THREE.CylinderGeometry(0.0022,0.0022,0.16,6),steel); guard.position.set(0.016,-0.08,0);
    const float=new THREE.Mesh(new THREE.CylinderGeometry(0.009,0.009,0.012,12),
      std({color:"#e8541e",emissive:"#e8541e",emissiveIntensity:0.25}));
    float.userData.dynamic=true;
    g.add(tubeG,cap,guard,float);
    root.add(g);
    Gauge.float=float;
  }
  // cabane struts from the top longerons to the centre section
  for(const sx of [-1,1]){
    strut(root,V3(sx*0.30,top(0.26)-0.02,zAt(0.26)),V3(sx*0.27,UP.y,UP.le+0.40),0.013,0.009,strutWood);
    strut(root,V3(sx*0.31,top(0.52)-0.02,zAt(0.52)),V3(sx*0.27,UP.y,UP.le+0.12),0.013,0.009,strutWood);
    strut(root,V3(sx*0.30,top(0.26)-0.02,zAt(0.26)),V3(sx*0.27,UP.y,UP.le+0.12),0.009,0.007,strutWood);
  }
  // interplane struts: an N each side, the top wing staggered ahead of the bottom
  for(const sx of [-1,1]){
    const lf=V3(sx*BAY,LO.y+0.06,LO.le+0.26), lr=V3(sx*BAY,LO.y+0.06,LO.le+LO.c-0.36);
    const uf=V3(sx*BAY,UP.y+0.03,UP.le+0.26), ur=V3(sx*BAY,UP.y+0.03,UP.le+UP.c-0.36);
    strut(root,lf,uf,0.030,0.011,strutWood);
    strut(root,lr,ur,0.030,0.011,strutWood);
    strut(root,lr,uf,0.022,0.009,strutWood);
    // flying wires (bottom root to top at the bay) and landing wires (top root to bottom at the bay), doubled
    for(const dz of [0,0.05]){
      strut(root,V3(sx*0.36,LO.y+0.05,LO.le+0.30+dz),V3(sx*(BAY-0.02),UP.y,UP.le+0.28+dz),0.0022,0.0022,wireMat,6);
      strut(root,V3(sx*0.30,UP.y-0.02,UP.le+0.32+dz),V3(sx*(BAY-0.02),LO.y+0.06,LO.le+0.30+dz),0.0022,0.0022,wireMat,6);
    }
    // an incidence wire across the bay
    strut(root,lf,ur,0.0018,0.0018,wireMat,6);
  }

  // ---------- the windscreen: a small aero-screen ----------
  const dirt=grime(384,128);
  {
    const shape=(u,v)=>{
      const phi=(u-0.5)*1.1;
      const yb=-0.205, y=yb+v*0.14;
      return V3(0.30*Math.sin(phi), y, -0.30-0.30*Math.cos(phi)+v*0.07);
    };
    const geo=surface(16,4,shape);
    root.add(new THREE.Mesh(geo,glass));
    const gm=new THREE.Mesh(geo,dirt.mat); gm.renderOrder=1; gm.userData.dynamic=true; root.add(gm);
    // a black-painted frame, as the screens on these trainers had
    const frame=std({color:"#1a1918",roughness:0.5});
    const edge=[]; for(let i=0;i<=16;i++) edge.push(shape(i/16,1));
    tube(root,edge,0.005,frame,false,32);
    for(const s of [0,1]) tube(root,[shape(s,0),shape(s,1)],0.006,frame,false,4);
  }

  // ---------- the panel: black plywood, a few dials, three jewel lamps ----------
  {
    const s=new THREE.Shape();
    s.moveTo(-PW,-0.60); s.lineTo(PW,-0.60); s.lineTo(PW,-0.228);
    s.quadraticCurveTo(0,-0.19,-PW,-0.228); s.closePath();
    const panel=new THREE.Mesh(new THREE.ShapeGeometry(s,20),panelBlack);
    panel.position.z=PANEL_Z; panel.receiveShadow=true;
    root.add(panel);
  }
  const dials=dialSet({bezel:steel,face:["#1c1c1c","#080808"],ink:"#f2f0e8",minor:"#9a9890",label:"#d8d4c4",z:PANEL_Z+0.004});
  const GY=-0.290;
  dials.gauge(root,{label:"AIRSPEED",unit:"KM/H",ticks:7,nums:["0","60","120","180","240","300","360","420"],
    arcs:[[0.12,0.6,"#2a8a3a"],[0.9,1,"#c8362a"]],read:read.speed},-0.19,GY,0.050);
  dials.gauge(root,{label:"ALT",unit:"x10 M",ticks:5,nums:["0","8","16","24","32","40"],read:read.alt},-0.075,GY+0.012,0.040);
  dials.gauge(root,{label:"R.P.M.",unit:"x100",ticks:6,nums:["0","5","10","15","20","25","30"],arcs:[[0.88,1,"#c8362a"]],
    read:read.rpm},0.155,GY,0.050);
  dials.gauge(root,{label:"OIL",ticks:4,nums:["0","","","","100"],arcs:[[0,0.2,"#c8362a"]],
    read:t=>0.62+Math.sin(t*0.0007)*0.02},0.262,GY+0.018,0.028);
  // turn & slip: a needle that swings with the turn and a ball in a curved tube
  const TS={};
  {
    const r=0.042;
    const faceG=dials.faceGeo(r,(x,w)=>{
      const c=w/2, rr=w*0.47;
      x.fillStyle="#0a0a0a"; x.beginPath(); x.arc(c,c,rr,0,7); x.fill();
      x.strokeStyle="#f2f0e8"; x.lineWidth=6;
      for(const a of [-0.45,0,0.45]){ const an=-Math.PI/2+a; x.beginPath(); x.moveTo(c+Math.cos(an)*rr*0.72,c+Math.sin(an)*rr*0.72); x.lineTo(c+Math.cos(an)*rr*0.9,c+Math.sin(an)*rr*0.9); x.stroke(); }
      x.fillStyle="#d8d4c4"; x.font="700 20px "+MONO; x.textAlign="center"; x.textBaseline="middle";
      x.fillText("TURN",c,c+rr*0.35); x.fillText("SLIP",c,c+rr*0.62);
    });
    const g=dials.housing(root,0.040,GY+0.004,r,faceG,PANEL_Z+0.004);
    const needle=new THREE.Mesh(new THREE.BoxGeometry(0.004,r*0.8,0.002),dials.needleMat);
    needle.geometry.translate(0,r*0.4,0);
    const piv=new THREE.Group(); piv.position.set(0,-r*0.1,0.007); piv.add(needle); piv.userData.dynamic=true;
    const ball=new THREE.Mesh(new THREE.SphereGeometry(r*0.1,12,10),std({color:"#111",roughness:0.3}));
    ball.userData.dynamic=true;
    const tb=new THREE.Mesh(new THREE.TorusGeometry(r*1.3,r*0.12,8,24,Math.PI*0.36),
      std({color:"#e8e0c8",roughness:0.3,transparent:true,opacity:0.7}));
    tb.position.set(0,r*1.05,0.006); tb.rotation.z=-Math.PI*0.68;
    g.add(piv,ball,tb);
    Object.assign(TS,{r,piv,ball,slip:0});
  }
  const lamps=[];
  LAMPS.forEach(([label,col,on,blink],i)=>{
    const m=std({color:col,roughness:0.15,emissive:col,emissiveIntensity:0.1,transparent:true,opacity:0.95});
    const dome=new THREE.Mesh(new THREE.SphereGeometry(0.0085,14,10,0,Math.PI*2,0,Math.PI/2),m);
    dome.rotation.x=Math.PI/2; dome.position.set(-0.29+i*0.026,-0.238,PANEL_Z+0.006); dome.userData.dynamic=true;
    const rim=new THREE.Mesh(new THREE.TorusGeometry(0.0095,0.002,6,16),steel);
    rim.position.set(-0.29+i*0.026,-0.238,PANEL_Z+0.005);
    root.add(dome,rim);
    lamps.push({m,on,blink});
  });

  // ---------- the propeller: wood with brass tips ----------
  {
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09,0.12,16),steel);
    hub.rotation.x=Math.PI/2; hub.position.set(0,PROP_Y,PROP_Z+0.04); root.add(hub);
  }
  const prop=propeller(root,{radius:0.98,blades:2,tip:"#c9962c",hub:0.09,y:PROP_Y,z:PROP_Z});

  // ---------- the chart (left) and the logbook card (right) ----------
  function board(sx){
    const g=new THREE.Group();
    const art=canvasTex(384,288,null);
    const back=new THREE.Mesh(new THREE.BoxGeometry(0.168,0.128,0.008),boardMat);
    const paper=new THREE.Mesh(new THREE.PlaneGeometry(0.156,0.117),std({map:art.tex,roughness:0.9,
      emissive:"#ffffff",emissiveMap:art.tex,emissiveIntensity:0.05}));
    paper.position.z=0.0045; paper.userData.dynamic=true;
    const clip=new THREE.Mesh(new THREE.BoxGeometry(0.055,0.013,0.012),steel); clip.position.set(0,0.058,0.008);
    g.add(back,paper,clip);
    back.castShadow=true; back.receiveShadow=true; paper.receiveShadow=true;
    g.position.set(sx*0.305,-0.245,-0.33);
    g.lookAt(0,0.02,0.05);
    g.rotateX(-0.16);
    root.add(g);
    return {art,key:""};
  }
  const chart=board(-1), card=board(1);

  bakeStatics(root);

  let boardT=0;
  const allWings=Object.values(wingMats);
  return {
    root,
    shadow:{center:[0,-0.1,-1.4],half:3.2},
    envIntensity:0.8,
    rumble:0.0005,
    update(t,dt,f){
      const glow=0.08+Math.max(0,f.sunL.y)*0.40;            // sunlight through the doped fabric
      for(const m of allWings) m.emissiveIntensity=glow;
      dials.update(t,dt);
      TS.piv.rotation.z=-clamp(P.roll*1.6,-0.6,0.6);
      TS.slip+=(clamp((P.vx/MAX_VX)-P.roll*2.1,-1,1)-TS.slip)*(1-Math.exp(-dt*4));
      const ba=-Math.PI*0.5-TS.slip*Math.PI*0.16;
      TS.ball.position.set(Math.cos(ba)*TS.r*1.3,TS.r*1.05+Math.sin(ba)*TS.r*1.3,0.010);
      Gauge.float.position.y=-0.155+clamp(G.fuel/100,0,1)*0.135;
      updateLamps(lamps,t,3.4,0.08);
      prop.update(t,f);
      damage.update();
      dirt.update(t,dt);
      boardT-=dt;
      if(boardT<=0){ drawMap(chart.art.ctx,384,288,"paper"); chart.art.tex.needsUpdate=true; boardT=0.15; }
      const k=runKey();
      if(k!==card.key){ card.key=k; drawRun(card.art.ctx,384,288,"paper"); card.art.tex.needsUpdate=true; }
    }
  };
}

// Skylark Mk II — the open cockpit of a vintage parasol monoplane.
//
// A doped-linen wing on struts over your head with a cut-out to see up
// through, green-doped cowling with louvres and exhaust soot, a walnut panel
// with brass-bezelled dials and a turn-and-bank, a magnetic compass on the
// decking, a brass-framed windscreen, a leather coaming, and two boards on
// brackets in the front corners: the chart and the logbook card.
import * as THREE from 'three';
import { clamp, lerp, smooth, mulberry32 } from '../../util.js';
import { P } from '../../state.js';
import { MAX_VX } from '../config.js';
import { MONO, V3, bakeStatics, canvasTex, cowlDamage, dialSet, drawMap, drawRun, glassMaterial,
         grime, LAMPS, propeller, read, runKey, std, strut, surface, updateLamps } from './kit.js';

const Z_COAM=-0.50, Z_FIRE=-0.86, Z_NOSE=-2.36;
const PROP_Y=-0.44, PROP_Z=-2.52;
const PW=0.37, PANEL_Z=-0.50;
const WING_Y=0.70, LE_Z=-1.08, TE_Z=0.36, SPAN=4.9;

function paintCowl(x,w,h){
  // u runs from the coaming (0) to the nose (1); v round the section
  x.fillStyle="#3c5645"; x.fillRect(0,0,w,h);
  const rng=mulberry32(77);
  for(let i=0;i<900;i++){                                      // dope mottling
    x.fillStyle=`rgba(${rng()<0.5?"20,30,22":"120,140,120"},${0.025+rng()*0.035})`;
    x.beginPath(); x.arc(rng()*w,rng()*h,4+rng()*26,0,7); x.fill();
  }
  const uF=(Z_FIRE-Z_COAM)/(Z_NOSE-Z_COAM);
  x.fillStyle="rgba(150,160,130,0.10)"; x.fillRect(0,0,uF*w,h);
  x.strokeStyle="rgba(12,18,14,0.75)"; x.lineWidth=2.2;
  x.beginPath(); x.moveTo(uF*w,0); x.lineTo(uF*w,h); x.stroke();
  for(const v of [0.36,0.64]){
    x.beginPath(); x.moveTo(uF*w,v*h); x.lineTo(w,v*h); x.stroke();
    x.strokeStyle="rgba(200,215,195,0.18)"; x.lineWidth=1;
    x.beginPath(); x.moveTo(uF*w,v*h+2); x.lineTo(w,v*h+2); x.stroke();
    x.strokeStyle="rgba(12,18,14,0.75)"; x.lineWidth=2.2;
  }
  x.fillStyle="rgba(10,14,11,0.8)";
  for(let u=uF*w+8;u<w;u+=14){ for(const v of [0.36,0.64]){ x.beginPath(); x.arc(u,v*h-6,1.6,0,7); x.fill(); x.beginPath(); x.arc(u,v*h+8,1.6,0,7); x.fill(); } }
  for(let v=10;v<h;v+=14){ x.beginPath(); x.arc(uF*w-6,v,1.6,0,7); x.fill(); x.beginPath(); x.arc(uF*w+8,v,1.6,0,7); x.fill(); }
  for(const vc of [0.20,0.80]){                                // cooling louvres
    for(let i=0;i<7;i++){
      const u=(uF+0.06+i*0.045)*w, v=vc*h;
      x.fillStyle="rgba(8,10,8,0.85)"; x.fillRect(u,v-26,10,52);
      x.fillStyle="rgba(190,205,185,0.25)"; x.fillRect(u+10,v-26,2,52);
    }
  }
  for(const vc of [0.16,0.84]){                                // exhaust soot
    const g=x.createLinearGradient(0.62*w,0,0.1*w,0);
    g.addColorStop(0,"rgba(20,16,12,0.55)"); g.addColorStop(1,"rgba(20,16,12,0)");
    x.fillStyle=g; x.fillRect(0.1*w,vc*h-18,0.52*w,36);
  }
  x.fillStyle="rgba(170,175,150,0.12)";
  for(let i=0;i<40;i++){ x.fillRect(rng()*uF*w*1.6,0.35*h+rng()*0.3*h,2+rng()*10,1+rng()*2); }
}
function fuselageGeometry(){
  const NZ=36, NP=34, pos=[], uv=[], idx=[];
  for(let i=0;i<=NZ;i++){
    const k=i/NZ, z=lerp(Z_COAM,Z_NOSE,k);
    const hw=lerp(0.415,0.30,smooth(k));
    const top=lerp(-0.212,-0.335,Math.pow(k,1.15));
    const arch=hw*0.62;
    for(let j=0;j<=NP;j++){
      const s=j/NP;
      let x,y;
      if(s<0.14){ x=-hw; y=lerp(-1.1,top-arch,s/0.14); }
      else if(s>0.86){ x=hw; y=lerp(top-arch,-1.1,(s-0.86)/0.14); }
      else{
        const a=((s-0.14)/0.72-0.5)*Math.PI;
        x=hw*Math.sin(a); y=top-arch*(1-Math.pow(Math.cos(a),0.75));
      }
      pos.push(x,y,z); uv.push(k,s);
    }
  }
  for(let i=0;i<NZ;i++) for(let j=0;j<NP;j++){
    const a=i*(NP+1)+j, b=a+NP+1;
    idx.push(a,a+1,b, a+1,b+1,b);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function build(){
  const root=new THREE.Group();
  const brass=std({color:"#d0a44a",metalness:1,roughness:0.32});
  const steel=std({color:"#9a9c9a",metalness:1,roughness:0.38});
  const leather=std({color:"#3b2616",roughness:0.62});
  const strutPaint=std({color:"#7a6e58",roughness:0.55});
  const darkMetal=std({color:"#2a2622",metalness:0.6,roughness:0.5});
  const wireMat=std({color:"#3a3a38",metalness:0.5,roughness:0.5});
  const stringerMat=std({color:"#6a4a2a",roughness:0.7});
  const boardMat=std({color:"#3a2a18",roughness:0.6});
  const glass=glassMaterial();

  // ---------- the fuselage ----------
  const cowlArt=canvasTex(1024,512,paintCowl);
  const fuselage=new THREE.Mesh(fuselageGeometry(),std({map:cowlArt.tex,roughness:0.5,metalness:0.22}));
  fuselage.castShadow=true; fuselage.receiveShadow=true;
  root.add(fuselage);
  const damage=cowlDamage(cowlArt,()=>paintCowl(cowlArt.ctx,1024,512),{style:"metal",region:[0.12,0.42,0.38,0.62]});
  {
    const side=std({color:"#3a5343",roughness:0.6,metalness:0.1});
    const inner=std({color:"#2a2016",roughness:0.9});
    for(const sx of [-1,1]){
      const o=new THREE.Mesh(new THREE.PlaneGeometry(1.3,0.85),side);
      o.position.set(sx*0.43,-0.70,0.12); o.rotation.y=sx*Math.PI/2;
      o.receiveShadow=true; root.add(o);
      const lip=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.02,1.25),side);
      lip.position.set(sx*0.40,-0.283,0.10); lip.receiveShadow=true; root.add(lip);
      const w=new THREE.Mesh(new THREE.PlaneGeometry(1.2,0.8),inner);
      w.position.set(sx*0.365,-0.68,0.10); w.rotation.y=-sx*Math.PI/2;
      w.receiveShadow=true; root.add(w);
      for(let i=0;i<4;i++){                                   // wooden stringers inside
        const st=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.022,1.2),stringerMat);
        st.position.set(sx*0.355,-0.36-i*0.16,0.10); root.add(st);
      }
    }
  }

  // ---------- the walnut panel ----------
  const panelArt=canvasTex(1024,640,(x,w,h)=>{
    const g=x.createLinearGradient(0,0,0,h);
    g.addColorStop(0,"#9a6a3e"); g.addColorStop(1,"#6a4424");
    x.fillStyle=g; x.fillRect(0,0,w,h);
    const rng=mulberry32(5);
    for(let i=0;i<140;i++){                                   // walnut figure
      const y0=rng()*h, amp=4+rng()*16, f=0.004+rng()*0.01, ph=rng()*6;
      x.strokeStyle=`rgba(${rng()<0.5?"30,16,6":"150,100,56"},${0.06+rng()*0.10})`;
      x.lineWidth=0.8+rng()*2.2;
      x.beginPath();
      for(let u=0;u<=w;u+=8){ const y=y0+Math.sin(u*f+ph)*amp+Math.sin(u*f*3.1)*amp*0.3; u?x.lineTo(u,y):x.moveTo(u,y); }
      x.stroke();
    }
    const v=x.createRadialGradient(w/2,h*0.45,h*0.2,w/2,h*0.5,w*0.7);
    v.addColorStop(0,"rgba(0,0,0,0)"); v.addColorStop(1,"rgba(0,0,0,0.35)");
    x.fillStyle=v; x.fillRect(0,0,w,h);
    x.fillStyle="#b89a58"; x.fillRect(w/2-70,h*0.83,140,26);
    x.fillStyle="#3a2a14"; x.font="700 17px "+MONO; x.textAlign="center"; x.textBaseline="middle";
    x.fillText("SKYLARK  Mk II",w/2,h*0.83+13);
  });
  {
    const s=new THREE.Shape();
    s.moveTo(-PW,-0.64); s.lineTo(PW,-0.64); s.lineTo(PW,-0.236);
    s.quadraticCurveTo(0,-0.172,-PW,-0.236); s.closePath();
    const g=new THREE.ShapeGeometry(s,24);
    const p=g.attributes.position, uv=g.attributes.uv;
    for(let i=0;i<p.count;i++) uv.setXY(i,(p.getX(i)+PW)/(2*PW),(p.getY(i)+0.64)/0.47);
    const m=new THREE.MeshPhysicalMaterial({map:panelArt.tex,roughness:0.5,clearcoat:0.7,clearcoatRoughness:0.18});
    const panel=new THREE.Mesh(g,m);
    panel.position.z=PANEL_Z; panel.receiveShadow=true;
    root.add(panel);
  }
  {
    const pts=[];
    for(let i=0;i<=16;i++){
      const x=-PW+i/16*2*PW, k=x/PW;
      pts.push(V3(x,-0.194-0.040*k*k,PANEL_Z+0.012));
    }
    pts.push(V3(0.39,-0.262,-0.36),V3(0.39,-0.272,0.05),V3(0.35,-0.272,0.55),V3(0,-0.272,0.74),
      V3(-0.35,-0.272,0.55),V3(-0.39,-0.272,0.05),V3(-0.39,-0.262,-0.36));
    const curve=new THREE.CatmullRomCurve3(pts,true,"centripetal");
    const roll=new THREE.Mesh(new THREE.TubeGeometry(curve,160,0.022,10,true),leather);
    roll.castShadow=true; roll.receiveShadow=true;
    root.add(roll);
  }

  // ---------- instruments ----------
  const dials=dialSet({bezel:brass,z:PANEL_Z+0.004});
  const GY=-0.292, GR=0.047;
  dials.gauge(root,{label:"A.S.I.",unit:"KM/H",ticks:7,nums:["0","60","120","180","240","300","360","420"],arcs:[[0.9,1,"#c8362a"]],
    read:read.speed},-0.215,GY,GR);
  dials.gauge(root,{label:"ALTIMETER",unit:"x10 M",ticks:5,nums:["0","8","16","24","32","40"],read:read.alt},-0.107,GY,GR);
  dials.gauge(root,{label:"FUEL",ticks:4,nums:["E","¼","½","¾","F"],arcs:[[0,0.2,"#c8362a"]],read:read.fuel},0.107,GY,GR);
  dials.gauge(root,{label:"R.P.M.",unit:"x100",ticks:6,nums:["0","5","10","15","20","25","30"],arcs:[[0.88,1,"#c8362a"]],
    read:read.rpm},0.215,GY,GR);

  // turn & bank in the middle: the little aeroplane banks, the ball slips
  const TB={};
  {
    const r=0.052;
    const faceG=dials.faceGeo(r,(x,w)=>{
      const c=w/2, rr=w*0.47;
      x.fillStyle="#0f0d0b"; x.beginPath(); x.arc(c,c,rr,0,7); x.fill();
      x.strokeStyle="#ece4d0"; x.lineWidth=5;
      for(const a of [-0.5,-0.25,0.25,0.5]){
        const an=-Math.PI/2+a;
        x.beginPath(); x.moveTo(c+Math.cos(an)*rr*0.70,c+Math.sin(an)*rr*0.70);
        x.lineTo(c+Math.cos(an)*rr*0.88,c+Math.sin(an)*rr*0.88); x.stroke();
      }
      x.fillStyle="#ece4d0"; x.font="700 26px "+MONO; x.textAlign="center"; x.textBaseline="middle";
      x.fillText("L",c-rr*0.62,c-rr*0.05); x.fillText("R",c+rr*0.62,c-rr*0.05);
      x.fillStyle="#c9b98f"; x.font="600 17px "+MONO; x.fillText("TURN & BANK",c,c+rr*0.62);
    });
    const g=dials.housing(root,0,GY-0.004,r,faceG,PANEL_Z+0.004);
    const plane=new THREE.Group(); plane.position.set(0,r*0.18,0.007);
    const wingBar=new THREE.Mesh(new THREE.BoxGeometry(r*1.25,r*0.07,0.002),dials.needleMat);
    const fin=new THREE.Mesh(new THREE.BoxGeometry(r*0.07,r*0.28,0.002),dials.needleMat); fin.position.y=r*0.14;
    const dot=new THREE.Mesh(new THREE.CircleGeometry(r*0.08,16),dials.needleMat);
    plane.add(wingBar,fin,dot);
    plane.userData.dynamic=true;
    const tubeM=new THREE.Mesh(new THREE.TorusGeometry(r*1.25,r*0.11,8,24,Math.PI*0.4),
      std({color:"#3a3630",roughness:0.3,transparent:true,opacity:0.85}));
    tubeM.position.set(0,r*0.72,0.006); tubeM.rotation.z=-Math.PI*0.7;
    const ball=new THREE.Mesh(new THREE.SphereGeometry(r*0.09,12,10),std({color:"#e8e0c8",roughness:0.3}));
    ball.userData.dynamic=true;
    g.add(plane,tubeM,ball);
    Object.assign(TB,{r,plane,ball,slip:0});
  }

  // warning lamps on a brass bar on the decking, in the pilot's eyeline
  const lamps=[];
  {
    const bar=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.026,0.02),darkMetal);
    bar.position.set(-0.115,-0.202,-0.575); bar.rotation.x=-0.35;
    bar.castShadow=true; bar.receiveShadow=true; root.add(bar);
    LAMPS.forEach(([label,col,on,blink],i)=>{
      const art=canvasTex(128,64,(x,w,h)=>{
        x.fillStyle=col; x.fillRect(0,0,w,h);
        x.fillStyle="rgba(20,14,8,0.85)"; x.font="800 30px "+MONO;
        x.textAlign="center"; x.textBaseline="middle"; x.fillText(label==="RWY"?"GEAR":label,w/2,h/2+2);
      });
      const m=std({map:art.tex,emissive:col,emissiveMap:art.tex,emissiveIntensity:0,roughness:0.3});
      m.color.setScalar(0.35);
      const lamp=new THREE.Mesh(new THREE.BoxGeometry(0.036,0.018,0.006),m);
      lamp.position.set(-0.162+i*0.047,-0.200,-0.563); lamp.rotation.x=-0.35;
      lamp.userData.dynamic=true;
      const rim=new THREE.Mesh(new THREE.BoxGeometry(0.041,0.023,0.004),brass);
      rim.position.set(-0.162+i*0.047,-0.200,-0.565); rim.rotation.x=-0.35;
      root.add(rim,lamp);
      lamps.push({m,on,blink});
    });
  }

  // the magnetic compass standing on the decking
  const Compass={};
  {
    const g=new THREE.Group(); g.position.set(0,-0.214,-0.585);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(0.046,0.05,0.018,28),darkMetal); base.position.y=0.009;
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(0.044,0.046,0.012,28),darkMetal); cap.position.y=0.058;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(0.046,0.004,8,28),brass); ring.rotation.x=Math.PI/2; ring.position.y=0.052;
    const art=canvasTex(1024,64,(x,w,h)=>{
      x.fillStyle="#191612"; x.fillRect(0,0,w,h);
      x.fillStyle="#ece4d0"; x.textAlign="center"; x.textBaseline="middle";
      const marks={0:"N",30:"3",60:"6",90:"E",120:"12",150:"15",180:"S",210:"21",240:"24",270:"W",300:"30",330:"33"};
      for(let d=0;d<360;d+=5){
        const u=(1-d/360)*w;
        x.fillRect(u-1,h*0.72,2,d%10===0?h*0.26:h*0.14);
        if(marks[d]){ x.font=(marks[d].length===1?"800 34px ":"700 26px ")+MONO; x.fillText(marks[d],u,h*0.38); }
      }
    });
    art.tex.wrapS=THREE.RepeatWrapping;
    const card=new THREE.Mesh(new THREE.CylinderGeometry(0.040,0.040,0.034,48,1,true),
      std({map:art.tex,roughness:0.6,emissive:"#ffffff",emissiveMap:art.tex,emissiveIntensity:0.04}));
    card.position.y=0.035; card.userData.dynamic=true;
    const lub=new THREE.Mesh(new THREE.BoxGeometry(0.0025,0.034,0.002),std({color:"#d2452f",roughness:0.4}));
    lub.position.set(0,0.035,0.0445);
    const dome=new THREE.Mesh(new THREE.CylinderGeometry(0.0445,0.0445,0.034,32,1,true),glass);
    dome.position.y=0.035;
    for(const m of [base,cap,ring]){ m.castShadow=true; m.receiveShadow=true; }
    g.add(base,card,cap,ring,lub,dome);
    root.add(g);
    Compass.card=card;
  }

  // ---------- windscreen ----------
  const dirt=grime(512,160);
  {
    const R=0.36, CZ=-0.30, PHI=0.56;
    const shape=(u,v)=>{
      const phi=(u-0.5)*2*PHI;
      const yb=-0.212, yt=-0.045-0.055*Math.pow((u-0.5)*2,2);
      const y=lerp(yb,yt,v);
      const lean=(y-yb)*0.34;
      return V3(R*Math.sin(phi), y, CZ-R*Math.cos(phi)+lean);
    };
    const geo=surface(20,6,shape);
    root.add(new THREE.Mesh(geo,glass));
    const gm=new THREE.Mesh(geo,dirt.mat);
    gm.renderOrder=1; gm.userData.dynamic=true;
    root.add(gm);
    const edge=[];
    for(let i=0;i<=20;i++) edge.push(shape(i/20,1));
    const top=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge),40,0.006,6),brass);
    const sides=[0,1].map(s=>new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.LineCurve3(shape(s,0),shape(s,1)),4,0.007,6),brass));
    for(const m of [top,...sides]){ m.castShadow=true; root.add(m); }
  }

  // ---------- the parasol wing, its struts and wires ----------
  const wingArt=canvasTex(2048,512,(x,w,h)=>{
    x.fillStyle="#d8cfb3"; x.fillRect(0,0,w,h);
    const px=m=>(m+SPAN)/(2*SPAN)*w;
    for(let m=-SPAN;m<=SPAN;m+=0.30){                           // rib tapes, pinked and stitched
      const u=px(m);
      x.fillStyle="rgba(120,108,80,0.30)"; x.fillRect(u-4,0,8,h);
      x.fillStyle="rgba(250,244,226,0.35)"; x.fillRect(u-2,0,4,h);
      x.fillStyle="rgba(90,80,60,0.45)";
      for(let v=6;v<h;v+=12) x.fillRect(u-0.5,v,1.2,3);
    }
    for(const v of [0.22,0.64]){ x.fillStyle="rgba(90,80,55,0.16)"; x.fillRect(0,v*h-10,w,20); }
    x.strokeStyle="rgba(80,70,50,0.55)"; x.lineWidth=2;
    for(const s of [-1,1]){
      const a=px(s*2.6), b=px(s*SPAN*0.98);
      x.beginPath(); x.moveTo(a,0.80*h); x.lineTo(b,0.80*h); x.moveTo(a,0.80*h); x.lineTo(a,h); x.stroke();
    }
    for(const s of [-1,1]){                                     // roundels
      const u=px(s*1.35), v=0.47*h, rr=0.33/(2*SPAN)*w;
      x.save(); x.translate(u,v); x.scale(1,(2*SPAN/1.44)*(h/w));
      x.fillStyle="#2b4f86"; x.beginPath(); x.arc(0,0,rr,0,7); x.fill();
      x.fillStyle="#f2ecd8"; x.beginPath(); x.arc(0,0,rr*0.64,0,7); x.fill();
      x.fillStyle="#c33a28"; x.beginPath(); x.arc(0,0,rr*0.30,0,7); x.fill();
      x.restore();
    }
    const rng=mulberry32(19);
    for(let i=0;i<300;i++){ x.fillStyle=`rgba(90,80,60,${rng()*0.05})`; x.fillRect(rng()*w,rng()*h,10+rng()*60,2+rng()*8); }
  });
  const wingMat=std({map:wingArt.tex,roughness:0.85,emissive:"#fff1d6",emissiveMap:wingArt.tex,emissiveIntensity:0});
  {
    const s=new THREE.Shape();
    const NOTCH=0.42, NZ=-0.02;
    s.moveTo(-SPAN,LE_Z); s.lineTo(SPAN,LE_Z); s.lineTo(SPAN,TE_Z); s.lineTo(NOTCH+0.12,TE_Z);
    s.quadraticCurveTo(NOTCH,NZ,0,NZ); s.quadraticCurveTo(-NOTCH,NZ,-NOTCH-0.12,TE_Z);
    s.lineTo(-SPAN,TE_Z); s.closePath();
    const g=new THREE.ShapeGeometry(s,12);
    const p=g.attributes.position, uv=g.attributes.uv;
    for(let i=0;i<p.count;i++) uv.setXY(i,(p.getX(i)+SPAN)/(2*SPAN),(p.getY(i)-LE_Z)/(TE_Z-LE_Z));
    g.rotateX(Math.PI/2);
    const under=new THREE.Mesh(g,wingMat);
    under.position.y=WING_Y; under.castShadow=true; under.receiveShadow=true;
    root.add(under);
    const le=new THREE.Mesh(new THREE.CylinderGeometry(0.075,0.075,SPAN*2,16),std({color:"#cfc6aa",roughness:0.8}));
    le.rotation.z=Math.PI/2; le.position.set(0,WING_Y+0.075,LE_Z); le.castShadow=true;
    const teTape=new THREE.Mesh(new THREE.BoxGeometry(SPAN*2,0.012,0.02),std({color:"#b8ae90",roughness:0.8}));
    teTape.position.set(0,WING_Y+0.01,TE_Z);
    root.add(le,teTape);
  }
  for(const sx of [-1,1]){
    strut(root,V3(sx*0.33,-0.25,-0.84),V3(sx*0.25,WING_Y,-0.86),0.011,0.008,strutPaint);
    strut(root,V3(sx*0.36,-0.27,0.42),V3(sx*0.25,WING_Y,0.12),0.011,0.008,strutPaint);
    strut(root,V3(sx*0.42,-1.00,-0.95),V3(sx*2.30,WING_Y,-0.86),0.024,0.009,strutPaint);
    strut(root,V3(sx*0.42,-1.00,-0.45),V3(sx*2.30,WING_Y,-0.02),0.024,0.009,strutPaint);
    strut(root,V3(sx*0.33,-0.25,-0.84),V3(sx*1.55,WING_Y,-0.95),0.0017,0.0017,wireMat,6);
  }

  // ---------- engine details: spinner, exhaust stacks, filler cap ----------
  {
    const sp=new THREE.Mesh(new THREE.SphereGeometry(0.13,24,16,0,Math.PI*2,0,Math.PI*0.5),
      std({color:"#e4d9bd",roughness:0.35,metalness:0.3}));
    sp.rotation.x=-Math.PI/2; sp.scale.set(1,1.7,1); sp.position.set(0,PROP_Y,PROP_Z+0.02);
    root.add(sp);
    const exMat=std({color:"#5a4436",metalness:0.7,roughness:0.55});
    for(const sx of [-1,1]) for(let i=0;i<2;i++){
      const e=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.026,0.20,12),exMat);
      e.position.set(sx*(0.36-i*0.01),-0.42,-1.30-i*0.28);
      e.rotation.set(0.9,0,sx*1.1);
      e.castShadow=true; root.add(e);
    }
    const capM=new THREE.Mesh(new THREE.CylinderGeometry(0.032,0.036,0.018,20),steel);
    capM.position.set(-0.10,-0.255,-1.45); capM.rotation.x=-0.07;
    capM.castShadow=true; root.add(capM);
  }
  const prop=propeller(root,{radius:0.98,blades:2,tip:"#d9a33a",hub:0.10,y:PROP_Y,z:PROP_Z});

  // ---------- the two boards: chart on the left, logbook card on the right ----------
  function board(sx){
    const g=new THREE.Group();
    const art=canvasTex(384,288,null);
    const back=new THREE.Mesh(new THREE.BoxGeometry(0.205,0.158,0.008),boardMat);
    const paper=new THREE.Mesh(new THREE.PlaneGeometry(0.19,0.1425),std({map:art.tex,roughness:0.9,
      emissive:"#ffffff",emissiveMap:art.tex,emissiveIntensity:0.05}));
    paper.position.z=0.0045; paper.userData.dynamic=true;
    const clip=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.016,0.012),brass);
    clip.position.set(0,0.071,0.008);
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,0.16,8),darkMetal);
    arm.position.set(-sx*0.07,-0.13,-0.02); arm.rotation.z=sx*0.5;
    g.add(back,paper,clip,arm);
    for(const m of [back,clip,arm]){ m.castShadow=true; m.receiveShadow=true; }
    paper.receiveShadow=true;
    g.position.set(sx*0.325,-0.192,-0.365);
    g.lookAt(0,0.02,0);
    g.rotateX(-0.12);
    root.add(g);
    return {art,key:""};
  }
  const chart=board(-1), logbook=board(1);

  bakeStatics(root);

  let boardT=0;
  return {
    root,
    shadow:{center:[0,-0.2,-1.0],half:2.6},
    envIntensity:0.85,
    rumble:0.00045,
    update(t,dt,f){
      // doped linen glows when the sun is above the wing
      wingMat.emissiveIntensity=0.10+Math.max(0,f.sunL.y)*0.45;
      dials.update(t,dt);
      TB.plane.rotation.z=P.roll*0.9;
      TB.slip+=(clamp((P.vx/MAX_VX)-P.roll*2.1,-1,1)-TB.slip)*(1-Math.exp(-dt*4));
      const ba=-Math.PI*0.5-TB.slip*Math.PI*0.18;           // the ball runs away from the turn
      TB.ball.position.set(Math.cos(ba)*TB.r*1.25,TB.r*0.72+Math.sin(ba)*TB.r*1.25,0.010);
      Compass.card.rotation.y=read.heading()*Math.PI/180;
      updateLamps(lamps,t,3.2,0);
      prop.update(t,f);
      damage.update();
      dirt.update(t,dt);
      boardT-=dt;
      if(boardT<=0){ drawMap(chart.art.ctx,384,288,"paper"); chart.art.tex.needsUpdate=true; boardT=0.15; }
      const k=runKey();
      if(k!==logbook.key){ logbook.key=k; drawRun(logbook.art.ctx,384,288,"paper"); logbook.art.tex.needsUpdate=true; }
    }
  };
}

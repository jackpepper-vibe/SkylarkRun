// Skylark Run — game code.
//
// Loaded as an ES module so the engine can be split into files. three.js is
// still the r128 global build from the CDN, so THREE is referenced as a global
// here rather than imported.
/* global THREE */
import { hash, hash2, mulberry32, clamp, lerp, smooth, vnoise, lineGeo,
         shade, midiF, hatBuf, roundedPoly, esc, ordinal } from './util.js';
import { Save, Net, renderBoard, cleanName, NAME_MAX } from './logbook.js';
import { LAT_CLAMP, VIEW, SPEED0, SPEED_MAX, SPEED_RAMP, MAX_VX, MAX_VY,
         MAX_Y, PR, MIN_CLEAR, CANOPY_H } from './config.js';
import { S, Game, TO, P, G, dents, popups, popup } from './state.js';
import { CAN_TILT, readInput, calibrate, screenAngle, setInvertPitch,
         invertPitch, haveTilt, permState } from './input.js';
import { obstacleBeep, resumeAudio, suspendAudio, setRain, deathSpiral, fuelBeep, initAudio, audioTick, chime, whoosh, crashSound, setMuted, thud, radioCall, muted } from './audio.js';
import { DPR, H, W, camera, hctx, renderer, scene } from './view.js';
import { SUNDIR, TODS, hemiLight, sky, skyTexs, sunGlow, sunLight } from './sky.js';
import { renderPost, rtScene } from './post.js';
import { Clouds, weatherCloudAlpha } from './clouds.js';
import { WEATHERS, applyWeather, gDrops, updateRain } from './weather.js';
"use strict";
/* ============================================================
   SKYLARK RUN — open-cockpit monoplane air racing in Three.js.
   Procedural heightfield countryside, farmland patchwork, ring
   course, Game.weather, and a full runway approach & landing at the
   end of every sector. Single file, no backend, no APIs.

   Systems are grouped as small managers with the same shape:
     build once -> reset(level) -> update(dt)
   Everything that scrolls is pooled and recycled; nothing is
   allocated per frame in the hot path.
   ============================================================ */

// ---------- palette ----------
const CREAM="#fbf4e2", BRASS="#d9a441", INK="#241c12",
      RED="#d2452f", GREENL="#5fbf74", SKYC="#9fd2f2";

// ---------- helpers ----------






// value noise on an integer lattice, smooth-interpolated




// ---------- distant ridge backdrops (two parallax layers) ----------
function makeRidgeTexture(seed,col,snow){
  const c=document.createElement("canvas"); c.width=1024; c.height=160;
  const x=c.getContext("2d");
  x.clearRect(0,0,1024,160);
  x.fillStyle=col;
  x.beginPath(); x.moveTo(0,160);
  let y=110;
  for(let px=0;px<=1024;px+=16){
    y+=(hash(px*0.37+seed)-0.5)*26;
    y=clamp(y,26,140);
    x.lineTo(px,y);
  }
  x.lineTo(1024,160); x.closePath(); x.fill();
  if(snow){
    x.globalCompositeOperation="source-atop";
    const g=x.createLinearGradient(0,20,0,88);
    g.addColorStop(0,"rgba(255,255,255,0.85)");
    g.addColorStop(1,"rgba(255,255,255,0)");
    x.fillStyle=g; x.fillRect(0,0,1024,160);
    x.globalCompositeOperation="source-over";
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=THREE.RepeatWrapping; t.repeat.set(4,1);
  t.encoding=THREE.sRGBEncoding;
  return t;
}
const ridges=[];
function addRidge(tex,dist,h,alpha,fac){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(dist*5.0,h),
    new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:alpha,
      depthWrite:false,fog:false}));
  m.renderOrder=-1;
  m.userData={dist,h,fac};
  scene.add(m); ridges.push(m);
  return m;
}
addRidge(makeRidgeTexture(21,"#7f9ab4",true), 3600, 620, 0.55, 0.90);
addRidge(makeRidgeTexture(77,"#6d8a9e",false),2700, 430, 0.72, 0.85);

// ---------- sector themes: the shape of the land ----------
const THEMES=[
  {name:"MEADOWS",  amp:82,  f:1.05, ridge:1.00, water:-52, wood:0.60},
  {name:"HIGHLANDS",amp:142, f:0.80, ridge:1.28, water:-96, wood:0.66},
  {name:"LAKELAND", amp:96,  f:1.20, ridge:1.10, water:-14, wood:0.58},
  {name:"DOWNLAND", amp:64,  f:0.92, ridge:0.94, water:-46, wood:0.68},
];
let TH=THEMES[0];

// ---------- terrain height field ----------
// One pure function drives geometry, scatter placement and collision, so
// what you see is exactly what you hit.
const af={active:false,x:0,z:0,y:0,len:1000,wid:64,group:null,
          phase:0,seen:false,rollT:0,strobes:null,papi:null,edge:null,
          windsockPivot:null};
function baseH(x,z){
  const f=TH.f;
  let h =vnoise(x*0.00072*f, z*0.00072*f);
  h    +=vnoise(x*0.00210*f, z*0.00210*f)*0.42;
  h    +=vnoise(x*0.00580*f, z*0.00580*f)*0.15;
  h    +=vnoise(x*0.01400*f, z*0.01400*f)*0.06;        // hummocks and lane cuttings
  h=(h/1.63-0.5)*2;                                    // -1 .. 1
  const s=h<0?-1:1;
  return s*Math.pow(Math.abs(h),TH.ridge)*TH.amp;
}
function groundH(x,z){
  let h=baseH(x,z);
  if(af.active){                                       // the airfield is graded flat
    const dx=Math.abs(x-af.x)-af.wid*0.5-80;
    const dz=Math.abs(z-af.z)-af.len*0.5-160;
    const d=Math.hypot(Math.max(0,dx),Math.max(0,dz));
    if(d<300){ const k=smooth(1-d/300); h=lerp(h,af.y,k); }
  }
  return h;
}
function landuse(x,z){
  return vnoise(x*0.0024+7.7, z*0.0024+3.1)*0.72 + vnoise(x*0.0071+2.3, z*0.0071+5.9)*0.28;
}
function isWood(x,z){ return landuse(x,z)>TH.wood; }
function onField(x,z){                                  // inside the graded airfield
  return af.active&&Math.abs(x-af.x)<af.wid*0.5+55&&Math.abs(z-af.z)<af.len*0.5+140;
}
// clearance = the altitude below which you are into the scenery
function clearanceH(x,z){
  const g=groundH(x,z);
  if(onField(x,z)) return g;
  return g+(isWood(x,z)?CANOPY_H:2);
}

// ---------- terrain tiles (pooled, recycled around the aircraft) ----------
const TILE=420, TSEG=14, GX=7, GZ=10;
const Terrain={
  tiles:[], water:null, cx:1e9, cz:1e9, mat:null,
  build(){
    this.mat=new THREE.MeshLambertMaterial({vertexColors:true});
    for(let i=0;i<GX*GZ;i++){
      const geo=new THREE.PlaneGeometry(TILE,TILE,TSEG,TSEG);
      geo.rotateX(-Math.PI/2);
      const n=geo.attributes.position.count;
      geo.setAttribute("color",new THREE.BufferAttribute(new Float32Array(n*3),3));
      const mesh=new THREE.Mesh(geo,this.mat);
      mesh.matrixAutoUpdate=false;
      mesh.visible=false;
      scene.add(mesh);
      this.tiles.push({mesh,key:null});
    }
    // one water sheet: wherever the land dips below it you get a lake
    const wtex=(()=>{
      const c=document.createElement("canvas"); c.width=256; c.height=256;
      const x=c.getContext("2d");
      x.fillStyle="#4b86a4"; x.fillRect(0,0,256,256);
      x.strokeStyle="rgba(255,255,255,0.18)"; x.lineWidth=1.6;
      for(let i=0;i<90;i++){
        const y=hash(i*3.1)*256, xx=hash(i*7.7)*256, w=8+hash(i*11.3)*26;
        x.beginPath(); x.moveTo(xx,y); x.quadraticCurveTo(xx+w*0.5,y-3,xx+w,y); x.stroke();
      }
      const t=new THREE.CanvasTexture(c);
      t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(70,70);
      t.encoding=THREE.sRGBEncoding; return t;
    })();
    this.water=new THREE.Mesh(new THREE.PlaneGeometry(6400,6400),
      new THREE.MeshPhongMaterial({map:wtex,color:0x9ec6dc,shininess:95,specular:0xffffff,
        transparent:true,opacity:0.90}));
    this.water.rotation.x=-Math.PI/2;
    scene.add(this.water);
  },
  colorAt(x,z,h,col){
    const lu=landuse(x,z);
    const fx=Math.floor(x/150), fz=Math.floor(z/150);
    const r=hash2(fx,fz), r2=hash2(fx*1.7+9,fz*2.3+4);
    let c;
    if(onField(x,z))                   c=[0.33,0.45,0.22];                      // mown grass
    else if(h<TH.water+2.5)            c=[0.68,0.62,0.45];                      // shoreline sand
    else if(lu>TH.wood)                c=[0.13+r*0.05,0.28+r2*0.09,0.14+r*0.04];// woodland
    else if(h>TH.amp*0.62)             c=[0.40+r*0.10,0.38+r2*0.08,0.30+r*0.06];// bare upland
    else{
      // every 150 m square is its own field, cropped or grazed
      const crops=[[0.78,0.66,0.28],[0.46,0.33,0.20],[0.33,0.53,0.18],
                   [0.60,0.60,0.24],[0.26,0.45,0.18],[0.70,0.56,0.22]];
      const grass=[[0.30,0.52,0.24],[0.26,0.47,0.21],[0.34,0.55,0.26],
                   [0.29,0.50,0.22],[0.24,0.44,0.20],[0.32,0.49,0.23]];
      const p=(lu>0.34?crops:grass)[Math.floor(r*6)%6];
      c=[p[0]*(0.90+r2*0.20),p[1]*(0.90+r2*0.20),p[2]*(0.90+r2*0.20)];
      // hedge line along the field boundary, seen from above
      const ex=x-fx*150, ez=z-fz*150;
      if(ex<26||ez<26) c=[c[0]*0.72,c[1]*0.78,c[2]*0.70];
    }
    if(h>TH.amp*1.02){                                                          // tops go bare, then white
      const k=clamp((h-TH.amp*1.02)/(TH.amp*0.5),0,1)*0.85;
      c=[lerp(c[0],0.92,k),lerp(c[1],0.94,k),lerp(c[2],0.97,k)];
    }
    const g=TODS[Game.curTod].grass, n=0.93+hash2(Math.floor(x/29),Math.floor(z/29))*0.14;
    // deepen and saturate: ACES plus the bloom pass lifts everything a stop
    const SAT=1.42, GAIN=0.80;
    let r0=c[0]*g*n, g0=c[1]*g*n, b0=c[2]*g*n;
    const lum=(r0+g0+b0)/3;
    col[0]=clamp((lum+(r0-lum)*SAT)*GAIN,0,1);
    col[1]=clamp((lum+(g0-lum)*SAT)*GAIN,0,1);
    col[2]=clamp((lum+(b0-lum)*SAT)*GAIN,0,1);
  },
  fill(t,ix,iz){
    const ox=ix*TILE, oz=iz*TILE;
    const geo=t.mesh.geometry;
    const arr=geo.attributes.position.array;
    const na=geo.attributes.normal.array;
    const ca=geo.attributes.color.array;
    const n=geo.attributes.position.count;
    const c=[0,0,0], E=14;
    for(let i=0;i<n;i++){
      const wx=ox+arr[i*3], wz=oz+arr[i*3+2];
      const h=groundH(wx,wz);
      arr[i*3+1]=h;
      // analytic normals keep the lighting continuous across tile seams
      const nx=-(groundH(wx+E,wz)-groundH(wx-E,wz)), ny=2*E,
            nz=-(groundH(wx,wz+E)-groundH(wx,wz-E));
      const inv=1/Math.hypot(nx,ny,nz);
      na[i*3]=nx*inv; na[i*3+1]=ny*inv; na[i*3+2]=nz*inv;
      this.colorAt(wx,wz,h,c);
      ca[i*3]=c[0]; ca[i*3+1]=c[1]; ca[i*3+2]=c[2];
    }
    geo.attributes.position.needsUpdate=true;
    geo.attributes.normal.needsUpdate=true;
    geo.attributes.color.needsUpdate=true;
    geo.computeBoundingSphere();
    t.mesh.position.set(ox,0,oz);
    t.mesh.updateMatrix();
    t.mesh.visible=true;
    t.key=ix+"|"+iz;
  },
  refresh(force){
    const cx=Math.round(P.x/TILE), cz=Math.round(P.z/TILE);
    if(!force&&cx===this.cx&&cz===this.cz) return;
    this.cx=cx; this.cz=cz;
    const want=[];
    for(let i=0;i<GX;i++)
      for(let j=0;j<GZ;j++)
        want.push([cx-((GX-1)>>1)+i, cz+1-j]);   // one tile behind, the rest ahead
    const wantKeys=new Set(want.map(w=>w[0]+"|"+w[1]));
    const spare=[];
    for(const t of this.tiles){
      if(force||!t.key||!wantKeys.has(t.key)){ t.key=null; t.mesh.visible=false; spare.push(t); }
    }
    const have=new Set();
    for(const t of this.tiles) if(t.key) have.add(t.key);
    for(const w of want){
      const k=w[0]+"|"+w[1];
      if(have.has(k)) continue;
      const t=spare.pop();
      if(!t) break;
      this.fill(t,w[0],w[1]);
    }
  },
  update(){
    this.refresh(false);
    const step=200;
    this.water.position.set(Math.round(P.x/step)*step, TH.water, Math.round(P.z/step)*step);
  },
  // re-cut only the tiles around a point: moving the airfield re-grades the
  // ground under it, and a full refill would show as a hitch
  regrade(zc,rad){
    for(const t of this.tiles){
      if(!t.key) continue;
      const p=t.key.split("|");
      const ix=+p[0], iz=+p[1];
      if(Math.abs(iz*TILE-zc)>rad+TILE) continue;
      this.fill(t,ix,iz);
    }
  },
  reset(){ this.refresh(true); this.update(); }
};
Terrain.build();

// ---------- contact shadows ----------
// No shadow maps: the sun is fixed per sector, so a soft blob laid on the
// ground under each object (and an aeroplane-shaped one under you) grounds
// everything for a fraction of the cost.
const shadowTex=(()=>{
  const c=document.createElement("canvas"); c.width=64; c.height=64;
  const x=c.getContext("2d");
  const g=x.createRadialGradient(32,32,2,32,32,31);
  g.addColorStop(0,"rgba(0,0,0,0.85)");
  g.addColorStop(0.45,"rgba(0,0,0,0.55)");
  g.addColorStop(1,"rgba(0,0,0,0)");
  x.fillStyle=g; x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
})();
const planeShadowTex=(()=>{
  const c=document.createElement("canvas"); c.width=128; c.height=128;
  const x=c.getContext("2d");
  x.fillStyle="rgba(0,0,0,0.85)";
  x.translate(64,64);
  x.beginPath();                                   // wing
  x.moveTo(-56,-5); x.lineTo(56,-5); x.lineTo(52,7); x.lineTo(-52,7); x.closePath(); x.fill();
  x.beginPath();                                   // fuselage
  x.moveTo(-7,-44); x.lineTo(7,-44); x.lineTo(9,46); x.lineTo(-9,46); x.closePath(); x.fill();
  x.beginPath();                                   // tailplane
  x.moveTo(-22,38); x.lineTo(22,38); x.lineTo(19,48); x.lineTo(-19,48); x.closePath(); x.fill();
  x.filter="blur(2px)";
  const t=new THREE.CanvasTexture(c);
  return t;
})();
const Shadows={
  plane:null, sunX:0, sunZ:0, stretch:1, alpha:0.34,
  build(){
    const geo=new THREE.PlaneGeometry(1,1); geo.rotateX(-Math.PI/2);
    this.plane=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:planeShadowTex,
      transparent:true,opacity:0.34,depthWrite:false,fog:true,
      polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
    this.plane.renderOrder=1;
    this.plane.visible=false;
    scene.add(this.plane);
  },
  // recomputed when the sun moves, i.e. once per sector
  sun(){
    const y=Math.max(0.16,SUNDIR.y);
    this.sunX=-SUNDIR.x/y; this.sunZ=-SUNDIR.z/y;      // ground offset per metre of height
    this.stretch=clamp(1/y,1,2.6);
    this.alpha=clamp(0.16+y*0.30,0.14,0.42);
    if(this.plane) this.plane.material.opacity=this.alpha+0.06;
  },
  // where an object of this height throws its shadow, capped so a low sun
  // does not fling it into the next county
  offX(h){ return clamp(this.sunX*h,-h*2.2,h*2.2); },
  offZ(h){ return clamp(this.sunZ*h,-h*2.2,h*2.2); },
  // The sun sits ahead of you in every sector — that is where the glare and the
  // god rays come from — so an honest projection would throw your own shadow
  // permanently behind the tail, where the cockpit hides it. Instead it is cast
  // forward at a fixed rake that lands it just above the cowling, which is where
  // a real one is when the sun is low behind you. The lateral throw stays true.
  FORWARD:5.2,
  update(){
    const m=this.plane;
    if(!m) return;
    const flying=(Game.state===S.PLAY||Game.state===S.TAKEOFF||Game.state===S.ROLLOUT||Game.state===S.DYING);
    const gh=onField(P.x,P.z)?af.y:groundH(P.x,P.z);
    const agl=P.y-gh;
    if(!flying||agl>220||agl<-2){ m.visible=false; return; }
    const gx=P.x+clamp(this.sunX*agl*0.5,-agl*0.5,agl*0.5);   // keep it under the wing
    const gz=P.z-this.FORWARD*agl;
    const gy=onField(gx,gz)?af.y:groundH(gx,gz);
    m.position.set(gx,gy+0.5,gz);
    const spread=1+agl/190;                             // penumbra opens with height
    m.scale.set(16*spread*Math.max(0.30,Math.cos(P.roll)),1,16*spread*1.35);
    m.rotation.y=-P.roll*0.35;
    m.material.opacity=(this.alpha+0.18)*clamp(1-agl/260,0.12,1);
    m.visible=true;
  }
};
Shadows.build();

// ---------- scatter: woodland, hedgerows, rocks, farmsteads ----------
// A deterministic cell grid, rebuilt whenever the aircraft crosses a cell
// boundary. Every item sits on the same height field used for collision.
const CELL=95, SCX=17, SCZ=26;
const Scatter={
  cx:1e9, cz:1e9,
  m:{}, n:{},
  caps:{trunk:1600,canopy:1600,bush:1000,rock:320,wall:220,roof:220,hay:220,shade:900},
  dummy:new THREE.Object3D(), col:new THREE.Color(),
  build(){
    const mk=(geo,mat,cap)=>{
      const m=new THREE.InstancedMesh(geo,mat,cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled=false;
      scene.add(m); return m;
    };
    const trunkGeo=new THREE.CylinderGeometry(0.30,0.55,1,5); trunkGeo.translate(0,0.5,0);
    const canopyGeo=new THREE.IcosahedronGeometry(1,0);
    const bushGeo=new THREE.IcosahedronGeometry(1,0); bushGeo.scale(1,0.65,1); bushGeo.translate(0,0.6,0);
    const rockGeo=new THREE.DodecahedronGeometry(1,0);
    const wallGeo=new THREE.BoxGeometry(1,1,1); wallGeo.translate(0,0.5,0);
    const roofGeo=new THREE.CylinderGeometry(0.72,0.72,1,3);
    roofGeo.rotateX(Math.PI/2); roofGeo.rotateZ(Math.PI/2);   // gable ridge running along z
    const hayGeo=new THREE.CylinderGeometry(1,1,1,10); hayGeo.rotateZ(Math.PI/2);
    this.m.trunk =mk(trunkGeo, new THREE.MeshLambertMaterial({color:0x5a4030}),this.caps.trunk);
    this.m.canopy=mk(canopyGeo,new THREE.MeshLambertMaterial({color:0xffffff}),this.caps.canopy);
    this.m.bush  =mk(bushGeo,  new THREE.MeshLambertMaterial({color:0x3d6630}),this.caps.bush);
    this.m.rock  =mk(rockGeo,  new THREE.MeshLambertMaterial({color:0x8a8478}),this.caps.rock);
    this.m.wall  =mk(wallGeo,  new THREE.MeshLambertMaterial({color:0xffffff}),this.caps.wall);
    this.m.roof  =mk(roofGeo,  new THREE.MeshLambertMaterial({color:0xffffff}),this.caps.roof);
    this.m.hay   =mk(hayGeo,   new THREE.MeshLambertMaterial({color:0xc9a961}),this.caps.hay);
    const shadeGeo=new THREE.PlaneGeometry(1,1); shadeGeo.rotateX(-Math.PI/2);
    this.m.shade=mk(shadeGeo,new THREE.MeshBasicMaterial({map:shadowTex,transparent:true,
      opacity:0.34,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,
      polygonOffsetUnits:-4}),this.caps.shade);
    this.m.shade.renderOrder=1;
  },
  // a blob on the deck under something of this size, thrown away from the sun
  shade(x,z,y,r,h){
    this.put("shade",x+Shadows.offX(h),y+0.35,z+Shadows.offZ(h),
             r*2,1,r*2*Shadows.stretch);
  },
  put(key,x,y,z,sx,sy,sz,ry,color){
    const i=this.n[key];
    if(i>=this.caps[key]) return;
    if(af.active&&onField(x,z)) return;      // keep the airfield mown and clear
    const d=this.dummy;
    d.position.set(x,y,z);
    d.rotation.set(0,ry||0,0);
    d.scale.set(sx,sy,sz);
    d.updateMatrix();
    this.m[key].setMatrixAt(i,d.matrix);
    if(color!==undefined&&this.m[key].setColorAt){
      this.col.setHex(color); this.m[key].setColorAt(i,this.col);
    }
    this.n[key]=i+1;
  },
  tree(x,z,r){
    const y=groundH(x,z);
    if(y<TH.water+1) return;
    const s=0.75+r()*0.9;
    this.put("trunk",x,y,z,s*1.1,4.2*s,s*1.1);
    const cols=[0x2c5a2e,0x35662f,0x27522c,0x3f6b34,0x46703a];
    this.put("canopy",x,y+4.0*s+2.4*s,z,3.0*s,3.6*s,3.0*s,r()*3,cols[(r()*5)|0]);
    this.shade(x,z,y,3.4*s,6.4*s);
  },
  cell(gx,gz){
    const seed=(gx*73856093)^(gz*19349663);
    const r=mulberry32(seed|0);
    const bx=gx*CELL, bz=gz*CELL;
    const lu=landuse(bx+CELL*0.5,bz+CELL*0.5);
    if(onField(bx+CELL*0.5,bz+CELL*0.5)) return;
    if(lu>TH.wood){                                     // woodland: dense stand of trees
      const n=5+Math.floor(r()*5);
      for(let i=0;i<n;i++) this.tree(bx+r()*CELL, bz+r()*CELL, r);
    }else if(lu>0.34){                                  // farmland: hedged field boundaries
      const hedgeCol=[0x335a28,0x2c5024,0x3c6330];
      if(r()<0.82){
        for(let i=0;i<9;i++){
          const x=bx+i*(CELL/9)+r()*4, z=bz+r()*3;
          const y=groundH(x,z);
          if(y>TH.water+1) this.put("bush",x,y,z,2.4+r()*1.4,2.0+r()*1.2,2.0+r()*1.0,r()*3,hedgeCol[(r()*3)|0]);
        }
      }
      if(r()<0.72){
        for(let i=0;i<9;i++){
          const x=bx+r()*3, z=bz+i*(CELL/9)+r()*4;
          const y=groundH(x,z);
          if(y>TH.water+1) this.put("bush",x,y,z,2.4+r()*1.4,2.0+r()*1.2,2.0+r()*1.0,r()*3,hedgeCol[(r()*3)|0]);
        }
      }
      if(r()<0.30){                                     // hay bales rolled up in the corner
        const n=2+Math.floor(r()*4);
        for(let i=0;i<n;i++){
          const x=bx+20+r()*55, z=bz+20+r()*55, y=groundH(x,z);
          if(y>TH.water+1) this.put("hay",x,y+1.6,z,1.6,1.6,3.0,r()*3);
        }
      }
      if(r()<0.14) this.farmstead(bx+30+r()*35, bz+30+r()*35, r);
      if(r()<0.20) this.tree(bx+r()*CELL, bz+r()*CELL, r);
    }else{                                              // open pasture: scattered trees & stone
      if(r()<0.55) this.tree(bx+r()*CELL, bz+r()*CELL, r);
      if(r()<0.25){
        const x=bx+r()*CELL, z=bz+r()*CELL, y=groundH(x,z);
        if(y>TH.water+1){
          const s=1.2+r()*3.2;
          this.put("rock",x,y+s*0.4,z,s,s*0.75,s*1.1,r()*3, r()<0.5?0x8a8478:0x9a9082);
        }
      }
      if(r()<0.07) this.farmstead(bx+30+r()*35, bz+30+r()*35, r);
    }
  },
  farmstead(x,z,r){
    const y=groundH(x,z);
    if(y<TH.water+2) return;
    const walls=[0xe8dcc0,0xd8c8a8,0xc8b8a0,0xb08878];
    const roofs=[0x8a3a2c,0x6a4436,0x5a5a58,0x7a4a30];
    const n=2+Math.floor(r()*3);
    for(let i=0;i<n;i++){
      const ox=(r()-0.5)*46, oz=(r()-0.5)*46;
      const bxp=x+ox, bzp=z+oz, by=groundH(bxp,bzp);
      if(by<TH.water+2) continue;
      const w=7+r()*8, d=9+r()*11, h=4.5+r()*3.5;
      const ry=(r()<0.5?0:Math.PI/2)+(r()-0.5)*0.3;
      this.put("wall",bxp,by,bzp,w,h,d,ry,walls[(r()*4)|0]);
      this.put("roof",bxp,by+h+ (w*0.45), bzp, w*1.12, w*1.12, d*1.02, ry, roofs[(r()*4)|0]);
      this.shade(bxp,bzp,by,Math.max(w,d)*0.62,h*1.3);
    }
  },
  rebuild(){
    for(const k in this.m) this.n[k]=0;
    const gx0=Math.floor(P.x/CELL)-((SCX-1)>>1);
    const gz0=Math.floor(P.z/CELL)-(SCZ-3);
    for(let i=0;i<SCX;i++)
      for(let j=0;j<SCZ;j++)
        this.cell(gx0+i, gz0+j);
    // park the unused instances out of sight
    const d=this.dummy;
    d.position.set(0,-9999,0); d.rotation.set(0,0,0); d.scale.set(0.001,0.001,0.001);
    d.updateMatrix();
    for(const k in this.m){
      const mesh=this.m[k];
      for(let i=this.n[k];i<this.caps[k];i++) mesh.setMatrixAt(i,d.matrix);
      mesh.instanceMatrix.needsUpdate=true;
      if(mesh.instanceColor) mesh.instanceColor.needsUpdate=true;
      mesh.count=this.caps[k];
    }
  },
  update(){
    const cx=Math.floor(P.x/CELL), cz=Math.floor(P.z/CELL);
    if(cx===this.cx&&cz===this.cz) return;
    this.cx=cx; this.cz=cz;
    this.rebuild();
  },
  reset(){ this.cx=1e9; this.update(); }
};
Scatter.build();


// ---------- shared sprite glow ----------
const glowTex=(()=>{
  const c=document.createElement("canvas"); c.width=64; c.height=64;
  const x=c.getContext("2d");
  const g=x.createRadialGradient(32,32,2,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)");
  g.addColorStop(0.35,"rgba(255,255,255,0.35)");
  g.addColorStop(1,"rgba(255,255,255,0)");
  x.fillStyle=g; x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
})();
const bursts=[];
function burst(pos,color,scale){
  let b=bursts.find(b=>!b.active);
  if(!b){
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
    sp.visible=false; scene.add(sp);
    b={sp,active:false,t0:0,s:1}; bursts.push(b);
  }
  b.active=true; b.t0=performance.now(); b.s=scale||1;
  b.sp.material.color.set(color);
  b.sp.material.opacity=0.9;
  b.sp.position.copy(pos);
  b.sp.scale.set(6*b.s,6*b.s,1);
  b.sp.visible=true;
}
function updateBursts(){
  const now=performance.now();
  for(const b of bursts){
    if(!b.active) continue;
    const k=(now-b.t0)/460;
    if(k>=1){ b.active=false; b.sp.visible=false; continue; }
    const s=(6+k*48)*b.s;
    b.sp.scale.set(s,s,1);
    b.sp.material.opacity=0.9*(1-k);
  }
}

// ---------- the ring course ----------
// The course meanders on a fixed function of z, so the rings, the chart on
// your knee and the marker on the glass all agree without any bookkeeping.
function coursePathX(z){
  return Math.sin(z*0.00120)*180 + Math.sin(z*0.00041+1.7)*190;
}
const ringStripeTex=(()=>{
  const c=document.createElement("canvas"); c.width=128; c.height=16;
  const x=c.getContext("2d");
  for(let i=0;i<8;i++){
    x.fillStyle=i%2?"#d2452f":"#fbf4e2";
    x.fillRect(i*16,0,16,16);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.encoding=THREE.sRGBEncoding;
  return t;
})();
const ringGoldTex=(()=>{
  const c=document.createElement("canvas"); c.width=128; c.height=16;
  const x=c.getContext("2d");
  for(let i=0;i<8;i++){
    const g=x.createLinearGradient(i*16,0,i*16,16);
    if(i%2){ g.addColorStop(0,"#ffd75e"); g.addColorStop(0.45,"#d8930f"); g.addColorStop(1,"#8a5c08"); }
    else   { g.addColorStop(0,"#fff3c8"); g.addColorStop(1,"#e6c878"); }
    x.fillStyle=g; x.fillRect(i*16,0,16,16);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.encoding=THREE.sRGBEncoding;
  return t;
})();
const RING_R=13.5, RING_HIT=13.0;
const Rings={
  list:[], nextZ:0, seq:0,
  make(){
    const g=new THREE.Group();
    const torus=new THREE.Mesh(new THREE.TorusGeometry(RING_R,1.5,8,28),
      new THREE.MeshLambertMaterial({map:ringStripeTex}));
    g.add(torus);
    const inner=new THREE.Mesh(new THREE.TorusGeometry(RING_R-2.4,0.35,6,24),
      new THREE.MeshBasicMaterial({color:0xfff0c4}));
    g.add(inner);
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xffd98a,
      transparent:true,opacity:0.30,blending:THREE.AdditiveBlending,depthWrite:false}));
    halo.scale.set(52,52,1); g.add(halo);
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.7,1.1,1,7),
      new THREE.MeshLambertMaterial({color:0xe8e0cc}));
    g.add(mast);
    const flagGeo=new THREE.PlaneGeometry(6,3.4);
    const flag=new THREE.Mesh(flagGeo,new THREE.MeshLambertMaterial({color:0xd2452f,
      side:THREE.DoubleSide}));
    flag.position.set(RING_R+3.4,RING_R-3,0);
    g.add(flag);
    // tether balloons for the high gates
    const balloons=new THREE.Group();
    for(const sx of [-1,1]){
      const b=new THREE.Mesh(new THREE.SphereGeometry(4.2,10,8),
        new THREE.MeshLambertMaterial({color:sx<0?0xf2c14e:0x4ea3d2}));
      b.position.set(sx*(RING_R+7),RING_R+9,0);
      balloons.add(b);
      const line=new THREE.Line(lineGeo([sx*(RING_R+7),RING_R+5,0, sx*RING_R*0.72,RING_R*0.7,0]),
        new THREE.LineBasicMaterial({color:0x6a6254}));
      balloons.add(line);
    }
    g.add(balloons);
    scene.add(g);
    return {g,torus,inner,halo,mast,flag,balloons,
            active:false,hit:false,x:0,y:0,z:0,n:0,tall:false,gold:false,fade:0};
  },
  free(){
    for(const r of this.list) if(!r.active) return r;
    const r=this.make(); this.list.push(r); return r;
  },
  spawnAhead(){
    while(this.nextZ>P.z-VIEW){
      const z=this.nextZ;
      if(Airfield.reserved(z)) break;
      const r=this.free();
      this.seq++;
      const tall=this.seq%5===0;
      // gold gates: worth treble, and never on the easy line — down in the
      // hollows, out on a limb, close enough to the ground to make you think
      const gold=!tall&&this.seq>2&&hash(this.seq*13.7+4.1)<0.26;
      const x=coursePathX(z)+(hash(this.seq*3.7)-0.5)*(gold?300:70);
      const g=groundH(x,z);
      const y=tall ? g+110+hash(this.seq*5.1)*70
                   : (gold ? clearanceH(x,z)+19+hash(this.seq*9.3)*9
                           : Math.max(g+30, g+30+hash(this.seq*7.3)*46));
      r.active=true; r.hit=false; r.fade=0;
      r.x=x; r.y=y; r.z=z; r.n=this.seq; r.tall=tall; r.gold=gold;
      r.g.position.set(x,y,z);
      r.g.rotation.z=0;
      r.g.scale.set(1,1,1);
      r.torus.material.map=gold?ringGoldTex:ringStripeTex;
      r.torus.material.color.set(0xffffff);
      r.torus.material.needsUpdate=true;
      r.inner.material.color.set(gold?0xfff0b0:0xfff0c4);
      r.halo.material.color.set(gold?0xffc219:0xffd98a);
      r.halo.scale.set(gold?68:52,gold?68:52,1);
      r.flag.material.color.set(gold?0xe0a72c:0xd2452f);
      r.g.visible=true;
      if(gold) G.gold++;
      const clear=y-RING_R-g;
      r.mast.visible=!tall;
      r.balloons.visible=tall;
      if(!tall){
        r.mast.scale.set(1,clear,1);
        r.mast.position.set(0,-RING_R-clear*0.5,0);
      }
      r.flag.visible=!tall;
      G.rings++;
      this.nextZ-=250+hash(this.seq*11.1)*150;
    }
  },
  reset(){
    for(const r of this.list){ r.active=false; r.g.visible=false; }
    this.nextZ=P.z-520; this.seq=0;
  },
  update(dt){
    this.spawnAhead();
    const now=performance.now();
    for(const r of this.list){
      if(!r.active) continue;
      if(r.hit){
        r.fade+=dt*2.6;
        const k=1-r.fade;
        r.g.scale.set(1+r.fade*0.5,1+r.fade*0.5,1);
        r.halo.material.opacity=Math.max(0,k*0.6);
        if(r.fade>=1){ r.active=false; r.g.visible=false; }
        continue;
      }
      r.halo.material.opacity=0.22+0.12*Math.sin(now*0.004+r.n);
      if(r.tall) r.g.position.y=r.y+Math.sin(now*0.0011+r.n)*2.2;
      r.flag.rotation.y=Math.sin(now*0.006+r.n)*0.5;
      // crossing test: catch the frame in which we pass the ring's plane
      if(P.pz>r.z&&P.z<=r.z){
        const d=Math.hypot(P.x-r.x,P.y-r.g.position.y);
        if(d<RING_HIT){
          r.hit=true; r.fade=0;
          r.torus.material.color.set(0x8fe8a0);
          G.combo=Math.min(8,G.combo+1);
          G.bestCombo=Math.max(G.bestCombo,G.combo);
          G.ringsHit++;
          let pts=120*G.combo*(r.gold?3:1);
          let txt=(r.gold?"GOLD GATE +":"RING +")+pts;
          if(d<4.5){ pts+=r.gold?240:80; txt="BULLSEYE +"+pts; }
          G.score+=pts;
          if(r.gold) G.goldHit++;
          popup(txt+(G.combo>1?"   x"+G.combo:""));
          if(r.gold){ chime(1040); setTimeout(()=>chime(1560),90); }
          else chime(760+G.combo*70);
          burst(r.g.position,r.gold?0xffd24a:0xffe3a0,r.gold?2.0:1.4);
        }else if(d<RING_HIT+22){
          if(G.combo>0) popup("MISSED — CHAIN BROKEN");
          G.combo=0; thud();
        }else{
          G.combo=0;
        }
      }
      if(r.z>P.z+80){ r.active=false; r.g.visible=false; }
    }
  },
  nextGate(){
    let best=null;
    for(const r of this.list){
      if(!r.active||r.hit||r.z>P.z) continue;
      if(!best||r.z>best.z) best=r;
    }
    return best;
  }
};

// ---------- fuel balloons ----------
// gore-striped canopy fabric, so the drop reads as a parachute at a distance
const chuteTex=(()=>{
  const c=document.createElement("canvas"); c.width=64; c.height=16;
  const x=c.getContext("2d");
  for(let i=0;i<8;i++){ x.fillStyle=i%2?"#25b566":"#f4efdc"; x.fillRect(i*8,0,8,16); }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.encoding=THREE.sRGBEncoding;
  return t;
})();
const Fuel={
  list:[], nextZ:0,
  // Deliberately nothing like the hot-air balloons you have to dodge: a flat
  // dome instead of a sphere, shroud lines, a green jerrycan with a white
  // cross, and a blinking beacon. Different silhouette, different colour.
  make(){
    const g=new THREE.Group();
    const canopy=new THREE.Mesh(
      new THREE.SphereGeometry(8.6,18,8,0,Math.PI*2,0,Math.PI*0.52),
      new THREE.MeshLambertMaterial({map:chuteTex,side:THREE.DoubleSide}));
    canopy.scale.set(1,0.60,1);
    canopy.position.y=12;
    g.add(canopy);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(8.5,0.32,6,22),
      new THREE.MeshBasicMaterial({color:0x25b566}));
    rim.rotation.x=Math.PI/2; rim.position.y=12;
    g.add(rim);
    const lines=[];
    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2;
      lines.push(Math.cos(a)*8.3,12,Math.sin(a)*8.3, Math.cos(a)*1.5,3.4,Math.sin(a)*1.5);
    }
    g.add(new THREE.LineSegments(lineGeo(lines),
      new THREE.LineBasicMaterial({color:0xe4dfcc})));
    const can=new THREE.Mesh(new THREE.BoxGeometry(4.4,5.6,3.0),
      new THREE.MeshLambertMaterial({color:0x25b566}));
    g.add(can);
    for(const d of [[3.6,1.15],[1.15,4.0]]){        // white cross, both faces
      const bar=new THREE.Mesh(new THREE.BoxGeometry(d[0],d[1],3.15),
        new THREE.MeshBasicMaterial({color:0xf4efdc}));
      g.add(bar);
    }
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0x8fffc8,
      transparent:true,opacity:0.45,blending:THREE.AdditiveBlending,depthWrite:false}));
    halo.scale.set(34,34,1); halo.position.y=6;
    g.add(halo);
    const beacon=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0x7dffb0,
      blending:THREE.AdditiveBlending,depthWrite:false}));
    beacon.scale.set(6,6,1); beacon.position.y=-3.4;
    g.add(beacon);
    g.visible=false; scene.add(g);
    return {g,halo,beacon,active:false,x:0,y:0,z:0,phase:Math.random()*6};
  },
  free(){ for(const f of this.list) if(!f.active) return f;
    const f=this.make(); this.list.push(f); return f; },
  reset(){ for(const f of this.list){ f.active=false; f.g.visible=false; } this.nextZ=P.z-900; },
  update(dt){
    {
      while(this.nextZ>P.z-VIEW){
        const z=this.nextZ;
        if(Airfield.reserved(z)) break;
        const f=this.free();
        const x=coursePathX(z)+(Math.random()-0.5)*260;
        f.x=x; f.z=z; f.y=groundH(x,z)+60+Math.random()*90;
        f.active=true; f.g.visible=true;
        f.g.position.set(x,f.y,z);
        this.nextZ-=620+Math.random()*420;
      }
    }
    const now=performance.now();
    for(const f of this.list){
      if(!f.active) continue;
      f.g.rotation.y+=dt*0.30;                      // the canopy turns slowly
      f.g.position.y=f.y+Math.sin(now*0.0013+f.phase)*2.4;
      f.halo.material.opacity=0.35+0.2*Math.sin(now*0.005+f.phase);
      f.beacon.material.opacity=Math.floor(now/380+f.phase)%2?1:0.12;
      if(f.z>P.z+60){ f.active=false; f.g.visible=false; continue; }
      const dx=P.x-f.x, dy=P.y-f.g.position.y-4, dz=P.z-f.z;
      if(dx*dx+dy*dy+dz*dz<16*16){
        f.active=false; f.g.visible=false;
        burst(f.g.position,0x8fffc8,1.2);
        G.fuel=Math.min(100,G.fuel+38);
        popup("FUEL +38");
        chime(520);
      }
    }
  }
};

// ---------- hazards: pylons, masts, turbines, balloons, flocks ----------
// envelope fabric: vertical gores, warm and cool colourways but never green
const balloonTexs=(()=>{
  const pairs=[["#d2452f","#f4efdc"],["#3f8fd2","#f2c14e"],["#b05fc0","#f4efdc"],
               ["#e8724c","#2f4f7a"],["#f2c14e","#d2452f"],["#8a4fc0","#f4efdc"]];
  return pairs.map(pr=>{
    const c=document.createElement("canvas"); c.width=128; c.height=16;
    const x=c.getContext("2d");
    for(let i=0;i<16;i++){ x.fillStyle=pr[i%2]; x.fillRect(i*8,0,8,16); }
    const t=new THREE.CanvasTexture(c);
    t.wrapS=t.wrapT=THREE.RepeatWrapping;
    t.encoding=THREE.sRGBEncoding;
    return t;
  });
})();
const Haz={
  lines:[], masts:[], turbines:[], balloons:[], flocks:[],
  nextZ:0,
  makeLine(){
    const g=new THREE.Group();
    const towers=[];
    const towerMat=new THREE.MeshLambertMaterial({color:0x8d94a0});
    for(let i=0;i<2;i++){
      const t=new THREE.Group();
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.6,1.8,1,6),towerMat);
      const armA=new THREE.Mesh(new THREE.BoxGeometry(26,0.9,0.9),towerMat);
      const armB=new THREE.Mesh(new THREE.BoxGeometry(20,0.9,0.9),towerMat);
      t.add(leg); t.add(armA); t.add(armB);
      t.userData={leg,armA,armB};
      g.add(t); towers.push(t);
    }
    const cableMat=new THREE.LineBasicMaterial({color:0x2f3238});
    const cables=new THREE.LineSegments(lineGeo(new Array(3*2*24*3).fill(0)),cableMat);
    g.add(cables);
    g.visible=false; scene.add(g);
    return {g,towers,cables,active:false,x:0,z:0,span:0,h:0,sag:0};
  },
  makeMast(){
    const g=new THREE.Group();
    const mat=new THREE.MeshLambertMaterial({color:0xd2452f});
    const white=new THREE.MeshLambertMaterial({color:0xf2eede});
    for(let i=0;i<8;i++){
      const seg=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.3,1,6),i%2?white:mat);
      seg.name="seg"+i; g.add(seg);
    }
    const guys=new THREE.LineSegments(lineGeo(new Array(3*2*3).fill(0)),
      new THREE.LineBasicMaterial({color:0x55584f}));
    g.add(guys);
    const bc=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xff5a4e,
      blending:THREE.AdditiveBlending,depthWrite:false}));
    bc.scale.set(10,10,1); g.add(bc);
    g.visible=false; scene.add(g);
    return {g,beacon:bc,guys,active:false,x:0,z:0,h:0,base:0};
  },
  makeTurbine(){
    const g=new THREE.Group();
    const mat=new THREE.MeshLambertMaterial({color:0xf4f2ea});
    const tower=new THREE.Mesh(new THREE.CylinderGeometry(1.2,2.6,1,8),mat);
    g.add(tower);
    const hub=new THREE.Group();
    const nac=new THREE.Mesh(new THREE.BoxGeometry(3,3,7),mat);
    hub.add(nac);
    const rotor=new THREE.Group();
    for(let i=0;i<3;i++){
      const b=new THREE.Mesh(new THREE.BoxGeometry(2.6,34,0.7),mat);
      b.position.y=17;
      const holder=new THREE.Group();
      holder.rotation.z=i/3*Math.PI*2;
      holder.add(b);
      rotor.add(holder);
    }
    rotor.position.z=-4;
    hub.add(rotor);
    g.add(hub);
    g.visible=false; scene.add(g);
    return {g,tower,hub,rotor,active:false,x:0,z:0,h:0,base:0,spin:Math.random()*6};
  },
  makeBalloon(){
    const g=new THREE.Group();
    // Envelope: a lathed teardrop rather than a sphere — wide crown tapering to
    // the throat — panelled in gores, with the basket slung underneath on
    // visible cables and a pilot looking over the rim.
    const prof=[[3.4,0],[4.3,1.6],[6.2,3.6],[8.6,6.6],[11.0,10.2],[12.5,14.2],
                [13.0,18.0],[12.5,21.8],[10.6,25.4],[7.2,28.1],[3.6,29.5],[0,30]];
    const pts=prof.map(q=>new THREE.Vector2(q[0],q[1]));
    const env=new THREE.Mesh(new THREE.LatheGeometry(pts,22),
      new THREE.MeshLambertMaterial({
        map:balloonTexs[(Math.random()*balloonTexs.length)|0],
        side:THREE.DoubleSide}));
    g.add(env);
    const throat=new THREE.Mesh(new THREE.TorusGeometry(3.5,0.22,6,16),
      new THREE.MeshLambertMaterial({color:0x4a4238}));
    throat.rotation.x=Math.PI/2; throat.position.y=0.2;
    g.add(throat);
    // basket, hanging clear of the throat: wider than it is tall, as they are
    const BY=-8.4, RIM=BY+1.65;
    const basket=new THREE.Mesh(new THREE.CylinderGeometry(3.1,2.7,3.0,4),
      new THREE.MeshLambertMaterial({color:0xa87c40}));
    basket.rotation.y=Math.PI/4; basket.position.y=BY;
    g.add(basket);
    const rim=new THREE.Mesh(new THREE.CylinderGeometry(3.3,3.3,0.5,4),
      new THREE.MeshLambertMaterial({color:0x6a4a22}));
    rim.rotation.y=Math.PI/4; rim.position.y=RIM;
    g.add(rim);
    // suspension cables from the throat, and the burner frame above the rim
    const rig=[];
    for(let i=0;i<4;i++){
      const a=i/4*Math.PI*2+Math.PI/4;
      rig.push(Math.cos(a)*3.3,0.2,Math.sin(a)*3.3, Math.cos(a)*2.5,RIM,Math.sin(a)*2.5);
      rig.push(Math.cos(a)*1.0,RIM,Math.sin(a)*1.0, Math.cos(a)*0.6,RIM+2.4,Math.sin(a)*0.6);
    }
    g.add(new THREE.LineSegments(lineGeo(rig),
      new THREE.LineBasicMaterial({color:0x4a463c})));
    const burner=new THREE.Mesh(new THREE.CylinderGeometry(0.75,0.95,1.1,8),
      new THREE.MeshLambertMaterial({color:0x7a7a76}));
    burner.position.y=RIM+2.9;
    g.add(burner);
    // the pilot, head and shoulders over the rim
    const torso=new THREE.Mesh(new THREE.CylinderGeometry(0.85,1.0,2.5,8),
      new THREE.MeshLambertMaterial({color:0x2f4f7a}));
    torso.position.set(0.9,RIM+0.6,0.5);
    g.add(torso);
    const head=new THREE.Mesh(new THREE.SphereGeometry(0.78,9,8),
      new THREE.MeshLambertMaterial({color:0xd8a882}));
    head.position.set(0.9,RIM+2.2,0.5);
    g.add(head);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.42,2.0),
      new THREE.MeshLambertMaterial({color:0x2f4f7a}));
    arm.position.set(1.7,RIM+0.5,0.6);            // hand on the rim
    g.add(arm);
    const flame=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xffb03a,
      blending:THREE.AdditiveBlending,depthWrite:false,opacity:0.8}));
    flame.scale.set(2.2,3.2,1); flame.position.y=RIM+3.7;
    g.add(flame);
    g.visible=false; scene.add(g);
    return {g,flame,active:false,x:0,y:0,z:0,drift:0,phase:Math.random()*6};
  },
  makeFlock(){
    const N=22, pos=new Float32Array(N*3);
    for(let i=0;i<N;i++){
      pos[i*3]=(Math.random()-0.5)*26;
      pos[i*3+1]=(Math.random()-0.5)*10;
      pos[i*3+2]=(Math.random()-0.5)*26;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute("position",new THREE.BufferAttribute(pos,3));
    const pts=new THREE.Points(geo,new THREE.PointsMaterial({color:0x2a2620,size:1.6,
      sizeAttenuation:true}));
    pts.visible=false; scene.add(pts);
    return {g:pts,active:false,x:0,y:0,z:0,vx:0,phase:Math.random()*6};
  },
  freeOf(list,make,cap){
    for(const h of list) if(!h.active) return h;
    if(list.length>=cap) return null;
    const h=make(); list.push(h); return h;
  },
  placeLine(h,z){
    const span=340+Math.random()*260;
    const x=coursePathX(z)+(Math.random()-0.5)*160;
    const base=Math.max(groundH(x-span/2,z),groundH(x+span/2,z));
    const th=46+Math.random()*30;
    h.active=true; h.x=x; h.z=z; h.span=span; h.h=base+th; h.sag=18+Math.random()*14;
    h.g.position.set(x,0,z);
    h.g.visible=true;
    h.towers.forEach((t,i)=>{
      const sx=(i?1:-1)*span/2;
      const g0=groundH(x+sx,z);
      t.position.set(sx,g0,0);
      const H0=h.h-g0;
      const u=t.userData;
      u.leg.scale.set(1,H0,1); u.leg.position.y=H0/2;
      u.armA.position.set(0,H0*0.72,0);
      u.armB.position.set(0,H0*0.90,0);
    });
    // three catenary cables strung between the arms
    const pos=h.cables.geometry.attributes.position.array;
    let p=0;
    for(let c=0;c<3;c++){
      const off=(c-1)*9, sag=h.sag*(1+c*0.06);
      let prev=null;
      for(let i=0;i<=23;i++){
        const k=i/23, xx=-span/2+span*k;
        const yy=h.h+off*0.25-Math.sin(k*Math.PI)*sag;
        if(prev){ pos[p++]=prev[0]; pos[p++]=prev[1]; pos[p++]=off;
                  pos[p++]=xx;      pos[p++]=yy;      pos[p++]=off; }
        prev=[xx,yy];
      }
    }
    h.cables.geometry.attributes.position.needsUpdate=true;
    h.cables.geometry.computeBoundingSphere();
  },
  cableY(h,x){
    const k=clamp((x-h.x+h.span/2)/h.span,0,1);
    return h.h-Math.sin(k*Math.PI)*h.sag;
  },
  placeMast(h,z){
    const x=coursePathX(z)+(Math.random()<0.5?-1:1)*(90+Math.random()*180);
    const base=groundH(x,z);
    const H0=90+Math.random()*110;
    h.active=true; h.x=x; h.z=z; h.h=base+H0; h.base=base;
    h.g.position.set(x,base,z);
    h.g.visible=true;
    for(let i=0;i<8;i++){
      const seg=h.g.getObjectByName("seg"+i);
      seg.scale.set(1,H0/8,1);
      seg.position.y=H0/8*(i+0.5);
    }
    h.beacon.position.set(0,H0+3,0);
    const gp=h.guys.geometry.attributes.position.array;
    for(let i=0;i<3;i++){
      const a=i/3*Math.PI*2;
      gp[i*6]=0; gp[i*6+1]=H0*0.72; gp[i*6+2]=0;
      gp[i*6+3]=Math.cos(a)*H0*0.42; gp[i*6+4]=0; gp[i*6+5]=Math.sin(a)*H0*0.42;
    }
    h.guys.geometry.attributes.position.needsUpdate=true;
    h.guys.geometry.computeBoundingSphere();
  },
  placeTurbine(h,z){
    const x=coursePathX(z)+(Math.random()-0.5)*300;
    const base=groundH(x,z);
    const H0=58+Math.random()*32;
    h.active=true; h.x=x; h.z=z; h.h=base+H0; h.base=base;
    h.g.position.set(x,base,z);
    h.g.visible=true;
    h.tower.scale.set(1,H0,1); h.tower.position.y=H0/2;
    h.hub.position.set(0,H0,0);
  },
  placeBalloon(h,z){
    const x=coursePathX(z)+(Math.random()-0.5)*380;
    h.active=true; h.x=x; h.z=z;
    h.y=groundH(x,z)+70+Math.random()*140;
    h.drift=(Math.random()-0.5)*14;
    h.g.position.set(x,h.y,z);
    h.g.visible=true;
  },
  placeFlock(h,z){
    const x=coursePathX(z)+(Math.random()-0.5)*300;
    h.active=true; h.x=x; h.z=z;
    h.y=groundH(x,z)+40+Math.random()*110;
    h.vx=(Math.random()<0.5?-1:1)*(16+Math.random()*14);
    h.g.position.set(x,h.y,z);
    h.g.visible=true;
  },
  reset(){
    for(const l of [this.lines,this.masts,this.turbines,this.balloons,this.flocks])
      for(const h of l){ h.active=false; h.g.visible=false; }
    this.nextZ=P.z-1400;
  },
  spawnAhead(){
    if(G.lvl<2) return;
    while(this.nextZ>P.z-VIEW){
      const z=this.nextZ;
      if(Airfield.reserved(z)) break;
      const r=Math.random();
      const tier=Math.min(1,(G.lvl-1)/4);
      if(r<0.30){ const h=this.freeOf(this.lines,()=>this.makeLine(),6);      if(h) this.placeLine(h,z); }
      else if(r<0.52){ const h=this.freeOf(this.masts,()=>this.makeMast(),8);  if(h) this.placeMast(h,z); }
      else if(r<0.72){ const h=this.freeOf(this.turbines,()=>this.makeTurbine(),10); if(h) this.placeTurbine(h,z); }
      else if(r<0.88){ const h=this.freeOf(this.balloons,()=>this.makeBalloon(),8); if(h) this.placeBalloon(h,z); }
      else{ const h=this.freeOf(this.flocks,()=>this.makeFlock(),6); if(h) this.placeFlock(h,z); }
      this.nextZ-=(520-260*tier)+Math.random()*340;
    }
  },
  clearNear(z,rad){
    for(const l of [this.lines,this.masts,this.turbines,this.balloons,this.flocks])
      for(const h of l) if(h.active&&Math.abs(h.z-z)<rad){ h.active=false; h.g.visible=false; }
  },
  update(dt){
    this.spawnAhead();
    const hitR=PR;
    let warn=false;
    for(const h of this.lines){
      if(!h.active) continue;
      if(h.z>P.z+90){ h.active=false; h.g.visible=false; continue; }
      if(P.z-h.z<420&&P.z>h.z&&Math.abs(P.x-h.x)<h.span*0.5) warn=true;
      if(P.invuln>0) continue;
      if(P.pz>h.z&&P.z<=h.z){
        const dxl=Math.abs(P.x-h.x);
        if(dxl<h.span*0.5){
          if(Math.abs(P.y-this.cableY(h,P.x))<7){ crash("CABLE STRIKE"); return; }
        }
        if(Math.abs(dxl-h.span*0.5)<5&&P.y<h.h+6){ crash("PYLON STRIKE"); return; }
      }
    }
    for(const h of this.masts){
      if(!h.active) continue;
      if(h.z>P.z+90){ h.active=false; h.g.visible=false; continue; }
      if(P.z-h.z<0&&h.z-P.z<420&&Math.abs(P.x-h.x)<26&&P.y<h.h) warn=true;
      if(P.invuln<=0&&Math.abs(P.z-h.z)<6&&Math.abs(P.x-h.x)<4+hitR&&P.y<h.h){
        crash("MAST STRIKE"); return;
      }
    }
    const now=performance.now();
    for(const h of this.turbines){
      if(!h.active) continue;
      if(h.z>P.z+90){ h.active=false; h.g.visible=false; continue; }
      h.rotor.rotation.z+=dt*1.5;
      if(h.z<P.z&&P.z-h.z<380&&Math.abs(P.x-h.x)<44&&P.y<h.h+38) warn=true;
      if(P.invuln<=0&&Math.abs(P.z-h.z)<8){
        const d=Math.hypot(P.x-h.x,P.y-h.h);
        if(d<34+hitR*0.5){ crash("ROTOR STRIKE"); return; }
      }
    }
    for(const h of this.balloons){
      if(!h.active) continue;
      if(h.z>P.z+90){ h.active=false; h.g.visible=false; continue; }
      h.x+=h.drift*dt;
      h.g.position.set(h.x,h.y+Math.sin(now*0.0009+h.phase)*3,h.z);
      if(h.flame) h.flame.material.opacity=0.35+0.5*Math.abs(Math.sin(now*0.006+h.phase));
      if(P.invuln<=0&&Math.abs(P.z-h.z)<10){
        // the envelope is the big target, but the basket hanging under it is
        // solid too — you can see it, so it has to bite
        const dx=P.x-h.x, dy=P.y-h.g.position.y;
        const env=Math.hypot(dx,dy-16)<14+hitR*0.5;
        const basket=Math.abs(dx)<3.4+hitR*0.5&&dy<-4.2&&dy>-12.2;
        if(env||basket){ crash("BALLOON STRIKE"); return; }
      }
    }
    for(const h of this.flocks){
      if(!h.active) continue;
      if(h.z>P.z+90){ h.active=false; h.g.visible=false; continue; }
      h.x+=h.vx*dt;
      h.z+=26*dt;
      h.g.position.set(h.x,h.y+Math.sin(now*0.002+h.phase)*2,h.z);
      if(P.invuln<=0&&Math.abs(P.z-h.z)<14&&Math.hypot(P.x-h.x,P.y-h.y)<18){
        h.active=false; h.g.visible=false;
        birdStrike();
      }
    }
    Game.warnObst=warn;
  }
};

// ---------- the airfield: the finale of every sector ----------
function makeRunwayTexture(){
  const c=document.createElement("canvas"); c.width=256; c.height=1024;
  const x=c.getContext("2d");
  x.fillStyle="#4a4a4c"; x.fillRect(0,0,256,1024);
  for(let i=0;i<2600;i++){                                   // asphalt grain
    x.fillStyle=`rgba(${90+hash(i)*40|0},${90+hash(i*3)*40|0},${92+hash(i*7)*40|0},0.20)`;
    x.fillRect(hash(i*11)*256,hash(i*13)*1024,2,2);
  }
  x.fillStyle="#3e3e40";                                     // rubber in the touchdown zones
  x.globalAlpha=0.5;
  x.fillRect(30,150,196,90); x.fillRect(30,784,196,90);
  x.globalAlpha=1;
  x.fillStyle="#e8e4d8";
  for(let i=0;i<8;i++){                                      // threshold piano keys
    x.fillRect(24+i*27,26,18,74);
    x.fillRect(24+i*27,924,18,74);
  }
  for(let y=140;y<884;y+=64) x.fillRect(124,y,8,38);         // centreline
  x.fillRect(18,26,7,972); x.fillRect(231,26,7,972);         // edge lines
  for(const y of [150,150+58,784,784+58]){                   // touchdown zone bars
    x.fillRect(52,y,12,44); x.fillRect(192,y,12,44);
  }
  x.fillRect(74,262,14,54); x.fillRect(168,262,14,54);       // aiming points
  x.fillRect(74,708,14,54); x.fillRect(168,708,14,54);
  // runway designators: the plane's UVs mirror in u, so pre-mirror the glyphs
  x.save();
  x.translate(128,880); x.scale(-1,1);
  x.font="800 74px ui-monospace,Menlo,monospace";
  x.textAlign="center"; x.textBaseline="middle"; x.fillStyle="#e8e4d8";
  x.fillText("18",0,0);
  x.restore();
  x.save();
  x.translate(128,144); x.scale(1,-1);
  x.font="800 74px ui-monospace,Menlo,monospace";
  x.textAlign="center"; x.textBaseline="middle"; x.fillStyle="#e8e4d8";
  x.fillText("36",0,0);
  x.restore();
  const t=new THREE.CanvasTexture(c);
  t.encoding=THREE.sRGBEncoding;
  t.anisotropy=4;
  return t;
}
const Airfield={
  build(){
    const g=new THREE.Group();
    const apron=new THREE.Mesh(new THREE.PlaneGeometry(af.wid+150,af.len+340),
      new THREE.MeshLambertMaterial({color:0x5f7f3c}));
    apron.rotation.x=-Math.PI/2; apron.position.y=0.08;
    g.add(apron);
    const strip=new THREE.Mesh(new THREE.PlaneGeometry(af.wid,af.len),
      new THREE.MeshLambertMaterial({map:makeRunwayTexture()}));
    strip.rotation.x=-Math.PI/2; strip.position.y=0.18;
    g.add(strip);
    // runway edge lights
    const edgePos=[];
    for(let z=-af.len/2;z<=af.len/2;z+=50){
      edgePos.push(-af.wid/2-1.5,0.9,z, af.wid/2+1.5,0.9,z);
    }
    af.edge=new THREE.Points(lineGeo(edgePos),new THREE.PointsMaterial({color:0xfff0c0,
      size:1.9,sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false}));
    g.add(af.edge);
    // approach strobes running toward the threshold
    af.strobes=[];
    for(let i=0;i<8;i++){
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xffffff,
        blending:THREE.AdditiveBlending,depthWrite:false,opacity:0}));
      s.scale.set(11,11,1);
      s.position.set(0,3+i*0.4,af.len/2+40+i*62);
      g.add(s); af.strobes.push(s);
    }
    // PAPI: four lights that read your glide path back to you
    af.papi=[];
    for(let i=0;i<4;i++){
      const m=new THREE.Mesh(new THREE.BoxGeometry(4,3,3),
        new THREE.MeshBasicMaterial({color:0xffffff}));
      m.position.set(-af.wid/2-16,2.5,af.len/2-190+i*9);
      g.add(m); af.papi.push(m);
    }
    // windsock
    {
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.5,14,6),
        new THREE.MeshLambertMaterial({color:0xe8e4d8}));
      pole.position.set(af.wid/2+34,7,af.len/2-60);
      g.add(pole);
      const piv=new THREE.Group();
      piv.position.set(af.wid/2+34,13,af.len/2-60);
      const sock=new THREE.Mesh(new THREE.CylinderGeometry(1.4,3.0,11,8,1,true),
        new THREE.MeshLambertMaterial({color:0xff7a2f,side:THREE.DoubleSide}));
      sock.rotation.z=Math.PI/2; sock.position.x=5.5;
      piv.add(sock);
      g.add(piv);
      af.windsockPivot=piv;
    }
    // hangars, tower and a couple of parked aircraft
    const hangarMat=new THREE.MeshLambertMaterial({color:0xb9bcb4});
    const roofMat=new THREE.MeshLambertMaterial({color:0x8f9a92});
    for(let i=0;i<3;i++){
      const hx=-af.wid/2-96, hz=-af.len/2+180+i*84;
      const box=new THREE.Mesh(new THREE.BoxGeometry(54,14,60),hangarMat);
      box.position.set(hx,7,hz); g.add(box);
      const roof=new THREE.Mesh(new THREE.CylinderGeometry(30,30,60,12,1,false,0,Math.PI),roofMat);
      roof.rotation.x=Math.PI/2; roof.rotation.z=Math.PI;
      roof.position.set(hx,14,hz);
      roof.scale.set(0.9,1,0.34);
      g.add(roof);
    }
    {
      const t=new THREE.Mesh(new THREE.BoxGeometry(16,30,16),
        new THREE.MeshLambertMaterial({color:0xe6e2d4}));
      t.position.set(-af.wid/2-60,15,-af.len/2+90); g.add(t);
      const cab=new THREE.Mesh(new THREE.BoxGeometry(22,9,22),
        new THREE.MeshPhongMaterial({color:0x7fa8c4,shininess:60}));
      cab.position.set(-af.wid/2-60,34,-af.len/2+90); g.add(cab);
      const rail=new THREE.Mesh(new THREE.BoxGeometry(26,1,26),roofMat);
      rail.position.set(-af.wid/2-60,39,-af.len/2+90); g.add(rail);
    }
    for(let i=0;i<3;i++){                                       // parked light aircraft
      const px=-af.wid/2-40, pz=-af.len/2+300+i*26;
      const body=new THREE.Mesh(new THREE.BoxGeometry(3,2.4,10),
        new THREE.MeshLambertMaterial({color:i%2?0xf2c14e:0xfbf4e2}));
      body.position.set(px,2.4,pz); g.add(body);
      const wing=new THREE.Mesh(new THREE.BoxGeometry(18,0.6,3),
        new THREE.MeshLambertMaterial({color:0xfbf4e2}));
      wing.position.set(px,3.2,pz+0.6); g.add(wing);
      const tail=new THREE.Mesh(new THREE.BoxGeometry(6,0.5,2),
        new THREE.MeshLambertMaterial({color:0xfbf4e2}));
      tail.position.set(px,3.4,pz-4.4); g.add(tail);
    }
    g.visible=false;
    scene.add(g);
    af.group=g;
  },
  place(x,z){
    af.x=x; af.z=z;
    let sum=0,n=0;                                    // grade to the mean of the land beneath
    for(let dz=-af.len/2;dz<=af.len/2;dz+=100){ sum+=baseH(af.x,af.z+dz); n++; }
    af.y=Math.max(TH.water+6,sum/n);
    af.group.position.set(af.x,af.y,af.z);
    af.group.visible=true;
  },
  // Put the field down while it is still over the horizon: beyond the terrain
  // ring and beyond fog, so it is cut into the ground as those tiles load and
  // simply fades up out of the haze instead of snapping into existence.
  reveal(){
    af.active=true; af.phase=6; af.rollT=0; af.seen=false;
    this.place(clamp(coursePathX(P.z-(G.levelEnd-P.dist))*0.6,-260,260),
               P.z-(G.levelEnd-P.dist));
    Terrain.regrade(af.z,af.len*0.5+400);   // no-op this far out; cheap insurance
    Scatter.rebuild();
  },
  beginApproach(){
    af.phase=1;
    Haz.clearNear(af.z,af.len*0.5+400);     // nothing should have spawned here anyway
    for(const r of Rings.list)
      if(r.active&&Math.abs(r.z-af.z)<af.len*0.5+320){ r.active=false; r.g.visible=false; }
    popup("FIELD IN SIGHT — RUNWAY 18");
    radioCall();
  },
  // is this stretch of ground reserved for the arrival field?
  reserved(z){
    if(!af.active||af.phase===4||af.phase===5) return false;   // departure strip is behind us
    return z<af.z+af.len*0.5+500;
  },
  // put the aeroplane at the holding point of a departure strip
  departure(){
    af.active=true; af.phase=4; af.rollT=0;
    TO.lifted=false; TO.rotT=0; TO.vrT=0;
    this.place(clamp(coursePathX(P.z-af.len*0.5)*0.6,-260,260), P.z-af.len*0.5+40);
    P.x=af.x; P.z=af.z+af.len*0.5-80; P.y=af.y+2.4;
    P.vx=0; P.vy=0; P.roll=0; P.speed=0; P.pz=P.z;
    Terrain.regrade(af.z,af.len*0.5+400);
    Scatter.rebuild();
  },
  deactivate(){
    const z=af.z;
    af.active=false; af.phase=0;
    af.group.visible=false;
    Terrain.regrade(z,af.len*0.5+400);
    Scatter.rebuild();
  },
  // the aiming point: 200 m in from the threshold, leaving the strip for the roll
  aimZ(){ return af.z+af.len*0.5-200; },
  // how far above the ideal 5-degree glide path we are, in metres
  glideError(){
    const run=Math.max(1,P.z-this.aimZ());
    return (P.y-af.y)-run*Math.tan(5*Math.PI/180);
  },
  update(dt,t){
    if(!af.active) return;
    if(af.phase===1){                           // approach aids, lit for arrivals only
      const flashI=7-Math.floor(t/85)%8;
      af.strobes.forEach((s,i)=>{ s.material.opacity=(i===flashI)?1:0.10; });
      const err=this.glideError();
      af.papi.forEach((m,i)=>{                  // two white two red = on slope
        const th=(i-1.5)*11;
        m.material.color.set(err>th?0xffffff:0xff4436);
      });
    }else{
      af.strobes.forEach(s=>{ s.material.opacity=0; });
    }
    if(af.windsockPivot) af.windsockPivot.rotation.y=Math.PI/2+Math.sin(t*0.0013)*0.35+Game.wind*0.02;
  }
};
Airfield.build();

// ---------- sector setup ----------
function applyTheme(lvl){
  Game.curTheme=(lvl-1)%THEMES.length;
  TH=THEMES[Game.curTheme];
  Game.curTod=(lvl-1)%TODS.length;
  const td=TODS[Game.curTod];
  sky.material.map=skyTexs[Game.curTod]; sky.material.needsUpdate=true;
  scene.fog.color.set(td.fog);
  sunLight.color.set(td.sunC); sunLight.intensity=td.sunI;
  hemiLight.color.set(td.hemiS); hemiLight.groundColor.set(td.hemiG); hemiLight.intensity=td.hemiI;
  renderer.toneMappingExposure=td.exp;
  SUNDIR.set(td.dir[0],td.dir[1],td.dir[2]).normalize();
  sunLight.position.copy(SUNDIR).multiplyScalar(1400);
  sunGlow.material.opacity=td.glowO;
  Shadows.sun();
  applyWeather(lvl);
}

// ---------- damage, death and the end of a run ----------
function crash(reason){
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

// ---------- frame ----------
function stopLoop(){ Game.looping=false; }
function startLoop(){
  if(Game.looping) return;
  Game.looping=true; Game.tPrev=performance.now();
  requestAnimationFrame(frame);
}
function frame(t){
  if(!Game.looping) return;
  requestAnimationFrame(frame);
  const dt=Game.simHold?0:(Math.min(0.05,(t-Game.tPrev)/1000)||0.016);Game.tPrev=t;
  if(Game.simHold){
    Airfield.update(dt,t);
    renderFrame(t);
    return;
  }
  if(Game.state===S.PLAY){
    if(Game.readyT>0)Game.readyT-=dt;
    else update(dt,t);
  }
  else if(Game.state===S.TAKEOFF){
    if(Game.readyT>0)Game.readyT-=dt;                 // run-up at the holding point
    else updateTakeoff(dt);
  }
  else if(Game.state===S.ROLLOUT) updateRollout(dt);
  else if(Game.state===S.DYING) updateDying(dt);
  else if(Game.state===S.MENU&&Game.attractOn) updateAttract(dt);
  Airfield.update(dt,t);
  audioTick();
  renderFrame(t);
}
function renderFrame(t){
  Shadows.update();
  const bank=Game.state===S.DYING?Math.sin(Game.dying.roll)*0.95:P.roll;
  camera.position.set(P.x,P.y,P.z);
  if(Game.state===S.DYING){
    camera.rotation.set(-0.34+Math.sin(Game.dying.t*7)*0.05,Math.sin(Game.dying.roll*0.5)*0.25,-bank);
  }else if(Game.state===S.ROLLOUT){
    camera.rotation.set(0.02,0,-bank*0.4);
  }else if(Game.state===S.TAKEOFF){
    // tail-down on the roll, nose coming up through the rotation
    camera.rotation.set(0.06-Math.min(0.10,P.speed*0.0011)+(TO.lifted?Math.min(0.16,TO.rotT*0.4):0),
                        0,-bank*0.5);
  }else{
    camera.rotation.set(P.vy*0.0042,-P.vx*0.0016,-bank);
  }
  if(Game.shake>0){
    camera.position.x+=(Math.random()-0.5)*Game.shake*4;
    camera.position.y+=(Math.random()-0.5)*Game.shake*4;
  }
  sky.position.set(P.x,0,P.z);
  sunGlow.position.set(P.x+SUNDIR.x*4000, SUNDIR.y*4000, P.z+SUNDIR.z*4000);
  for(const r of ridges){
    const u=r.userData;
    r.position.set(P.x*u.fac, u.h*0.30+TH.amp*0.5, P.z-u.dist);
  }
  if(Game.postOn&&rtScene){ renderPost(); }
  else{ renderer.setRenderTarget(null); renderer.render(scene,camera); }
  drawHUD(t);
}
requestAnimationFrame(frame);

// ---------- overlays / flow ----------
const overlays=["startOverlay","pauseOverlay","overOverlay","rotateOverlay","clearOverlay","quitOverlay"];
function show(id){overlays.forEach(o=>document.getElementById(o).classList.toggle("hidden",o!==id));}
function hideAll(){overlays.forEach(o=>document.getElementById(o).classList.add("hidden"));}
function isPortrait(){return window.innerHeight>window.innerWidth;}
function checkOrient(){
  const ro=document.getElementById("rotateOverlay");
  if(isPortrait()&&Game.state!==S.MENU){
    ro.classList.remove("hidden");
    if(Game.state===S.PLAY||Game.state===S.ROLLOUT||Game.state===S.TAKEOFF){Game.prePauseState=Game.state;Game.state=S.PAUSE;Game.orientPaused=true;}
  }else if(!isPortrait()){
    ro.classList.add("hidden");
    if(Game.state===S.PAUSE&&Game.orientPaused){
      Game.orientPaused=false;
      calibrate();
      hideAll();
      Game.readyT=Math.max(Game.readyT,1.0);
      Game.state=Game.prePauseState;
    }else if(Game.state===S.PAUSE&&document.getElementById("pauseOverlay").classList.contains("hidden")){
      show("pauseOverlay");
    }
  }
}
window.addEventListener("resize",checkOrient);
window.addEventListener("orientationchange",checkOrient);

async function startFlow(){
  initAudio();
  resumeAudio();
  if(!CAN_TILT){
    permState="unsupported";
  }else try{
    if(typeof DeviceOrientationEvent.requestPermission==="function"){
      permState=await DeviceOrientationEvent.requestPermission();
    }else{permState="granted";}
  }catch(e){permState="denied";}
  try{await document.documentElement.requestFullscreen({navigationUI:"hide"});}catch(e){}
  try{if(screen.orientation&&screen.orientation.lock)await screen.orientation.lock("landscape");}catch(e){}
  setTimeout(()=>{
    calibrate();resetWorld();hideAll();
    document.getElementById("uiBtns").style.display="flex";
    Game.attractOn=false;
    Game.state=S.TAKEOFF;Game.readyT=2.0;checkOrient();
  },350);
}
// A device that cannot tilt shouldn't be offered tilt: the button, the control
// line and the recalibrate option all describe the keyboard instead.
(function setupControlsUI(){
  const chk=document.getElementById("invertChk");
  chk.checked=invertPitch;
  chk.addEventListener("change",()=>setInvertPitch(chk.checked));

  if(CAN_TILT)return;

  document.getElementById("startBtn").innerHTML="&#9654;&ensp;Fly";
  document.getElementById("ctrlLine").innerHTML=
    "<b>ARROWS</b> or <b>WASD</b> to bank &middot; dive &middot; climb";
  document.getElementById("footLine").innerHTML=
    "Headphones recommended &middot; &larr; &rarr; bank &middot; &uarr; &darr; pitch";
  document.getElementById("invertRow").style.display="flex";
  const recal=document.getElementById("recalBtn");
  if(recal)recal.style.display="none";
})();

document.getElementById("startBtn").addEventListener("click",startFlow);
document.getElementById("retryBtn").addEventListener("click",()=>{
  calibrate();resetWorld();hideAll();Game.state=S.TAKEOFF;Game.readyT=2.0;checkOrient();
});
document.getElementById("contBtn").addEventListener("click",()=>{
  nextSector();
  hideAll();Game.state=S.TAKEOFF;Game.readyT=1.6;checkOrient();
});
document.getElementById("entryRow").addEventListener("submit",async (e)=>{
  e.preventDefault();
  const pn=document.getElementById("pilotName");
  const name=cleanName(pn.value);
  if(!name){                                  // ask again rather than post a blank
    pn.classList.remove("nudge"); void pn.offsetWidth; pn.classList.add("nudge");
    pn.focus();
    return;
  }
  pn.blur();                                  // let the on-screen keyboard go
  const entry={name,score:G.score,lvl:G.lvl,rings:G.ringsHit,chain:G.bestCombo};
  Save.submit(entry);                         // the local logbook always takes it
  document.getElementById("entryRow").style.display="none";
  chime(980);
  if(!Net.online){ renderBoard(name); return; }
  Net.note="sending to the world board…";
  renderBoard(name);
  const d=await Net.submit(entry);
  if(d&&d.ok){
    Net.note=d.rank
      ? "world logbook &middot; you are <b>"+ordinal(d.rank)+"</b>"+
        (d.improved?"":" (your best still stands)")
      : "";
  }else{
    Net.note=(d&&d.error?d.error:"world board unreachable")+
      " &middot; saved to your logbook";
  }
  renderBoard(name);
  setTimeout(()=>{ Net.note=""; },6000);
});
document.getElementById("pauseBtn").addEventListener("click",()=>{
  if(Game.state===S.PLAY||Game.state===S.ROLLOUT||Game.state===S.TAKEOFF){Game.prePauseState=Game.state;Game.state=S.PAUSE;show("pauseOverlay");}
});
document.getElementById("resumeBtn").addEventListener("click",()=>{
  if(isPortrait()){checkOrient();return;}
  hideAll();Game.state=Game.prePauseState;
});
document.getElementById("recalBtn").addEventListener("click",()=>calibrate());

// ---------- shutting down ----------
// A page may only close itself when the browser opened it by script or it is
// running as an installed app. Rather than pretend, this shuts the flight down
// properly — engine off, out of fullscreen, orientation released, rendering
// stopped, logbook flushed — then asks to close and says so if it is refused.
async function exitGame(){
  Save.flush();
  stopLoop();
  Game.state=S.MENU; Game.attractOn=false; Game.readyT=0;
  setMuted(true);
  await suspendAudio();
  try{ if(document.fullscreenElement&&document.exitFullscreen) await document.exitFullscreen(); }catch(e){}
  try{ if(screen.orientation&&screen.orientation.unlock) screen.orientation.unlock(); }catch(e){}
  document.getElementById("uiBtns").style.display="none";
  const d=Save.data;
  document.getElementById("quitBest").innerHTML=
    d.bestScore?"Best <b>"+d.bestScore.toLocaleString()+"</b> &middot; sector <b>"+d.bestSector+"</b>":"";
  document.getElementById("quitNote").textContent="";
  show("quitOverlay");
  try{ window.close(); }catch(e){}
  setTimeout(()=>{
    if(!window.closed){
      document.getElementById("quitNote").textContent=
        "Your browser will not let a page close itself. The flight is shut down — "+
        "close the tab, or swipe the app away. Installed to your home screen, this button closes it.";
    }
  },350);
}
document.getElementById("exitBtn").addEventListener("click",exitGame);
document.getElementById("backBtn").addEventListener("click",()=>{
  setMuted(false);
  resumeAudio();
  startLoop();
  resetWorld();
  popups.length=0;
  Game.attractOn=true;
  Game.state=S.MENU;
  show("startOverlay");
  renderBoard();
  Net.load();
});
document.getElementById("muteBtn").addEventListener("click",()=>setMuted(!muted));
document.getElementById("fxBtn").addEventListener("click",()=>{
  Game.postOn=!Game.postOn;
  document.getElementById("fxBtn").style.opacity=Game.postOn?"1":"0.4";
});
document.addEventListener("visibilitychange",()=>{
  if(document.hidden&&(Game.state===S.PLAY||Game.state===S.ROLLOUT||Game.state===S.TAKEOFF)){
    Game.prePauseState=Game.state;Game.state=S.PAUSE;show("pauseOverlay");
  }
});
window.addEventListener("keydown",e=>{
  if(e.key==="Escape"||e.key==="p"){
    if(Game.state===S.PLAY||Game.state===S.ROLLOUT||Game.state===S.TAKEOFF){Game.prePauseState=Game.state;Game.state=S.PAUSE;show("pauseOverlay");}
    else if(Game.state===S.PAUSE){hideAll();Game.state=Game.prePauseState;}
  }
});

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
resetWorld();
popups.length=0;
Game.attractOn=true;
renderBoard();            // show the logbook bests on the title card
Net.load();               // and the world leader, if the board is reachable

// ---------- test hook: drives the game from a headless browser ----------
window.SKY={
  P,G,af,Rings,Fuel,Haz,Terrain,
  state:()=>Game.state,
  // start on the strip, ready to roll
  takeoff(){ resetWorld(); Game.attractOn=false; hideAll();
             document.getElementById("uiBtns").style.display="flex";
             Game.state=S.TAKEOFF; Game.readyT=0; },
  // start on the strip and fly her off, so tests begin airborne
  play(){ this.takeoff();
          for(let i=0;i<1200&&Game.state===S.TAKEOFF;i++) updateTakeoff(0.033);
          return Game.state===S.PLAY; },
  approach(){ this.play(); G.levelEnd=P.dist+1400; },
  // headless: advance the simulation without waiting on frames
  step(n,dt){
    dt=dt||0.033;
    for(let i=0;i<n;i++){
      if(Game.state===S.PLAY&&Game.readyT<=0) update(dt,performance.now());
      else if(Game.state===S.ROLLOUT) updateRollout(dt);
      else if(Game.state===S.TAKEOFF&&Game.readyT<=0) updateTakeoff(dt);
      else if(Game.state===S.DYING) updateDying(dt);
      else break;
    }
    return {state: Game.state,z:Math.round(P.z),y:Math.round(P.y),dist:Math.round(P.dist),
            score:Math.floor(G.score),rings:G.ringsHit+"/"+G.rings,fuel:Math.round(G.fuel),
            lives:P.lives,label:G.landLabel,afPhase:af.phase};
  },
  aimAt(x,y){ P.x=x; P.y=y; },
  hold(on){ Game.simHold=!!on; },
  Save,
  courseX:z=>coursePathX(z),
  groundAt:(x,z)=>groundH(x,z),
  drawHUD:t=>drawHUD(t),
  setMuted(m){ setMuted(m); },
  fx(on){ Game.postOn=on; }
};

// ---------- PWA manifest (inline) ----------
(function(){
  const manifest={name:"Skylark Run",short_name:"SkylarkRun",
    display:"fullscreen",orientation:"landscape",
    background_color:"#7fb6e0",theme_color:"#7fb6e0",start_url:".",
    icons:[
      {src:"/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
      {src:"/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"}
    ]};
  const link=document.createElement("link");
  link.rel="manifest";
  link.href="data:application/manifest+json,"+encodeURIComponent(JSON.stringify(manifest));
  document.head.appendChild(link);
})();

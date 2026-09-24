// Skylark Run — the countryside.
//
// The world the plane flies over: the height field and its tiles, woodland and
// hedgerow scatter, the ring course, fuel balloons, the hazards that bite, and
// the airfield that ends every sector.
//
// Damage is imported rather than raised as an event: a collision here calls
// crash() directly. The two modules import each other, which ES modules allow
// because neither touches the other at evaluation time — only inside handlers.
import * as THREE from 'three';
import { SUNDIR, Sun } from '../sun.js';
import { crash, birdStrike } from '../damage.js';
import { applyWeather } from '../weather.js';
import { clamp, hash, hash2, lerp, lineGeo, mulberry32, shade, smooth, vnoise } from '../util.js';
import { scene, renderer } from '../view.js';
import { CANOPY_H, PR, VIEW } from './config.js';
import { SHADOW, TODS, Sky } from './sky.js';
import { Models } from './models.js';
import { THEMES, TH, setTerrainTheme, af, baseH, groundH, landuse, isWood, onField, clearanceH,
         CELL, KIND, CROP, cellPlan, Terrain } from './terrain.js';
import { G, Game, P, S, TO, popup } from '../state.js';
import { chime, radioCall, thud } from '../audio.js';

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
  t.colorSpace=THREE.SRGBColorSpace;
  return t;
}
const ridges=[];
function addRidge(tex,dist,h,alpha,fac){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(dist*5.0,h),
    new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:alpha,
      depthWrite:false}));
  m.renderOrder=-1;
  m.userData={dist,h,fac};
  scene.add(m); ridges.push(m);
  return m;
}
// Painted in the hills' own colour; the atmosphere, not the paint, is what
// turns them blue with distance.
addRidge(makeRidgeTexture(21,"#5d7488",true), 3600, 620, 1.0, 0.90);
addRidge(makeRidgeTexture(77,"#4f6a58",false),2700, 430, 1.0, 0.85);


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
const SCX=17, SCZ=26;
const Scatter={
  cx:1e9, cz:1e9,
  m:{}, n:{}, plan:{},
  // instances per kind, near the aircraft and beyond it
  caps:{oak0:[420,700],oak1:[420,700],poplar:[140,200],pine0:[360,560],pine1:[360,560],
        hedge:[1800,3800],cottage:[30,70],farmhouse:[30,70],barn:[40,90],redBarn:[40,90],
        shed:[30,80],rock:[120,220],hay:[160,220]},
  shadeCap:2400,
  near:{x0:0,x1:0,z0:0,z1:0},
  dummy:new THREE.Object3D(), col:new THREE.Color(),
  // Every kind is two instanced meshes: `near`, inside the sun's shadow box,
  // at full detail and casting shadows, and `far`, cheaper and not casting.
  build(){
    const mat=new THREE.MeshLambertMaterial({vertexColors:true});
    const mk=(key,geo,material,cap,shadow)=>{
      const m=new THREE.InstancedMesh(geo,material,cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // created up front so the shader is built with per-instance colour
      m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3).fill(1),3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled=false;
      m.castShadow=shadow; m.receiveShadow=true;
      m.count=0;
      scene.add(m); this.m[key]=m; this.n[key]=0; return m;
    };
    for(const k in this.caps){
      mk(k,Models[k].near,mat,this.caps[k][0],true);
      mk(k+"~",Models[k].far,mat,this.caps[k][1],false);
    }
    const shadeGeo=new THREE.PlaneGeometry(1,1); shadeGeo.rotateX(-Math.PI/2);
    mk("shade",shadeGeo,new THREE.MeshBasicMaterial({map:shadowTex,transparent:true,
      opacity:0.30,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,
      polygonOffsetUnits:-4}),this.shadeCap,false);
    this.m.shade.receiveShadow=false;
    this.m.shade.renderOrder=1;
  },
  // Contact shade: the dark ground right under a thing, where skylight cannot
  // reach. The sun's own shadow comes from the shadow map; this is ambient.
  shade(x,z,y,r){
    this.put("shade",x,y+0.35,z,r*2,1,r*2);
  },
  put(key,x,y,z,sx,sy,sz,ry,color){
    if(af.active&&onField(x,z)) return;      // keep the airfield mown and clear
    if(key!=="shade"){
      const nb=this.near;
      if(!(x>nb.x0&&x<nb.x1&&z>nb.z0&&z<nb.z1)) key+="~";
    }
    const m=this.m[key], i=this.n[key];
    if(i>=m.instanceMatrix.count) return;
    const d=this.dummy;
    d.position.set(x,y,z);
    d.rotation.set(0,ry||0,0);
    d.scale.set(sx,sy,sz);
    d.updateMatrix();
    m.setMatrixAt(i,d.matrix);
    this.col.setHex(color===undefined?0xffffff:color);
    m.setColorAt(i,this.col);
    this.n[key]=i+1;
  },
  // Which tree grows here: the uplands run to pine, the lowlands to oak.
  tree(x,z,r,hedgerow){
    const y=groundH(x,z);
    if(y<TH.water+1) return;
    const upland=Game.curTheme===1, k=r();
    let key;
    if(hedgerow) key=k<0.22?"poplar":(k<0.61?"oak0":"oak1");
    else if(upland) key=k<0.62?(k<0.31?"pine0":"pine1"):(k<0.81?"oak0":"oak1");
    else key=k<0.12?(k<0.06?"pine0":"pine1"):(k<0.56?"oak0":"oak1");
    const s=0.78+r()*0.55;
    const tints=[0xffffff,0xecf4dc,0xfff6dc,0xe0ece0,0xf6fae6,0xd8e6d0];
    this.put(key,x,y-0.3,z,s,s*(0.9+r()*0.25),s,r()*6.3,tints[(r()*tints.length)|0]);
    this.shade(x,z,y,3.6*s);
  },
  // One cell of countryside, dressed from its plan. The plan (terrain.js)
  // decides what the field is and where its hedges and gate are — the ground
  // shader paints from the same plan — and a second random stream, seeded
  // from the cell, decides where individual things stand.
  cell(gx,gz){
    const p=cellPlan(gx,gz,this.plan);
    const r=mulberry32((((gx*83492791)^(gz*2971215073))+0x5bd1e995)|0);
    const bx=gx*CELL, bz=gz*CELL;
    if(onField(bx+CELL*0.5,bz+CELL*0.5)) return;
    // woodland: trees wherever the land-use field is over the line, so the
    // canopy edge is the same organic line the ground and the collision use
    if(p.lu>TH.wood-0.06){
      const n=p.kind===KIND.WOOD?9:5;
      for(let i=0;i<n;i++){
        const x=bx+r()*CELL, z=bz+r()*CELL;
        if(isWood(x,z)) this.tree(x,z,r);
      }
      if(p.kind===KIND.WOOD) return;
    }
    if(p.hedgeN) this.hedge(bx,bz,1,0,p.gate,r);
    if(p.hedgeW) this.hedge(bx,bz,0,1,p.gate,r);
    if(p.kind===KIND.ARABLE){
      // bales only lie in a field that has been cut
      if((p.variant===CROP.STUBBLE||p.variant===CROP.BARLEY)&&r()<0.55){
        const n=3+Math.floor(r()*5), ry=p.angle;
        for(let i=0;i<n;i++){
          const x=bx+14+r()*67, z=bz+14+r()*67, y=groundH(x,z);
          if(y>TH.water+1) this.put("hay",x,y+0.75,z,1.4,0.8,0.8,ry+(r()-0.5)*0.4);
        }
      }
      if(r()<0.12) this.farmstead(bx+30+r()*35, bz+30+r()*35, r);
      if(r()<0.18) this.hedgerowTree(bx,bz,p,r);
    }else{                                              // pasture: parkland trees and stone
      if(r()<0.55) this.tree(bx+8+r()*(CELL-16), bz+8+r()*(CELL-16), r);
      if(r()<0.35) this.hedgerowTree(bx,bz,p,r);
      if(r()<0.25){
        const x=bx+r()*CELL, z=bz+r()*CELL, y=groundH(x,z);
        if(y>TH.water+1){
          const s=1.2+r()*3.2;
          this.put("rock",x,y+s*0.25,z,s,s*0.7,s*1.1,r()*3, r()<0.5?0xffffff:0xe8e2d8);
        }
      }
      if(r()<0.07) this.farmstead(bx+30+r()*35, bz+30+r()*35, r);
    }
  },
  // A hedge along one edge of a cell, from its corner in direction (dx, dz),
  // in two runs either side of the gate the plan puts in it.
  hedge(bx,bz,dx,dz,gate,r){
    const g0=gate*CELL-4.5, g1=gate*CELL+4.5;
    for(const [t0,t1] of [[0,g0],[g1,CELL]]){
      const n=Math.max(1,Math.round((t1-t0)/9));
      const L=(t1-t0)/n;
      for(let i=0;i<n;i++){
        const t=t0+i*L;
        const y=Math.min(groundH(bx+dx*t,bz+dz*t),groundH(bx+dx*(t+L),bz+dz*(t+L)));
        if(y<TH.water+1) continue;
        const tint=[0xffffff,0xeef4e2,0xf6f2dc][(r()*3)|0];
        this.put("hedge",bx+dx*t,y-0.2,bz+dz*t,L,2.3+r()*0.9,2.4+r()*0.5,dz?-Math.PI/2:0,tint);
      }
    }
  },
  // an oak or a poplar left standing in a hedge line
  hedgerowTree(bx,bz,p,r){
    const t=(0.1+r()*0.8)*CELL;
    if(p.hedgeN&&(r()<0.5||!p.hedgeW)) this.tree(bx+t,bz,r,true);
    else if(p.hedgeW) this.tree(bx,bz+t,r,true);
  },
  // A farmyard: the house, then barns and sheds squared round it.
  farmstead(x,z,r){
    const y=groundH(x,z);
    if(y<TH.water+2) return;
    const face=(r()<0.5?0:Math.PI/2)+(r()-0.5)*0.12;
    const cx=Math.cos(face), sz=Math.sin(face);
    const place=(key,ox,oz,turn)=>{
      const px=x+ox*cx+oz*sz;
      const pz=z-ox*sz+oz*cx;
      const py=groundH(px,pz);
      if(py<TH.water+2) return;
      const k=0.92+r()*0.16;
      this.put(key,px,py-0.25,pz,k,k,k,face+(turn||0),[0xffffff,0xf4f0e8,0xece8e0][(r()*3)|0]);
      this.shade(px,pz,py,9*k);
    };
    place(r()<0.55?"cottage":"farmhouse",0,0);
    place(r()<0.6?"barn":"redBarn",-4,-19,0);
    if(r()<0.7) place("shed",14,-8,Math.PI/2);
    if(r()<0.4) place(r()<0.5?"barn":"redBarn",18,-26,Math.PI/2);
  },
  rebuild(){
    for(const k in this.m) this.n[k]=0;
    // the near set covers the shadow box (sky.js) plus a cell of slack, since
    // the box slides with the aircraft between rebuilds
    const nb=this.near;
    const half=SHADOW.SIZE/2+CELL, zc=P.z-SHADOW.AHEAD;
    nb.x0=P.x-half; nb.x1=P.x+half;
    nb.z0=zc-half; nb.z1=zc+half;
    const gx0=Math.floor(P.x/CELL)-((SCX-1)>>1);
    const gz0=Math.floor(P.z/CELL)-(SCZ-3);
    for(let i=0;i<SCX;i++)
      for(let j=0;j<SCZ;j++)
        this.cell(gx0+i, gz0+j);
    // draw only the instances this rebuild placed
    for(const k in this.m){
      const mesh=this.m[k];
      mesh.count=this.n[k];
      mesh.instanceMatrix.needsUpdate=true;
      mesh.instanceColor.needsUpdate=true;
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
  t.colorSpace=THREE.SRGBColorSpace;
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
  t.colorSpace=THREE.SRGBColorSpace;
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
  t.colorSpace=THREE.SRGBColorSpace;
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
    t.colorSpace=THREE.SRGBColorSpace;
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
  t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=4;
  return t;
}
const Airfield={
  build(){
    const g=new THREE.Group();
    // no apron mesh: the ground shader mows the field inside af's footprint
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
  setTerrainTheme(Game.curTheme);
  Game.curTod=(lvl-1)%TODS.length;
  const td=TODS[Game.curTod];
  SUNDIR.set(td.dir[0],td.dir[1],td.dir[2]).normalize();
  Sky.apply(td);
  renderer.toneMappingExposure=td.exp;
  Sun.ray=td.ray;
  Shadows.sun();
  applyWeather(lvl);
}

export { applyTheme, Airfield, Fuel, Haz, Rings, Scatter, Shadows, TH, THEMES, Terrain, af, burst, bursts, clearanceH, coursePathX, groundH, isWood, onField, ridges, updateBursts };

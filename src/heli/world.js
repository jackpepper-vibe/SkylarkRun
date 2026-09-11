// Rotor — the city.
//
// Ported from Rotor Run. Everything the helicopter flies through: the avenue
// grid and its pooled buildings, facades with lit windows, neon, rooftop
// clutter, streetlights, trees, the fairground and the coastline, the blimp
// and the traffic, the pickups and the aerial hazards, and the helipad that
// ends every sector.
//
// The original was a single file with its own engine; the shared parts —
// renderer, post, input, audio, the logbook — now come from Skylark's modules,
// and the mutable scalars it kept as bare bindings live on Game.
/* global THREE */
import { applyWeather } from '../weather.js';
import { hash, mulberry32, clamp, lerp } from '../util.js';
import { S, Game, P, G, popup, popups } from '../state.js';
import { scene, renderer, camera, W, H } from '../view.js';
import { chime, thunder } from '../audio.js';
import { crash, cracks } from '../damage.js';
import { FOGC, AV, AMBER, DANGER, LANES, STREETS, ROW_SPACING, VIEW,
         SPEED0, SPEED_MAX, SPEED_RAMP, MAX_VX, MAX_VY, MIN_Y, MAX_Y,
         LAT_CLAMP, PR } from './config.js';

// ---------- lights ----------
const hemiLight=new THREE.HemisphereLight(0x7a5aa0,0x2a1a22,0.85);
scene.add(hemiLight);
const sunLight=new THREE.DirectionalLight(0xffb37a,1.5);
sunLight.position.set(650,220,-1400);
scene.add(sunLight);
const fill=new THREE.DirectionalLight(0x4a5aa0,0.35);
fill.position.set(-500,300,600);
scene.add(fill);

// ---------- skydome (banks with the camera, unlike a CSS sky) ----------
function makeSkyTexture(tod){ // 0 dusk, 1 night, 2 midnight, 3 dawn
  const c=document.createElement("canvas"); c.width=1024; c.height=512;
  const x=c.getContext("2d");
  const stops=[
    [[0,"#120e33"],[0.30,"#1a1440"],[0.52,"#4a2b6b"],[0.66,"#c4542f"],[0.72,"#ffb35c"],[0.78,"#6e3040"],[1,"#120d1c"]],
    [[0,"#05060f"],[0.35,"#0a0d22"],[0.60,"#141a38"],[0.74,"#1e2547"],[0.80,"#141428"],[1,"#0a0812"]],
    [[0,"#020308"],[0.40,"#070a18"],[0.68,"#0e1226"],[0.78,"#0d0f1e"],[1,"#060510"]],
    [[0,"#1a2340"],[0.35,"#2c3a60"],[0.55,"#7a6a8a"],[0.68,"#e08a7a"],[0.74,"#ffd0a0"],[0.80,"#5a4050"],[1,"#161020"]],
  ][tod];
  const g=x.createLinearGradient(0,0,0,512);
  for(const s of stops)g.addColorStop(s[0],s[1]);
  x.fillStyle=g; x.fillRect(0,0,1024,512);
  const nightish=(tod===1||tod===2);
  const nStars=tod===0?120:(nightish?420:60);
  for(let i=0;i<nStars;i++){
    x.globalAlpha=(nightish?0.55:0.25)*hash(i*3+2+tod);
    x.fillStyle="#fff";
    x.fillRect(hash(i+tod*7)*1024, hash(i*7+1+tod)*(nightish?310:140), 1.4, 1.4);
  }
  x.globalAlpha=1;
  if(tod===0||tod===3){ // low sun
    const sx=tod===0?660:380, sy=356, col=tod===0?"#fff0c4":"#ffe8d0";
    const glow=x.createRadialGradient(sx,sy,2,sx,sy,150);
    glow.addColorStop(0,"#fff4cf"); glow.addColorStop(0.12,"#ffdf9e");
    glow.addColorStop(0.4,"#ffcf8766"); glow.addColorStop(1,"#ffcf8700");
    x.fillStyle=glow; x.beginPath(); x.arc(sx,sy,150,0,7); x.fill();
    x.fillStyle=col; x.beginPath(); x.arc(sx,sy,17,0,7); x.fill();
  }else{ // moon
    const mx=tod===1?700:520, my=tod===1?150:110, mr=tod===1?22:16;
    const glow=x.createRadialGradient(mx,my,2,mx,my,90);
    glow.addColorStop(0,"#cfd8ffcc"); glow.addColorStop(0.4,"#aab8ff33"); glow.addColorStop(1,"#aab8ff00");
    x.fillStyle=glow; x.beginPath(); x.arc(mx,my,90,0,7); x.fill();
    x.fillStyle="#e8ecf8"; x.beginPath(); x.arc(mx,my,mr,0,7); x.fill();
    x.fillStyle="#c8cede";
    for(let i=0;i<5;i++){
      x.beginPath();
      x.arc(mx+(hash(i*3)-0.5)*mr*1.3, my+(hash(i*7)-0.5)*mr*1.3, mr*0.14+hash(i)*mr*0.12, 0, 7);
      x.fill();
    }
  }
  const t=new THREE.CanvasTexture(c);
  t.encoding=THREE.sRGBEncoding;
  return t;
}
const skyTexs=[0,1,2,3].map(makeSkyTexture);
const sky=new THREE.Mesh(
  new THREE.SphereGeometry(4500,32,20),
  new THREE.MeshBasicMaterial({map:skyTexs[0],side:THREE.BackSide,fog:false,depthWrite:false})
);
sky.rotation.y=Math.PI*0.83;   // put the painted sun ahead-right
sky.renderOrder=-2;
scene.add(sky);

// ---------- distant skyline silhouettes (two parallax layers) ----------
function makeSkylineTexture(seed,alpha){
  const c=document.createElement("canvas"); c.width=1024; c.height=128;
  const x=c.getContext("2d");
  x.clearRect(0,0,1024,128);
  x.fillStyle=`rgba(42,26,60,${alpha})`;
  let px=0;
  while(px<1024){
    const w=30+hash(seed+px)*70, h=25+hash(seed*3+px)*95;
    x.fillRect(px,128-h,w,h);
    // a few lit windows
    x.fillStyle=`rgba(255,207,135,${alpha*0.5})`;
    for(let i=0;i<4;i++){
      if(hash(seed+px+i)<0.5)
        x.fillRect(px+4+hash(px+i)*w*0.8, 128-h+6+hash(px*2+i)*h*0.8, 2, 3);
    }
    x.fillStyle=`rgba(42,26,60,${alpha})`;
    px+=w+hash(seed+px*7)*24;
  }
  const t=new THREE.CanvasTexture(c);
  t.encoding=THREE.sRGBEncoding;
  return t;
}
function makeSkyline(seed,dist,h,alpha,fac){
  const m=new THREE.Mesh(
    new THREE.PlaneGeometry(dist*2.6,h),
    new THREE.MeshBasicMaterial({map:makeSkylineTexture(seed,1),transparent:true,
      opacity:alpha,fog:false,depthWrite:false})
  );
  m.renderOrder=-1;
  m.userData={dist,fac,h};
  scene.add(m);
  return m;
}
const skylines=[ makeSkyline(11,2100,340,0.55,0.94), makeSkyline(47,1700,260,0.8,0.9) ];

// ---------- ground ----------
function makeBlockTexture(){ // city-block ground with a proper cross street every 100 m
  const c=document.createElement("canvas"); c.width=256; c.height=256;
  const x=c.getContext("2d");
  x.fillStyle="#161020"; x.fillRect(0,0,256,256);
  for(let i=0;i<700;i++){
    x.fillStyle=`rgba(${34+hash(i)*26},${24+hash(i*3)*20},${44+hash(i*7)*24},0.5)`;
    x.fillRect(hash(i*13)*256,hash(i*17)*256,2,2);
  }
  // cross street: sidewalks, curbs, asphalt, centre dashes
  x.fillStyle="#2e2837"; x.fillRect(0,102,256,52);
  x.fillStyle="#4a4258"; x.fillRect(0,110,256,3); x.fillRect(0,143,256,3);
  x.fillStyle="#191322"; x.fillRect(0,113,256,30);
  x.fillStyle="rgba(230,220,240,0.6)";
  for(let px=6;px<256;px+=30) x.fillRect(px,126,14,3);
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(30,200);
  t.encoding=THREE.sRGBEncoding;
  return t;
}
const ground=new THREE.Mesh(
  new THREE.PlaneGeometry(3000,20000),
  new THREE.MeshLambertMaterial({map:makeBlockTexture()})
);
ground.rotation.x=-Math.PI/2;
scene.add(ground);

function makeRoadTexture(){ // one 30 m x 100 m avenue tile: sidewalks, curbs, lines
  const c=document.createElement("canvas"); c.width=256; c.height=256;
  const x=c.getContext("2d");
  x.fillStyle="#2e2837"; x.fillRect(0,0,256,256);                 // sidewalks
  x.strokeStyle="rgba(0,0,0,0.25)"; x.lineWidth=2;                // pavement joints
  for(let y=0;y<=256;y+=32){x.beginPath();x.moveTo(0,y);x.lineTo(256,y);x.stroke();}
  x.fillStyle="#4a4258"; x.fillRect(40,0,5,256); x.fillRect(211,0,5,256); // curbs
  x.fillStyle="#191322"; x.fillRect(45,0,166,256);                // asphalt
  for(let i=0;i<260;i++){
    x.fillStyle=`rgba(60,50,80,${(0.25+hash(i)*0.3).toFixed(2)})`;
    x.fillRect(45+hash(i*3)*166,hash(i*7)*256,2,2);
  }
  x.fillStyle="rgba(210,180,150,0.45)";                            // edge lines
  x.fillRect(55,0,3,256); x.fillRect(198,0,3,256);
  x.fillStyle="rgba(235,225,245,0.6)";                             // centre dashes
  for(let y=8;y<256;y+=36) x.fillRect(126,y,4,18);
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(1,200);
  t.encoding=THREE.sRGBEncoding;
  return t;
}
const roadStrips=(()=>{
  const g=new THREE.PlaneGeometry(1,1); g.rotateX(-Math.PI/2);
  const m=new THREE.InstancedMesh(g,
    new THREE.MeshLambertMaterial({map:makeRoadTexture()}),STREETS.length);
  const d=new THREE.Object3D();
  STREETS.forEach((sx,i)=>{
    d.position.set(sx,0.25,0); d.scale.set(30,1,20000); d.updateMatrix();
    m.setMatrixAt(i,d.matrix);
  });
  scene.add(m); return m;
})();
// wet-Game.weather look: shiny road material + light reflection streaks
const roadMatDry=roadStrips.material;
const roadMatWet=new THREE.MeshPhongMaterial({map:roadMatDry.map,
  color:0xbbbbcc,shininess:70,specular:0x9aa8c0});
const wetStreaks=(()=>{
  const arr=[];
  for(const sx of STREETS){
    for(let z=-10000;z<=10000;z+=50){
      arr.push(sx-13,0.5,z,    sx-13,0.5,z+22);
      arr.push(sx+13,0.5,z+25, sx+13,0.5,z+47);
    }
  }
  const m=new THREE.LineSegments(lineGeo(arr),
    new THREE.LineBasicMaterial({color:0xffcf87,transparent:true,opacity:0.35,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  m.visible=false; scene.add(m); return m;
})();
function rebaseGround(){
  const step=8000; // multiple of the 100m tile and 50m light spacing -> seamless
  const base=Math.round(P.z/step)*step;
  ground.position.z=base; roadStrips.position.z=base; streetLights.position.z=base;
  wetStreaks.position.z=base;
  trunkMesh.position.z=base; canopyMesh.position.z=base; sea.position.z=base;
  fillMesh.position.z=base; parkMesh.position.z=base;
  pondMesh.position.z=base; parkTreeMesh.position.z=base;
  for(const tl of tlAll){ tl.pg.position.z=base; tl.pr.position.z=base; }
}

// ---------- facade textures (diffuse + emissive lit windows) ----------
const FACADE_UNIT=24; // one texture tile covers 24m x 24m of wall
function makeFacade(seed,baseCol){
  const c=document.createElement("canvas"); c.width=256; c.height=256;
  const e=document.createElement("canvas"); e.width=256; e.height=256;
  const x=c.getContext("2d"), y=e.getContext("2d");
  const rng=mulberry32(seed);
  // wall with subtle vertical grade + grime streaks
  const g=x.createLinearGradient(0,0,0,256);
  g.addColorStop(0,baseCol); g.addColorStop(1,shade(baseCol,-0.25));
  x.fillStyle=g; x.fillRect(0,0,256,256);
  for(let i=0;i<24;i++){
    x.fillStyle=`rgba(0,0,0,${0.04+rng()*0.05})`;
    x.fillRect(rng()*256, 0, 1+rng()*3, 256);
  }
  y.fillStyle="#000"; y.fillRect(0,0,256,256);
  // 6 cols x 8 floors of windows per tile
  const cols=6, rows=8, cw=256/cols, ch=256/rows;
  for(let r=0;r<rows;r++)for(let cc=0;cc<cols;cc++){
    const wx=cc*cw+cw*0.24, wy=r*ch+ch*0.22, ww=cw*0.52, wh=ch*0.5;
    const lit=rng()<0.42;
    x.fillStyle=lit?"#c9a86a":"#3a3455";
    x.fillRect(wx,wy,ww,wh);
    x.strokeStyle="rgba(0,0,0,0.5)"; x.lineWidth=1; x.strokeRect(wx,wy,ww,wh);
    if(lit){
      const warm=rng();
      y.fillStyle=warm<0.7?"#ffbe6a":(warm<0.9?"#ffe1a8":"#a8d8ff");
      y.fillRect(wx,wy,ww,wh);
    }
  }
  // floor slab lines
  for(let r=0;r<=rows;r++){
    x.fillStyle="rgba(255,255,255,0.05)";
    x.fillRect(0,r*ch-1,256,2);
  }
  const map=new THREE.CanvasTexture(c), em=new THREE.CanvasTexture(e);
  map.wrapS=map.wrapT=em.wrapS=em.wrapT=THREE.RepeatWrapping;
  map.encoding=em.encoding=THREE.sRGBEncoding;
  return new THREE.MeshLambertMaterial({map,emissive:0xffffff,emissiveMap:em,emissiveIntensity:0.9});
}
function shade(hex,amt){
  const n=parseInt(hex.slice(1),16);
  let r=(n>>16)+255*amt, g=((n>>8)&255)+255*amt, b=(n&255)+255*amt;
  r=Math.max(0,Math.min(255,r)); g=Math.max(0,Math.min(255,g)); b=Math.max(0,Math.min(255,b));
  return "#"+((r<<16)|(g<<8)|b|0x1000000).toString(16).slice(1);
}
const BASE_COLS=["#2b3350","#384066","#333a5e","#2e2b52","#3d3560","#4a3050","#503a3a","#2f4058"];
const facadeMats=BASE_COLS.map((c,i)=>makeFacade(i*991+7,c));
const roofMat=new THREE.MeshLambertMaterial({color:0x454c78});

// ---------- neon signs ----------
function makeNeonTex(col,seed){
  const c=document.createElement("canvas"); c.width=128; c.height=64;
  const x=c.getContext("2d");
  x.clearRect(0,0,128,64);
  x.shadowColor=col; x.shadowBlur=10; x.fillStyle=col;
  const n=3+Math.floor(hash(seed)*3);
  for(let i=0;i<n;i++){
    const bw=(112/n)*0.6;
    x.fillRect(8+i*(112/n),14+hash(seed+i)*8,bw,30+hash(seed*3+i)*8);
  }
  const t=new THREE.CanvasTexture(c);
  t.encoding=THREE.sRGBEncoding;
  return t;
}
const signGeo=new THREE.PlaneGeometry(1,1);
const signMats=["#ff4fd8","#7ef0d0","#ffcf87","#6ab8ff"].map((c,i)=>
  new THREE.MeshBasicMaterial({map:makeNeonTex(c,i*37+5),transparent:true,side:THREE.DoubleSide}));

// ---------- rooftop clutter (water tanks, AC units) ----------
const CL_N=280;
const clutterMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
  new THREE.MeshLambertMaterial({color:0x39406a}),CL_N);
clutterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(clutterMesh);
const clFree=[], clDummy=new THREE.Object3D();
function clZero(i){
  clDummy.position.set(0,-60,0); clDummy.rotation.y=0;
  clDummy.scale.set(0.001,0.001,0.001); clDummy.updateMatrix();
  clutterMesh.setMatrixAt(i,clDummy.matrix);
}
for(let i=0;i<CL_N;i++){ clFree.push(i); clZero(i); }
clutterMesh.instanceMatrix.needsUpdate=true;
function clutterAdd(b,rng){
  const idx=[], n=1+Math.floor(rng()*3);
  for(let k=0;k<n&&clFree.length;k++){
    const i=clFree.pop(), s=3.5+rng()*6;
    clDummy.position.set(b.x+(rng()-0.5)*b.w*0.55, b.h+s*0.4, b.z+(rng()-0.5)*b.d*0.55);
    clDummy.scale.set(s,s*(0.6+rng()*0.8),s);
    clDummy.rotation.y=rng()*1.5;
    clDummy.updateMatrix();
    clutterMesh.setMatrixAt(i,clDummy.matrix);
    idx.push(i);
  }
  clutterMesh.instanceMatrix.needsUpdate=true;
  return idx;
}
function clutterFree(idx){
  for(const i of idx){ clZero(i); clFree.push(i); }
  clutterMesh.instanceMatrix.needsUpdate=true;
}

// ---------- side city sprawl (non-collidable set dressing, instanced) ----------
const SIDE_N=420;
const sideGeo=new THREE.BoxGeometry(1,1,1);
sideGeo.translate(0,0.5,0); // pivot at base
const sideMat=makeFacade(4242,"#332f56");
sideMat.map.repeat.set(2,4); sideMat.emissiveMap.repeat.set(2,4);
const sideMesh=new THREE.InstancedMesh(sideGeo,sideMat,SIDE_N);
sideMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(sideMesh);
const sideB=[], sDummy=new THREE.Object3D();
function placeSide(i,ahead){
  const side=curTheme===1?1:(Math.random()<0.5?-1:1); // coast: open water to the left
  const x=side*(430+Math.random()*950);
  const z=P.z-(ahead?VIEW*(0.25+Math.random()*0.8):Math.random()*VIEW);
  const w=40+Math.random()*75, d=40+Math.random()*75;
  const distF=Math.min(1,(Math.abs(x)-200)/900);
  const h=28+Math.random()*(110+160*distF); // taller toward the horizon
  sDummy.position.set(x,0,z);
  sDummy.scale.set(w,h,d);
  sDummy.rotation.y=0;
  sDummy.updateMatrix();
  sideMesh.setMatrixAt(i,sDummy.matrix);
  sideB[i]={z};
}
function initSideCity(){
  const col=new THREE.Color();
  for(let i=0;i<SIDE_N;i++){
    placeSide(i,false);
    if(sideMesh.setColorAt){
      col.set(BASE_COLS[i%BASE_COLS.length]).multiplyScalar(0.9+hash(i)*0.25);
      sideMesh.setColorAt(i,col);
    }
  }
  sideMesh.instanceMatrix.needsUpdate=true;
  if(sideMesh.instanceColor) sideMesh.instanceColor.needsUpdate=true;
}
function updateSideCity(){
  let dirty=false;
  for(let i=0;i<SIDE_N;i++){
    if(sideB[i].z>P.z+120){ placeSide(i,true); dirty=true; }
  }
  if(dirty) sideMesh.instanceMatrix.needsUpdate=true;
}

// ---------- streetlights (static world grid, rebased with ground) ----------
const streetLights=(()=>{
  const pos=[];
  for(const sx of STREETS){
    for(let z=-10000;z<=10000;z+=50){
      pos.push(sx-13,7,z, sx+13,7,z+25);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(pos),3));
  const m=new THREE.Points(g,new THREE.PointsMaterial({color:0xffb35c,size:2.4,
    sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  scene.add(m); return m;
})();

// ---------- avenue trees (instanced, static grid rebased with ground) ----------
const treePlace=[];
STREETS.forEach((sx,si)=>{
  for(const side of [-1,1]){
    for(let zi=0;zi<200;zi++){
      const key=(zi%80)*13+si*3+(side>0?1:0); // periodic over the 8000 m rebase step
      if(hash(key*1.7+2)<0.55) continue;
      treePlace.push({
        x:sx+side*11+(hash(key*3.1)-0.5)*4,
        z:-10000+zi*100+(hash(key*5.3)-0.5)*36,
        s:0.8+hash(key*7.9)*0.7
      });
    }
  }
});
const trunkMesh=new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.4,0.55,3.2,5),
  new THREE.MeshLambertMaterial({color:0x3a2b26}),treePlace.length);
const canopyMesh=new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(2.6,0),
  new THREE.MeshLambertMaterial({color:0xffffff}),treePlace.length);
{
  const td=new THREE.Object3D(), tc=new THREE.Color();
  const cols=[0x1f4038,0x2a4a35,0x24503f,0x2f3d4f];
  treePlace.forEach((p,i)=>{
    td.position.set(p.x,1.6*p.s,p.z); td.scale.set(p.s,p.s,p.s); td.updateMatrix();
    trunkMesh.setMatrixAt(i,td.matrix);
    td.position.set(p.x,5.4*p.s,p.z); td.scale.set(p.s,p.s*1.25,p.s); td.updateMatrix();
    canopyMesh.setMatrixAt(i,td.matrix);
    if(canopyMesh.setColorAt){tc.set(cols[i%4]);canopyMesh.setColorAt(i,tc);}
  });
  scene.add(trunkMesh); scene.add(canopyMesh);
}

// ---------- block infill: low-rise podiums, pocket parks, ponds ----------
const FILL_LANES=LANES.concat([-390,390]); // also fill the band before the side sprawl
const fillBoxes=[],parkPatches=[],parkTreesArr=[],ponds=[];
for(let li=0;li<FILL_LANES.length;li++){
  const lx=FILL_LANES[li];
  const edge=Math.abs(lx)>350;
  for(let zi=0;zi<200;zi++){
    const k=(zi%80)*17+li*5; // periodic over the 8000 m rebase step
    const r=hash(k*1.31+0.7);
    const cz=-10000+zi*100+50;
    const jx=(hash(k*2.7)-0.5)*8, jz=(hash(k*3.9)-0.5)*14;
    if(r<0.55){ // low-rise cluster
      const n=hash(k*5.1)<0.4?2:1;
      for(let b=0;b<n;b++){
        fillBoxes.push({
          x:lx+jx+(b?(hash(k*7.3)-0.5)*20:0),
          z:cz+jz+(b?(hash(k*8.7)-0.5)*34:0),
          w:(edge?34:24)+hash(k*9.1+b)*(edge?26:12),
          d:38+hash(k*10.3+b)*24,
          h:4.5+hash(k*11.7+b)*8,
          k:k+b
        });
      }
    }else if(r<0.75){ // pocket park
      parkPatches.push({x:lx+jx,z:cz+jz,sx:12+hash(k*6.1)*5.5,sz:20+hash(k*6.7)*16,k});
      const nt=3+Math.floor(hash(k*12.1)*3);
      for(let ti=0;ti<nt;ti++){
        parkTreesArr.push({
          x:lx+jx+(hash(k*13.3+ti)-0.5)*24,
          z:cz+jz+(hash(k*14.7+ti)-0.5)*40,
          s:1.6+hash(k*15.1+ti)*2.4, k:k+ti
        });
      }
      if(hash(k*16.3)<0.3) ponds.push({x:lx+jx+(hash(k*17)-0.5)*10,z:cz+jz+(hash(k*18)-0.5)*16,k});
    } // else: empty lot
  }
}
const fillMat=makeFacade(777,"#2a2440");
fillMat.map.repeat.set(1,0.5); fillMat.emissiveMap.repeat.set(1,0.5);
const fillGeoU=new THREE.BoxGeometry(1,1,1); fillGeoU.translate(0,0.5,0);
const fillMesh=new THREE.InstancedMesh(fillGeoU,fillMat,Math.max(1,fillBoxes.length));
{
  const d=new THREE.Object3D(), c=new THREE.Color();
  const cols=[0x2a2440,0x332a4a,0x3d2f3f,0x27303f];
  fillBoxes.forEach((b,i)=>{
    d.position.set(b.x,0,b.z); d.scale.set(b.w,b.h,b.d); d.updateMatrix();
    fillMesh.setMatrixAt(i,d.matrix);
    if(fillMesh.setColorAt){c.set(cols[b.k%4]).multiplyScalar(0.85+hash(b.k)*0.35);fillMesh.setColorAt(i,c);}
  });
  scene.add(fillMesh);
}
const patchGeo=new THREE.CircleGeometry(1,10); patchGeo.rotateX(-Math.PI/2);
const parkMesh=new THREE.InstancedMesh(patchGeo,
  new THREE.MeshLambertMaterial({color:0x16301f}),Math.max(1,parkPatches.length));
const pondMesh=new THREE.InstancedMesh(patchGeo,
  new THREE.MeshLambertMaterial({color:0x14283c}),Math.max(1,ponds.length));
const parkTreeMesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),
  new THREE.MeshLambertMaterial({color:0xffffff}),Math.max(1,parkTreesArr.length));
{
  const d=new THREE.Object3D(), c=new THREE.Color();
  parkPatches.forEach((p,i)=>{
    d.position.set(p.x,0.3,p.z); d.scale.set(p.sx,1,p.sz); d.updateMatrix();
    parkMesh.setMatrixAt(i,d.matrix);
  });
  ponds.forEach((p,i)=>{
    d.position.set(p.x,0.45,p.z); d.scale.set(5+hash(p.k)*4,1,7+hash(p.k*2)*5); d.updateMatrix();
    pondMesh.setMatrixAt(i,d.matrix);
  });
  const gcols=[0x1f4038,0x2a4a35,0x24503f];
  parkTreesArr.forEach((p,i)=>{
    d.position.set(p.x,p.s*1.1+0.3,p.z); d.scale.set(p.s,p.s*1.2,p.s); d.updateMatrix();
    parkTreeMesh.setMatrixAt(i,d.matrix);
    if(parkTreeMesh.setColorAt){c.set(gcols[p.k%3]);parkTreeMesh.setColorAt(i,c);}
  });
  scene.add(parkMesh); scene.add(pondMesh); scene.add(parkTreeMesh);
}

// ---------- living windows: lights switch on/off over time ----------
const emisTime={value:0};
function addWindowLife(mat){
  mat.onBeforeCompile=sh=>{
    sh.uniforms.uTime=emisTime;
    sh.fragmentShader=sh.fragmentShader
      .replace("#include <common>","#include <common>\nuniform float uTime;")
      .replace("#include <emissivemap_fragment>",
`#include <emissivemap_fragment>
{
  vec2 _cell=floor(vUv*vec2(6.0,8.0));
  float _n=fract(sin(dot(_cell,vec2(12.9898,78.233)))*43758.5453);
  float _slot=floor(uTime*0.06+_n*97.0);
  float _r=fract(sin(_slot*12.9898+_n*78.233)*43758.5453);
  totalEmissiveRadiance*=step(0.22,_r)*(0.75+0.5*_n);
}`);
  };
  mat.needsUpdate=true;
}
facadeMats.forEach(addWindowLife);
addWindowLife(sideMat);
addWindowLife(fillMat);

// ---------- mountain ridge backdrops ----------
function makeRidgeTexture(seed,col,snow){
  const c=document.createElement("canvas"); c.width=1024; c.height=256;
  const x=c.getContext("2d");
  x.clearRect(0,0,1024,256);
  let y=150;
  const pts=[[0,256],[0,y]];
  for(let px=0;px<=1024;px+=24){
    y+=Math.floor((hash(seed+px)-0.5)*46);
    y=Math.max(30,Math.min(210,y));
    pts.push([px,y]);
  }
  pts.push([1024,256]);
  x.fillStyle=col;
  x.beginPath();x.moveTo(pts[0][0],pts[0][1]);
  for(const p of pts) x.lineTo(p[0],p[1]);
  x.closePath();x.fill();
  if(snow){ // faint lit crests
    x.strokeStyle="rgba(255,207,160,0.35)";x.lineWidth=2;
    x.beginPath();
    for(let i=1;i<pts.length-1;i++){
      if(pts[i][1]<95){x.moveTo(pts[i][0]-8,pts[i][1]+5);x.lineTo(pts[i][0],pts[i][1]);x.lineTo(pts[i][0]+8,pts[i][1]+5);}
    }
    x.stroke();
  }
  const t=new THREE.CanvasTexture(c);
  t.encoding=THREE.sRGBEncoding;
  return t;
}
function addBackdrop(tex,dist,h,alpha,fac){
  const m=new THREE.Mesh(
    new THREE.PlaneGeometry(dist*2.6,h),
    new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:alpha,fog:false,depthWrite:false}));
  m.renderOrder=-1;
  m.userData={dist,fac,h};
  scene.add(m);
  skylines.push(m);
  return m;
}
addBackdrop(makeRidgeTexture(5,"#241a3a",true),3000,780,0.95,0.975);
addBackdrop(makeRidgeTexture(9,"#2d2148",false),2650,540,0.95,0.955);

// ---------- fairground: Ferris wheels + searchlights ----------
function lineGeo(arr){
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(arr),3));
  return g;
}
const sweepMat=new THREE.MeshBasicMaterial({color:0xffcf87,transparent:true,opacity:0.10,
  blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false});
function makeWheel(){
  const group=new THREE.Group();
  const spin=new THREE.Group();
  const wR=62;
  spin.add(new THREE.Mesh(new THREE.TorusGeometry(wR,2.2,8,40),
    new THREE.MeshLambertMaterial({color:0x2a2545})));
  const sp=[];
  for(let i=0;i<10;i++){const a=i/10*Math.PI*2;sp.push(0,0,0,Math.cos(a)*wR,Math.sin(a)*wR,0);}
  spin.add(new THREE.LineSegments(lineGeo(sp),
    new THREE.LineBasicMaterial({color:0x8a5a7a,transparent:true,opacity:0.85})));
  const cab=new THREE.InstancedMesh(new THREE.BoxGeometry(6,7,6),
    new THREE.MeshLambertMaterial({color:0x503a3a}),10);
  const d=new THREE.Object3D();
  for(let i=0;i<10;i++){
    const a=i/10*Math.PI*2;
    d.position.set(Math.cos(a)*wR,Math.sin(a)*wR,0);
    d.updateMatrix();cab.setMatrixAt(i,d.matrix);
  }
  spin.add(cab);
  const lights=[];
  ["#ff4fd8","#7ef0d0","#ffcf87"].forEach((col,gi)=>{
    const arr=[];
    for(let i=gi;i<36;i+=3){const a=i/36*Math.PI*2;arr.push(Math.cos(a)*wR,Math.sin(a)*wR,3);}
    const p=new THREE.Points(lineGeo(arr),
      new THREE.PointsMaterial({color:col,size:4,sizeAttenuation:true,
        blending:THREE.AdditiveBlending,depthWrite:false}));
    spin.add(p); lights.push(p);
  });
  spin.position.y=wR+14;
  group.add(spin);
  for(const s of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(1.8,2.6,wR+16,6),
      new THREE.MeshLambertMaterial({color:0x23202c}));
    leg.position.set(s*16,(wR+14)/2,0); leg.rotation.z=s*0.22;
    group.add(leg);
  }
  const sweeps=[];
  for(let i=0;i<2;i++){
    const g2=new THREE.PlaneGeometry(9,900); g2.translate(0,450,0);
    const m=new THREE.Mesh(g2,sweepMat);
    m.position.y=6; group.add(m); sweeps.push(m);
  }
  scene.add(group);
  return {group,spin,lights,sweeps};
}
const wheels=[makeWheel(),makeWheel()];
wheels[1].group.visible=false;

// ---------- coastline: sea, moon-streak, promenade + boat lights ----------
const sea=new THREE.Group();
{
  const p=new THREE.Mesh(new THREE.PlaneGeometry(2600,20000),
    new THREE.MeshLambertMaterial({color:0x14283c}));
  p.rotation.x=-Math.PI/2; p.position.set(-1700,0.45,0); sea.add(p);
  const streak=new THREE.Mesh(new THREE.PlaneGeometry(90,2400),
    new THREE.MeshBasicMaterial({color:0xffcf87,transparent:true,opacity:0.07,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  streak.rotation.x=-Math.PI/2; streak.position.set(-950,0.6,0); sea.add(streak);
  const arr=[];
  for(let z=-10000;z<=10000;z+=80) arr.push(-412,4,z); // promenade lights
  for(let zi=0;zi<200;zi++){                            // boats (periodic over rebase step)
    const k=zi%80;
    if(hash(k*3.7+1)<0.72) continue;
    arr.push(-520-hash(k*7.1)*1800, 2.2, -10000+zi*100+hash(k*9.3)*70);
  }
  sea.add(new THREE.Points(lineGeo(arr),
    new THREE.PointsMaterial({color:0xffd9a0,size:2.6,sizeAttenuation:true,
      blending:THREE.AdditiveBlending,depthWrite:false})));
}
sea.visible=false;
scene.add(sea);

// ---------- sector themes ----------
const THEME_NAMES=["DOWNTOWN","COASTLINE","FAIRGROUND"];
let curTheme=0, SIGN_P=0.35;
function applyTheme(lvl){
  curTheme=(lvl-1)%3;
  sea.visible=(curTheme===1);
  wheels[1].group.visible=(curTheme===2);
  SIGN_P=curTheme===2?0.70:0.35;
  applyTod(lvl);
  wheels.forEach((w,wi)=>{
    const side=curTheme===1?1:(wi%2?-1:1); // coast: fair stays on the land side
    w.group.position.set(side*(600+wi*140),0,P.z-1500-wi*900);
  });
  applyWeather(lvl);
}

// ---------- blimp ----------
const blimp=new THREE.Group();
{
  const body=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),
    new THREE.MeshLambertMaterial({color:0x2a2545}));
  body.scale.set(15,11,36); blimp.add(body);
  const gon=new THREE.Mesh(new THREE.BoxGeometry(4,3,10),
    new THREE.MeshLambertMaterial({color:0x181522}));
  gon.position.y=-11.5; blimp.add(gon);
  const win=new THREE.Mesh(new THREE.PlaneGeometry(8,1.4),
    new THREE.MeshBasicMaterial({color:0xffcf87}));
  win.position.set(2.2,-11.5,0); win.rotation.y=Math.PI/2; blimp.add(win);
  for(const s of [[0,10,-32,1,4,8],[0,-4,-34,1,7,8]]){
    const f=new THREE.Mesh(new THREE.BoxGeometry(s[3],s[4],s[5]),
      new THREE.MeshLambertMaterial({color:0x23202c}));
    f.position.set(s[0],s[1],s[2]); blimp.add(f);
  }
}
const blimpBeacon=new THREE.Sprite(new THREE.SpriteMaterial({
  color:0xff5a4e,blending:THREE.AdditiveBlending,depthWrite:false}));
blimpBeacon.scale.set(8,8,1); blimpBeacon.position.y=14;
blimp.add(blimpBeacon);
blimp.position.set(150,330,-1500);
scene.add(blimp);

// ---------- city life: vents, billboards, airliner, birds, traffic lights ----------
const lifeGlowTex=(()=>{
  const c=document.createElement("canvas"); c.width=64; c.height=64;
  const x=c.getContext("2d");
  const g=x.createRadialGradient(32,32,2,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)"); g.addColorStop(0.4,"rgba(255,255,255,0.3)");
  g.addColorStop(1,"rgba(255,255,255,0)");
  x.fillStyle=g; x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
})();
// rooftop steam vents
const vents=[];
for(let i=0;i<8;i++){
  const puffs=[];
  for(let k=0;k<5;k++){
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:lifeGlowTex,
      color:0xbfc4d8,transparent:true,opacity:0,depthWrite:false}));
    scene.add(sp); puffs.push({sp,ph:Math.random()});
  }
  vents.push({x:0,y:0,z:1e9,puffs});
}
// scrolling rooftop billboards
function makeBillboardTex(txt,col){
  const c=document.createElement("canvas"); c.width=512; c.height=128;
  const x=c.getContext("2d");
  x.fillStyle="#0d0b12"; x.fillRect(0,0,512,128);
  x.font="800 82px ui-monospace,Menlo,monospace";
  x.textBaseline="middle"; x.textAlign="left";
  x.shadowColor=col; x.shadowBlur=18; x.fillStyle=col;
  x.fillText(txt,18,68);
  const t=new THREE.CanvasTexture(c);
  t.wrapS=THREE.RepeatWrapping; t.encoding=THREE.sRGBEncoding;
  return t;
}
const billboards=[];
[["ROTOR RUN \u2726 ","#ff4fd8"],["DUSK AIR TAXI \u2726 ","#7ef0d0"],["NEON NOODLES \u2726 ","#ffcf87"]]
.forEach(([txt,col])=>{
  const g=new THREE.Group();
  const tex=makeBillboardTex(txt,col);
  const back=new THREE.Mesh(new THREE.BoxGeometry(31,9,1),
    new THREE.MeshLambertMaterial({color:0x181410}));
  back.position.set(0,9,-0.7); g.add(back);
  const pane=new THREE.Mesh(new THREE.PlaneGeometry(30,8),
    new THREE.MeshBasicMaterial({map:tex}));
  pane.position.y=9; g.add(pane);
  for(const lx of [-11,11]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,5,6),
      new THREE.MeshLambertMaterial({color:0x2a2521}));
    leg.position.set(lx,2.5,-0.4); g.add(leg);
  }
  g.visible=false; scene.add(g);
  billboards.push({g,tex,z:1e9});
});
// high airliner with contrail
const airliner=new THREE.Group();
{
  const body=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),
    new THREE.MeshLambertMaterial({color:0xaab4c8}));
  body.scale.set(14,3,3); airliner.add(body);
  const wing=new THREE.Mesh(new THREE.BoxGeometry(4,0.5,26),
    new THREE.MeshLambertMaterial({color:0x8a94a8}));
  airliner.add(wing);
  const trailG=new THREE.PlaneGeometry(420,4); trailG.translate(-224,0,0); trailG.rotateX(-Math.PI/2);
  const trail=new THREE.Mesh(trailG,
    new THREE.MeshBasicMaterial({color:0xdde4f0,transparent:true,opacity:0.13,
      side:THREE.DoubleSide,depthWrite:false}));
  airliner.add(trail);
  const bl=new THREE.Sprite(new THREE.SpriteMaterial({color:0xff5a4e,
    blending:THREE.AdditiveBlending,depthWrite:false}));
  bl.scale.set(6,6,1); bl.position.y=2; airliner.add(bl);
  airliner.userData.beacon=bl;
  airliner.position.set(-1700,430,-1500);
  scene.add(airliner);
}
// bird flock
const flock=new THREE.Group();
const flockOffsets=[[0,0],[-6,-4],[6,-4],[-12,-8],[12,-8],[-18,-12],[18,-12],[-24,-16],[24,-16]];
const flockSprites=flockOffsets.map(o=>{
  const s=new THREE.Sprite(new THREE.SpriteMaterial({color:0x120e1a,transparent:true,opacity:0.9}));
  s.scale.set(2.4,1.6,1); s.position.set(o[0],0,o[1]); flock.add(s); return s;
});
flock.position.set(0,80,1e9);
scene.add(flock);
// traffic lights (three phase groups, static periodic grid)
const tlAll=[];
for(let gph=0;gph<3;gph++){
  const posG=[];
  for(let si=0;si<STREETS.length;si++){
    for(let zi=0;zi<200;zi++){
      if((si+zi)%3!==gph) continue;
      const zc=-10000+zi*100+50;
      posG.push(STREETS[si]-11,6.2,zc-3, STREETS[si]+11,6.2,zc+3);
    }
  }
  const pg=new THREE.Points(lineGeo(posG),new THREE.PointsMaterial({color:0x39d98a,
    size:2,sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  const pr=new THREE.Points(lineGeo(posG.slice()),new THREE.PointsMaterial({color:0xff5a4e,
    size:2,sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  pr.visible=false;
  scene.add(pg); scene.add(pr);
  tlAll.push({pg,pr,gph});
}
function updateCityLife(dt){
  const now=performance.now();
  for(const v of vents){ // relocate onto tall roofs ahead, animate puffs
    if(v.z>P.z+50){
      for(let tries=0;tries<6;tries++){
        const b=activeB[Math.floor(Math.random()*activeB.length)];
        if(b&&b.h>90&&b.z<P.z-600&&b.z>P.z-2300){
          v.x=b.x+(Math.random()-0.5)*b.w*0.4;
          v.y=b.h; v.z=b.z; break;
        }
      }
      if(v.z>P.z+50) v.z=P.z-1500;
    }
    for(const p of v.puffs){
      const k=(now*0.00045+p.ph)%1;
      p.sp.position.set(v.x+Math.sin(k*9+p.ph*7)*2, v.y+2+k*26, v.z);
      const s=8+k*20; p.sp.scale.set(s,s,1);
      p.sp.material.opacity=(k<0.08?k/0.08:1)*(1-k)*0.26;
    }
  }
  for(const bb of billboards){
    if(bb.z>P.z+60){
      for(let tries=0;tries<6;tries++){
        const b=activeB[Math.floor(Math.random()*activeB.length)];
        if(b&&b.h>95&&b.h<230&&b.z<P.z-700&&b.z>P.z-2200){
          bb.g.position.set(b.x,b.h,b.z);
          bb.z=b.z; bb.g.visible=true; break;
        }
      }
    }
    bb.tex.offset.x-=dt*0.12;
  }
  airliner.position.x+=90*dt;
  airliner.userData.beacon.material.opacity=Math.floor(now/400)%2===0?1:0.1;
  if(airliner.position.x>1750||airliner.position.z>P.z+150){
    airliner.position.set(-1750,380+Math.random()*130,P.z-1200-Math.random()*900);
  }
  flock.position.x+=7*dt;
  flockSprites.forEach((s,i)=>{ s.scale.y=1.6*(0.6+0.4*Math.sin(now*0.02+i*1.7)); });
  if(flock.position.z>P.z+60||flock.position.x>420){
    flock.position.set(-300+Math.random()*300,55+Math.random()*80,P.z-1600-Math.random()*700);
  }
  for(const tl of tlAll){
    const green=Math.floor(now/4200+tl.gph*0.67)%2===0;
    tl.pg.visible=green; tl.pr.visible=!green;
  }
}

function updateScenery(dt){
  const now=performance.now();
  wheels.forEach((w,wi)=>{
    if(!w.group.visible) return;
    w.spin.rotation.z+=dt*0.18;
    const gl=Math.floor(now/400+wi)%3;
    w.lights.forEach((p,i)=>p.visible=(i===gl));
    w.sweeps[0].rotation.z=Math.sin(now*0.00042+wi)*0.55+0.20;
    w.sweeps[1].rotation.z=Math.sin(now*0.00042+2.1+wi)*0.55-0.20;
    if(w.group.position.z>P.z+250){
      const gap=curTheme===2?1100+Math.random()*900:3000+Math.random()*1600;
      w.group.position.z=P.z-gap-wi*600;
      const side=curTheme===1?1:(Math.random()<0.5?-1:1);
      w.group.position.x=side*(560+Math.random()*240);
    }
  });
  blimp.position.z+=dt*4;
  blimpBeacon.material.opacity=Math.floor(now/500)%2===0?1:0.1;
  if(blimp.position.z>P.z+180){
    blimp.position.set((Math.random()-0.5)*700,300+Math.random()*80,P.z-2600);
  }
}

// ---------- sun haze sprite ----------
const sunGlow=(()=>{
  const c=document.createElement("canvas"); c.width=128; c.height=128;
  const x=c.getContext("2d");
  const g=x.createRadialGradient(64,64,2,64,64,64);
  g.addColorStop(0,"rgba(255,240,200,0.9)"); g.addColorStop(0.3,"rgba(255,207,135,0.35)");
  g.addColorStop(1,"rgba(255,207,135,0)");
  x.fillStyle=g; x.fillRect(0,0,128,128);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),
    blending:THREE.AdditiveBlending,depthWrite:false,fog:false,opacity:0.6}));
  sp.scale.set(1500,1500,1);
  scene.add(sp); return sp;
})();
const SUNDIR=new THREE.Vector3(0.42,0.11,-0.90).normalize();

// ---------- time-of-day: sector cycle dusk -> night -> midnight -> dawn ----------
const TODS=[
 {name:"DUSK",    fog:0xc46a52, sunC:0xffb37a, sunI:1.5,  hemiS:0x7a5aa0, hemiG:0x2a1a22, hemiI:0.85, exp:1.05, dir:[0.42,0.11,-0.90],  glowC:0xfff0c4, glowO:0.60, ray:0.9,  env:["#2a2050","#e08a52","#1a1422"]},
 {name:"NIGHT",   fog:0x232a44, sunC:0x8ab0ff, sunI:0.55, hemiS:0x2a3560, hemiG:0x101018, hemiI:0.55, exp:0.95, dir:[-0.30,0.40,-0.87], glowC:0xcfd8ff, glowO:0.35, ray:0.45, env:["#0a0d22","#1e2547","#0a0812"]},
 {name:"MIDNIGHT",fog:0x161a30, sunC:0x7a9aff, sunI:0.45, hemiS:0x1c2545, hemiG:0x0c0c14, hemiI:0.45, exp:0.92, dir:[-0.15,0.55,-0.82], glowC:0xbcc8ff, glowO:0.25, ray:0.35, env:["#070a18","#0e1226","#060510"]},
 {name:"DAWN",    fog:0xd09a8a, sunC:0xffd0a0, sunI:1.2,  hemiS:0x8a7aa0, hemiG:0x2a2030, hemiI:0.80, exp:1.05, dir:[-0.45,0.10,-0.88], glowC:0xffe8d0, glowO:0.55, ray:0.85, env:["#2c3a60","#ffd0a0","#161020"]},
];
const glassMat=new THREE.MeshPhongMaterial({color:0x2a3a55,shininess:90,
  specular:0x8899bb,reflectivity:0.65,combine:THREE.MixOperation});
function makeEnvMap(td){
  const faces=[];
  for(let f=0;f<6;f++){
    const c=document.createElement("canvas"); c.width=16; c.height=16;
    const x=c.getContext("2d");
    if(f===2){ x.fillStyle=td.env[0]; x.fillRect(0,0,16,16); }        // top
    else if(f===3){ x.fillStyle=td.env[2]; x.fillRect(0,0,16,16); }   // bottom
    else{
      const g=x.createLinearGradient(0,0,0,16);
      g.addColorStop(0,td.env[0]); g.addColorStop(0.62,td.env[1]);
      g.addColorStop(0.78,td.env[2]); g.addColorStop(1,td.env[2]);
      x.fillStyle=g; x.fillRect(0,0,16,16);
    }
    faces.push(c);
  }
  const t=new THREE.CubeTexture(faces);
  t.needsUpdate=true; t.encoding=THREE.sRGBEncoding;
  return t;
}
function applyTod(lvl){
  Game.curTod=(lvl-1)%4;
  const td=TODS[Game.curTod];
  sky.material.map=skyTexs[Game.curTod]; sky.material.needsUpdate=true;
  scene.fog.color.set(td.fog);
  sunLight.color.set(td.sunC); sunLight.intensity=td.sunI;
  hemiLight.color.set(td.hemiS); hemiLight.groundColor.set(td.hemiG); hemiLight.intensity=td.hemiI;
  renderer.toneMappingExposure=td.exp;
  SUNDIR.set(td.dir[0],td.dir[1],td.dir[2]).normalize();
  sunLight.position.copy(SUNDIR).multiplyScalar(1000);
  sunGlow.material.color.set(td.glowC);
  sunGlow.material.opacity=td.glowO;
  if(glassMat.envMap) glassMat.envMap.dispose();
  glassMat.envMap=makeEnvMap(td);
  glassMat.needsUpdate=true;
}

// ---------- building pool ----------
// each slot owns its geometry so per-face UVs can be scaled to keep
// window density constant regardless of building size
const pool=[];          // {mesh, beacon, b:null|building}
const activeB=[];       // building records for collision
function makeSlot(){
  const geo=new THREE.BoxGeometry(1,1,1);
  geo.userData.baseUV=geo.attributes.uv.array.slice();
  const mats=[0,0,0,0,0,0].map(()=>facadeMats[0]);
  const mesh=new THREE.Mesh(geo,mats);
  mesh.visible=false;
  scene.add(mesh);
  const beacon=new THREE.Sprite(new THREE.SpriteMaterial({
    color:0xff5a4e,blending:THREE.AdditiveBlending,depthWrite:false}));
  beacon.scale.set(7,7,1); beacon.visible=false;
  scene.add(beacon);
  const sign=new THREE.Mesh(signGeo,signMats[0]);
  sign.visible=false;
  scene.add(sign);
  const slot={mesh,beacon,sign,b:null};
  pool.push(slot);
  return slot;
}
function freeSlot(){ for(const s of pool) if(!s.b) return s; return makeSlot(); }
const cylPool=[];
function makeCylSlot(){
  const geo=new THREE.CylinderGeometry(0.5,0.5,1,16);
  geo.userData.baseUV=geo.attributes.uv.array.slice();
  const mesh=new THREE.Mesh(geo,[facadeMats[0],roofMat,roofMat]);
  mesh.visible=false; scene.add(mesh);
  const beacon=new THREE.Sprite(new THREE.SpriteMaterial({
    color:0xff5a4e,blending:THREE.AdditiveBlending,depthWrite:false}));
  beacon.scale.set(7,7,1); beacon.visible=false; scene.add(beacon);
  const sign=new THREE.Mesh(signGeo,signMats[0]);
  sign.visible=false; scene.add(sign);
  const slot={mesh,beacon,sign,b:null};
  cylPool.push(slot);
  return slot;
}
function freeCylSlot(){ for(const s of cylPool) if(!s.b) return s; return makeCylSlot(); }
function scaleCylUV(geo,w,h){
  const uv=geo.attributes.uv.array, base=geo.userData.baseUV;
  const su=(Math.PI*w)/FACADE_UNIT, sv=h/FACADE_UNIT;
  for(let i=0;i<uv.length;i+=2){ uv[i]=base[i]*su; uv[i+1]=base[i+1]*sv; }
  geo.attributes.uv.needsUpdate=true;
}
function scaleUV(geo,w,h,d){
  const uv=geo.attributes.uv.array, base=geo.userData.baseUV;
  // BoxGeometry face vert order: +x,-x,+y,-y,+z,-z (4 verts each)
  const f=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(let face=0;face<6;face++){
    const su=f[face][0]/FACADE_UNIT, sv=f[face][1]/FACADE_UNIT;
    for(let v=0;v<4;v++){
      const i=(face*4+v)*2;
      uv[i]=base[i]*su; uv[i+1]=base[i+1]*sv;
    }
  }
  geo.attributes.uv.needsUpdate=true;
}
function spawnBuilding(x,z,w,d,h,pal,seed,antenna,shape){
  const isCyl=shape==="cyl", isGlass=shape==="glass";
  const s=isCyl?freeCylSlot():freeSlot();
  const rng=mulberry32(((seed|0)*17+3)|0);
  if(isCyl){
    s.mesh.material=[facadeMats[pal],roofMat,roofMat];
    scaleCylUV(s.mesh.geometry,w,h);
    s.mesh.scale.set(w,h,w);
    d=w;
  }else{
    const fm=isGlass?glassMat:facadeMats[pal];
    s.mesh.material=[fm,fm,roofMat,roofMat,fm,fm];
    scaleUV(s.mesh.geometry,w,h,d);
    s.mesh.scale.set(w,h,d);
  }
  s.mesh.position.set(x,h/2,z);
  s.mesh.visible=true;
  s.b={x,z,w,d,h,seed,antennaOn:antenna,slot:s};
  if(antenna){ s.beacon.position.set(x,h+6,z); }
  if(h>50) s.b.clutter=clutterAdd(s.b,rng);
  if(!isGlass&&h>60&&rng()<SIGN_P){
    s.sign.material=signMats[Math.floor(rng()*signMats.length)];
    s.sign.scale.set(w*0.55,9+rng()*6,1);
    s.sign.position.set(x+(rng()-0.5)*w*0.2, h*(0.35+rng()*0.4), z+d/2+0.6);
    s.sign.visible=true;
  }
  activeB.push(s.b);
}
function releaseBuilding(b){
  b.slot.mesh.visible=false; b.slot.beacon.visible=false; b.slot.sign.visible=false;
  if(b.clutter) clutterFree(b.clutter);
  b.slot.b=null;
}

// ---------- rows ----------
let nextRowZ=0,rowIdx=0;
function spawnRow(){
  const rng=mulberry32(rowIdx*7919+13);
  // one guaranteed gap in every 3-lane window, so a path is always reachable
  const gaps=new Set();
  for(let g0=0;g0<LANES.length;g0+=3){
    const span=Math.min(3,LANES.length-g0);
    gaps.add(g0+Math.floor(rng()*span));
  }
  const fillP=Math.min(0.34+P.dist*0.000022,0.78);
  for(let i=0;i<LANES.length;i++){
    if(gaps.has(i)) continue;
    if(pad.active&&Math.abs(nextRowZ-pad.z)<190&&Math.abs(LANES[i]-pad.x)<95) continue;
    if(rng()>fillP) continue;
    const low=rng()<(curTheme===2?0.42:0.28);
    const h=low?24+rng()*32
              :(curTheme===2?60+rng()*130:70+rng()*260); // fairground runs lower; downtown/coast pierce the ceiling
    const bx=LANES[i]+(rng()-0.5)*10, bz=nextRowZ-(rng()-0.5)*30;
    const bw=44+rng()*14, bd=60+rng()*40;
    let shape=null;
    if(!low){
      const sr=rng();
      if(sr<0.15) shape="cyl";
      else if(sr<0.33) shape="glass";
    }
    if(!low&&h>140&&shape!=="cyl"&&rng()<0.4) // setback podium tier
      spawnBuilding(bx,bz,bw+16,bd+16,h*0.5,Math.floor(rng()*facadeMats.length),rowIdx*31+i+900,false,shape);
    spawnBuilding(bx,bz,bw,bd,h,
      Math.floor(rng()*facadeMats.length),
      rowIdx*31+i,
      !low&&rng()<0.3,
      shape);
  }
  nextRowZ-=ROW_SPACING; rowIdx++;
}
function resetWorld(){
  for(const b of activeB.slice()) releaseBuilding(b);
  activeB.length=0;
  nextRowZ=-500; rowIdx=0;
  P.x=0;P.y=90;P.z=0;P.vx=0;P.vy=0;
  P.speed=SPEED0;P.lives=3;P.invuln=0;P.dist=0;
  Game.shake=0;Game.flash=0;cracks.length=0;popups.length=0;
  G.score=0;G.combo=0;G.fuel=100;G.lvl=1;G.levelEnd=5100;
  resetPickups();
  resetHazards();
  pad.active=false; pad.group.visible=false; G.landLabel="";
  applyTheme(1);
  blimp.position.set(150,330,P.z-1500);
  popup("SECTOR 1: "+THEME_NAMES[curTheme]+" \u00b7 "+TODS[Game.curTod].name);
  while(nextRowZ>P.z-VIEW) spawnRow();
  resetTraffic();
  initSideCity();
}

// ---------- pickups: score rings + parachute supply drops ----------
const pickGlowTex=(()=>{
  const c=document.createElement("canvas"); c.width=64; c.height=64;
  const x=c.getContext("2d");
  const g=x.createRadialGradient(32,32,2,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)"); g.addColorStop(0.35,"rgba(255,255,255,0.35)");
  g.addColorStop(1,"rgba(255,255,255,0)");
  x.fillStyle=g; x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
})();
const ringGeo=new THREE.TorusGeometry(11,1.4,8,24);
const ringMat=new THREE.MeshBasicMaterial({color:0xffcf87});
function makeRing(){
  const g=new THREE.Group();
  g.add(new THREE.Mesh(ringGeo,ringMat));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(8.6,0.5,6,22),
    new THREE.MeshBasicMaterial({color:0xfff0c4})));
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:pickGlowTex,color:0xffcf87,
    transparent:true,opacity:0.35,blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.scale.set(42,42,1); g.add(halo);
  return g;
}
function makeFuelDrop(){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CylinderGeometry(3.4,3.4,7,10),
    new THREE.MeshLambertMaterial({color:0x23303a}));
  g.add(body);
  const bandMat=new THREE.MeshBasicMaterial({color:0x7ef0d0});
  for(const y of [-2.6,2.6]){
    const band=new THREE.Mesh(new THREE.CylinderGeometry(3.55,3.55,1.1,10),bandMat);
    band.position.y=y; g.add(band);
  }
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.2,1.6,8),
    new THREE.MeshLambertMaterial({color:0x3a4650}));
  cap.position.y=4.2; g.add(cap);
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:pickGlowTex,color:0x7ef0d0,
    transparent:true,opacity:0.5,blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.scale.set(28,28,1); g.add(halo);
  // parachute canopy + shroud lines
  const canopy=new THREE.Mesh(new THREE.SphereGeometry(9,10,6,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshLambertMaterial({color:0x7ef0d0,transparent:true,opacity:0.45,side:THREE.DoubleSide}));
  canopy.position.y=16; g.add(canopy);
  const lines=[];
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2;
    lines.push(Math.cos(a)*8.5,16,Math.sin(a)*8.5, 0,4.5,0);
  }
  g.add(new THREE.LineSegments(lineGeo(lines),
    new THREE.LineBasicMaterial({color:0x9adfd0,transparent:true,opacity:0.7})));
  const bc=new THREE.Sprite(new THREE.SpriteMaterial({color:0x7ef0d0,
    blending:THREE.AdditiveBlending,depthWrite:false}));
  bc.scale.set(4,4,1); bc.position.y=18; g.add(bc);
  g.userData.beacon=bc;
  return g;
}
const rings=[],fuels=[];
let nextRingZ=0,nextFuelZ=0;
function freePick(list,factory){
  for(const p of list) if(!p.active) return p;
  const m=factory(); m.visible=false; scene.add(m);
  const p={m,active:false,phase:Math.random()*6,baseY:0}; list.push(p); return p;
}
// collection bursts
const bursts=[];
function burst(pos,color){
  let b=bursts.find(b=>!b.active);
  if(!b){
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:pickGlowTex,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
    sp.visible=false; scene.add(sp);
    b={sp,active:false,t0:0}; bursts.push(b);
  }
  b.active=true; b.t0=performance.now();
  b.sp.material.color.set(color);
  b.sp.material.opacity=0.85;
  b.sp.position.copy(pos);
  b.sp.scale.set(6,6,1);
  b.sp.visible=true;
}
function safeY(x,z,minY,maxY){ // lift pickups clear of any building underneath
  let y=minY+Math.random()*(maxY-minY);
  for(const b of activeB){
    if(Math.abs(b.z-z)<b.d/2+22&&Math.abs(b.x-x)<b.w/2+16)
      y=Math.max(y,Math.min(MAX_Y-25,b.h+24));
  }
  return y;
}
function resetPickups(){
  for(const p of rings){p.active=false;p.m.visible=false;}
  for(const p of fuels){p.active=false;p.m.visible=false;}
  for(const b of bursts){b.active=false;b.sp.visible=false;}
  nextRingZ=P.z-420; nextFuelZ=P.z-800;
}
function spawnPickups(){
  while(nextRingZ>P.z-VIEW){
    const p=freePick(rings,makeRing);
    const lane=LANES[Math.floor(Math.random()*LANES.length)]+(Math.random()-0.5)*20;
    p.m.position.set(lane,safeY(lane,nextRingZ,25,150),nextRingZ);
    p.m.rotation.set(0,0,Math.random()*3);
    p.m.visible=true;p.active=true;
    nextRingZ-=230+Math.random()*130;
  }
  while(nextFuelZ>P.z-VIEW){
    const p=freePick(fuels,makeFuelDrop);
    const lane=LANES[Math.floor(Math.random()*LANES.length)];
    p.baseY=safeY(lane,nextFuelZ,20,120);
    p.m.position.set(lane,p.baseY,nextFuelZ);
    p.m.visible=true;p.active=true;
    nextFuelZ-=520+Math.random()*280;
  }
}
function updatePickups(dt){
  spawnPickups();
  const now=performance.now();
  for(const p of rings){
    if(!p.active)continue;
    p.m.rotation.z+=dt*1.3;
    const pulse=1+0.06*Math.sin(now*0.004+p.phase);
    p.m.scale.set(pulse,pulse,1);
    if(p.m.position.z>P.z+30){p.active=false;p.m.visible=false;continue;}
    const d=p.m.position;
    if((P.x-d.x)**2+(P.y-d.y)**2+(P.z-d.z)**2<14*14){
      p.active=false;p.m.visible=false;
      burst(d,0xffcf87);
      G.combo=Math.min(8,G.combo+1);
      const pts=100*G.combo; G.score+=pts;
      popup("RING +"+pts+(G.combo>1?"  x"+G.combo:""));
      chime(880+G.combo*60);
    }
  }
  for(const p of fuels){
    if(!p.active)continue;
    p.m.rotation.y+=dt*0.8;
    p.m.position.y=p.baseY+Math.sin(now*0.0016+p.phase)*1.8;
    p.m.userData.beacon.material.opacity=Math.floor(now/450+p.phase)%2===0?1:0.15;
    if(p.m.position.z>P.z+30){p.active=false;p.m.visible=false;continue;}
    const d=p.m.position;
    if((P.x-d.x)**2+(P.y-d.y)**2+(P.z-d.z)**2<13*13){
      p.active=false;p.m.visible=false;
      burst(d,0x7ef0d0);
      G.fuel=Math.min(100,G.fuel+40);
      popup("FUEL +40");
      chime(520);
    }
  }
  for(const b of bursts){
    if(!b.active)continue;
    const k=(now-b.t0)/450;
    if(k>=1){b.active=false;b.sp.visible=false;continue;}
    const s=6+k*46;
    b.sp.scale.set(s,s,1);
    b.sp.material.opacity=0.85*(1-k);
  }
}

// ---------- traffic (headlights & taillights on the avenues) ----------
// ---------- sector finale: helipad landing ----------
const pad={active:false,x:0,z:0,h:58,group:null,lights:null};
{
  const g=new THREE.Group();
  const tower=new THREE.Mesh(new THREE.BoxGeometry(54,58,54),sideMat);
  tower.position.y=29; g.add(tower);
  const pc=document.createElement("canvas"); pc.width=128; pc.height=128;
  const px2=pc.getContext("2d");
  px2.fillStyle="#1e2a24"; px2.fillRect(0,0,128,128);
  px2.strokeStyle="#ffcf87"; px2.lineWidth=5;
  px2.beginPath(); px2.arc(64,64,52,0,7); px2.stroke();
  px2.strokeStyle="#f2ead9"; px2.lineWidth=10;
  px2.beginPath();
  px2.moveTo(46,40);px2.lineTo(46,88);
  px2.moveTo(82,40);px2.lineTo(82,88);
  px2.moveTo(46,64);px2.lineTo(82,64);
  px2.stroke();
  const padTex=new THREE.CanvasTexture(pc); padTex.encoding=THREE.sRGBEncoding;
  const rim=new THREE.Mesh(new THREE.CylinderGeometry(26,26,1.4,24),
    new THREE.MeshLambertMaterial({color:0x1a2420}));
  rim.position.y=58.6; g.add(rim);
  const topG=new THREE.CircleGeometry(26,24); topG.rotateX(-Math.PI/2);
  const top=new THREE.Mesh(topG,new THREE.MeshLambertMaterial({map:padTex}));
  top.position.y=59.4; g.add(top);
  const arr=[];
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2;arr.push(Math.cos(a)*24,60.2,Math.sin(a)*24);}
  pad.lights=new THREE.Points(lineGeo(arr),
    new THREE.PointsMaterial({color:0x39d98a,size:5,sizeAttenuation:true,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  g.add(pad.lights);
  // vertical beacon beam
  pad.beam=new THREE.Mesh(
    new THREE.CylinderGeometry(9,9,320,12,1,true),
    new THREE.MeshBasicMaterial({color:0x39d98a,transparent:true,opacity:0.10,
      blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false}));
  pad.beam.position.y=220; g.add(pad.beam);
  // approach strobes ("the rabbit"), running toward the pad
  pad.strobes=[];
  for(let i=0;i<7;i++){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({color:0xffffff,
      blending:THREE.AdditiveBlending,depthWrite:false,opacity:0}));
    s.scale.set(9,9,1);
    s.position.set(0, 62+i*4, 70+i*55);
    g.add(s); pad.strobes.push(s);
  }
  g.visible=false; scene.add(g); pad.group=g;
}
function activatePad(){
  pad.active=true;
  pad.x=LANES[3+Math.floor(Math.random()*5)]; // middle lanes only
  pad.z=P.z-(G.levelEnd-P.dist);
  pad.group.position.set(pad.x,0,pad.z);
  pad.group.visible=true;
  for(let i=activeB.length-1;i>=0;i--){ // clear an approach corridor
    const b=activeB[i];
    if(Math.abs(b.z-pad.z)<180&&Math.abs(b.x-pad.x)<95){releaseBuilding(b);activeB.splice(i,1);}
  }
  for(const l of [cranes,cables,drones]) // and keep hazards off the approach
    for(const h of l) if(h.g.visible&&Math.abs(h.z-pad.z)<300) h.g.visible=false;
  popup("APPROACH \u2014 LAND ON THE PAD");
}

// ---------- aerial hazards: cranes, cables, drones ----------
const cranes=[],cables=[],drones=[];
let nextHazZ=0;
function makeCraneObj(){
  const g=new THREE.Group();
  const mast=new THREE.Mesh(new THREE.BoxGeometry(5,150,5),
    new THREE.MeshLambertMaterial({color:0x7a4f2e}));
  mast.position.y=75; g.add(mast);
  const jib=new THREE.Mesh(new THREE.BoxGeometry(96,4,4),
    new THREE.MeshLambertMaterial({color:0x8a5a34}));
  jib.position.set(30,150,0); g.add(jib);
  const cj=new THREE.Mesh(new THREE.BoxGeometry(28,4,4),
    new THREE.MeshLambertMaterial({color:0x6a4426}));
  cj.position.set(-26,150,0); g.add(cj);
  const cable=new THREE.LineSegments(lineGeo([70,148,0,70,112,0]),
    new THREE.LineBasicMaterial({color:0x3a332c}));
  g.add(cable);
  const load=new THREE.Mesh(new THREE.BoxGeometry(8,8,8),
    new THREE.MeshLambertMaterial({color:0x39406a}));
  load.position.set(70,108,0); g.add(load);
  const bc=new THREE.Sprite(new THREE.SpriteMaterial({color:0xff5a4e,
    blending:THREE.AdditiveBlending,depthWrite:false}));
  bc.scale.set(6,6,1); bc.position.set(0,154,0); g.add(bc);
  g.visible=false; scene.add(g);
  return {g,x:0,z:0,flip:1};
}
function makeCableObj(){
  const g=new THREE.Group();
  const line=new THREE.Line(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({color:0x2a2521}));
  g.add(line);
  const marks=[];
  for(let i=0;i<3;i++){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({color:0xffae3a,
      blending:THREE.AdditiveBlending,depthWrite:false}));
    s.scale.set(5,5,1); g.add(s); marks.push(s);
  }
  g.visible=false; scene.add(g);
  return {g,line,marks,x0:0,x1:0,y:0,z:0,sag:12};
}
function makeDroneObj(){
  const g=new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(6,2.5,6),
    new THREE.MeshLambertMaterial({color:0x23202c})));
  for(const s of [[-4,-4],[4,-4],[-4,4],[4,4]]){
    const r=new THREE.Sprite(new THREE.SpriteMaterial({color:0x8a8072,opacity:0.5,transparent:true}));
    r.scale.set(4,4,1); r.position.set(s[0],1.8,s[1]); g.add(r);
  }
  const l=new THREE.Sprite(new THREE.SpriteMaterial({color:0x39d98a,
    blending:THREE.AdditiveBlending,depthWrite:false}));
  l.scale.set(4,4,1); l.position.y=2.5; g.add(l);
  g.visible=false; scene.add(g);
  return {g,x:0,y:0,z:0,vx:22};
}
function freeHaz(list,make,cap){
  for(const h of list) if(!h.g.visible) return h;
  if(list.length<cap){const h=make();list.push(h);return h;}
  return null;
}
function spawnHazards(){
  if(G.lvl<2) { nextHazZ=P.z-VIEW; return; } // hazards begin in sector 2
  while(nextHazZ>P.z-VIEW){
    const z=nextHazZ, roll=Math.random();
    if(roll<0.40){
      const h=freeHaz(cranes,makeCraneObj,3);
      if(h){
        h.x=LANES[Math.floor(Math.random()*LANES.length)]+32;
        h.z=z; h.flip=Math.random()<0.5?-1:1;
        h.g.position.set(h.x,0,z);
        h.g.scale.x=h.flip;
        h.g.visible=true;
      }
    }else if(roll<0.75){
      const h=freeHaz(cables,makeCableObj,4);
      if(h){
        const li=Math.floor(Math.random()*(LANES.length-3));
        h.x0=LANES[li]; h.x1=LANES[li+2+Math.floor(Math.random()*2)];
        h.y=55+Math.random()*110; h.z=z; h.sag=10+Math.random()*8;
        const pts=[];
        for(let i=0;i<=16;i++){
          const k=i/16, x=h.x0+(h.x1-h.x0)*k;
          pts.push(x,h.y-Math.sin(k*Math.PI)*h.sag,z);
        }
        h.line.geometry.dispose();
        h.line.geometry=lineGeo(pts);
        h.marks.forEach((m,i)=>{
          const k=(i+1)/4, x=h.x0+(h.x1-h.x0)*k;
          m.position.set(x,h.y-Math.sin(k*Math.PI)*h.sag,z);
        });
        h.g.visible=true;
      }
    }else{
      const h=freeHaz(drones,makeDroneObj,3);
      if(h){
        h.x=(Math.random()-0.5)*500; h.y=30+Math.random()*140; h.z=z;
        h.vx=(Math.random()<0.5?-1:1)*(16+Math.random()*14);
        h.g.position.set(h.x,h.y,z);
        h.g.visible=true;
      }
    }
    nextHazZ-=430+Math.random()*380;
  }
}
function boxHit(x0,x1,y0,y1,z0,z1){
  return P.x>x0-PR&&P.x<x1+PR&&P.y>y0-PR&&P.y<y1+PR&&P.z>z0-6&&P.z<z1+6;
}
function updateHazards(dt){
  spawnHazards();
  for(const h of cranes){
    if(!h.g.visible)continue;
    if(h.z>P.z+60){h.g.visible=false;continue;}
    if(P.invuln<=0){
      if(boxHit(h.x-3,h.x+3,0,150,h.z-3,h.z+3)||                       // mast
         boxHit(h.x+Math.min(0,h.flip*78)-4,h.x+Math.max(0,h.flip*78)+4,146,153,h.z-3,h.z+3)|| // jib
         boxHit(h.x+h.flip*70-5,h.x+h.flip*70+5,103,113,h.z-5,h.z+5)){ // load
        crash();P.y=Math.min(MAX_Y,P.y+30);return;
      }
    }
  }
  for(const h of cables){
    if(!h.g.visible)continue;
    if(h.z>P.z+60){h.g.visible=false;continue;}
    if(P.invuln<=0&&P.x>Math.min(h.x0,h.x1)&&P.x<Math.max(h.x0,h.x1)&&
       Math.abs(P.z-h.z)<5){
      const k=(P.x-h.x0)/(h.x1-h.x0);
      const cy=h.y-Math.sin(Math.max(0,Math.min(1,k))*Math.PI)*h.sag;
      if(Math.abs(P.y-cy)<7){crash();P.y=Math.min(MAX_Y,cy+26);return;}
    }
  }
  for(const h of drones){
    if(!h.g.visible)continue;
    if(h.z>P.z+60){h.g.visible=false;continue;}
    h.x+=h.vx*dt;
    if(h.x>360||h.x<-360)h.vx*=-1;
    h.g.position.x=h.x;
    h.g.rotation.z=Math.sin(performance.now()*0.004)*0.1;
    if(P.invuln<=0&&(P.x-h.x)**2+(P.y-h.y)**2+(P.z-h.z)**2<11*11){
      crash();P.y=Math.min(MAX_Y,P.y+25);return;
    }
  }
}
function resetHazards(){
  for(const l of [cranes,cables,drones])for(const h of l)h.g.visible=false;
  nextHazZ=P.z-900;
}



function nextCitySector(){
  G.lvl++;
  G.fuel=100;
  P.lives=Math.min(3,P.lives+1);              // patch one hull point between sectors
  G.levelEnd=P.dist+4500+600*G.lvl;           // sectors get longer
  P.speed=Math.min(SPEED_MAX,SPEED0+8*(G.lvl-1)); // and start faster
  applyTheme(G.lvl);
  pad.group.visible=false; G.landLabel="";
  P.invuln=2; P.y=Math.max(P.y,80);
  if(G.lvl===2)popup("NEW: AERIAL HAZARDS");
  popup("SECTOR "+G.lvl+": "+THEME_NAMES[Game.curTheme]+" · "+TODS[Game.curTod].name);
}

// ---------- traffic on the avenues ----------
const N_CARS=150;
let cars=null,carPts=null,carLightPos=null,carBody=null,carCabin=null;
const carDummy=new THREE.Object3D();
function carX(c){ // right-hand traffic: each direction keeps its own side
  return STREETS[c.street]+(c.dir>0?-4.6:4.6);
}
function resetTraffic(){
  if(!cars){
    cars=[];
    carLightPos=new Float32Array(N_CARS*2*3);
    const col=new Float32Array(N_CARS*2*3);
    for(let i=0;i<N_CARS;i++){
      const dir=Math.random()<0.5?1:-1; // +1 approaches (headlights), -1 recedes (taillights)
      cars.push({street:Math.floor(Math.random()*STREETS.length),dir,
        v:dir*(9+Math.random()*9),z:0});
      const gc=dir>0?0.85:0.22, bl=dir>0?0.60:0.18;
      for(const k of [0,1]){
        col[(i*2+k)*3]=1; col[(i*2+k)*3+1]=gc; col[(i*2+k)*3+2]=bl;
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.BufferAttribute(carLightPos,3));
    g.setAttribute("color",new THREE.BufferAttribute(col,3));
    carPts=new THREE.Points(g,new THREE.PointsMaterial({size:2.6,vertexColors:true,
      sizeAttenuation:true,blending:THREE.AdditiveBlending,depthWrite:false}));
    scene.add(carPts);
    carBody=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshLambertMaterial({color:0xffffff}),N_CARS);
    carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    carCabin=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshLambertMaterial({color:0x0e1420}),N_CARS);
    carCabin.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const bc=new THREE.Color();
    const hues=[0x241f30,0x2c2438,0x33203a,0x1c2634,0x342630,0x3a3040];
    if(carBody.setColorAt)
      for(let i=0;i<N_CARS;i++){bc.set(hues[i%hues.length]);carBody.setColorAt(i,bc);}
    scene.add(carBody); scene.add(carCabin);
  }
  for(const c of cars) c.z=P.z-Math.random()*VIEW;
}
function updateTraffic(dt){
  for(let i=0;i<N_CARS;i++){
    const c=cars[i];
    c.z+=c.v*dt;
    if(c.z>P.z+40||c.z<P.z-VIEW-200){
      c.street=Math.floor(Math.random()*STREETS.length);
      c.z=P.z-VIEW*(0.4+Math.random()*0.55);
    }
    const x=carX(c);
    carDummy.position.set(x,0.95,c.z);
    carDummy.scale.set(2.2,1.3,4.8);
    carDummy.updateMatrix();
    carBody.setMatrixAt(i,carDummy.matrix);
    carDummy.position.set(x,1.95,c.z-c.dir*0.5);
    carDummy.scale.set(1.9,0.85,2.5);
    carDummy.updateMatrix();
    carCabin.setMatrixAt(i,carDummy.matrix);
    const zf=c.z+c.dir*2.55;
    carLightPos[(i*2)*3]=x-0.85;   carLightPos[(i*2)*3+1]=1.05;   carLightPos[(i*2)*3+2]=zf;
    carLightPos[(i*2+1)*3]=x+0.85; carLightPos[(i*2+1)*3+1]=1.05; carLightPos[(i*2+1)*3+2]=zf;
  }
  carPts.geometry.attributes.position.needsUpdate=true;
  carBody.instanceMatrix.needsUpdate=true;
  carCabin.instanceMatrix.needsUpdate=true;
}


/** Scroll the building pool: spawn rows coming into view, release those behind.
 *  nextRowZ is reassigned here, so this has to live with it rather than be
 *  driven from the flight module. */
function advanceRows(){
  while(nextRowZ>P.z-VIEW) spawnRow();
  for(let i=activeB.length-1;i>=0;i--){
    if(activeB[i].z-activeB[i].d/2>P.z+60){
      releaseBuilding(activeB[i]); activeB.splice(i,1);
    }
  }
}

// ---------- lightning ----------
// The strike clock is reassigned, so it lives here rather than being driven
// from the flight module. boltT is when the sky last lit up; the cockpit fades
// a flash from it.
let nextBolt = 0, boltT = -99999;
function updateLightning(){
  const now = performance.now();
  if(now > nextBolt){
    boltT = now;
    nextBolt = now + 6000 + Math.random()*9000;
    setTimeout(thunder, 500 + Math.random()*1600);
  }
}
function lastBolt(){ return boltT; }

// ---------- the world, as the engine sees it ----------
// resetCity is Rotor Run's resetWorld under a name that says which world it
// resets. tickCity and rigCity gather the per-frame work its frame loop did
// inline, so main.js can drive either world through the same two calls.
function resetCity(){ resetWorld(); }

// The dice hanging from the mirror swing with the yaw — the one bit of
// cockpit furniture that is simulated rather than drawn.
let diceAng = 0, diceVel = 0;
function diceAngle(){ return diceAng; }

/** Ticks whether or not the pilot is flying: neon, emissive time, the dice. */
function tickCity(dt, t){
  emisTime.value = t * 0.001;
  const dTarget = -P.vx * 0.010 + (Game.state === S.DYING ? Math.sin(Game.dying.roll) * 0.5 : 0);
  diceVel += (dTarget - diceAng) * 30 * dt;
  diceVel *= Math.exp(-4 * dt);
  diceAng += diceVel * dt;
  signMats.forEach((m, i) => {                    // neon flicker: occasional dropout
    m.opacity = (Math.sin(t * 0.0021 * (1 + i * 0.37) + i * 9) > -0.96) ? 1 : 0.35;
  });
}

/** Per-frame dressing that follows the aircraft. */
function rigCity(t){
  rebaseGround();
  sky.position.set(P.x, 0, P.z);
  sunGlow.position.set(P.x + SUNDIR.x * 3400, SUNDIR.y * 3400, P.z + SUNDIR.z * 3400);
  for(const sl of skylines){
    sl.position.set(P.x * sl.userData.fac, sl.userData.h * 0.35, P.z - sl.userData.dist);
  }
  for(const s of pool){                            // rooftop beacons blink
    s.beacon.visible = !!(s.b && s.b.antennaOn && Math.floor(t / 600 + s.b.seed) % 2 === 0);
  }
}



function updateAttract(dt){
  P.speed=34;
  P.z-=P.speed*dt;
  const tt=performance.now()*0.001;
  P.x=Math.sin(tt*0.22)*130;
  P.vx=Math.cos(tt*0.22)*130*0.22;
  P.y=95+Math.sin(tt*0.15)*35;
  P.vy=Math.cos(tt*0.15)*35*0.15;
  advanceRows();
  updateTraffic(dt);
  updateSideCity();
  updateScenery(dt);
  updateCityLife(dt);
  rebaseGround();
}

export { updateLightning, lastBolt, cranes, cables, drones, rings, fuels, advanceRows, rebaseGround, spawnRow, releaseBuilding, pad, activeB, activatePad, resetCity, nextCitySector, rigCity, tickCity,
         updateAttract, updateTraffic, updateSideCity, updateScenery, updateCityLife,
         updatePickups, updateHazards, skylines, diceAngle, THEME_NAMES, TODS };

// Skylark — the open cockpit of a modern aerobatic single-seater, built in 3D.
//
// The cockpit is real geometry in metres around the pilot's eye (the origin,
// looking down -z). Ahead is a long glossy composite cowling in a sunburst
// livery running to a pointed spinner, a short tinted wind deflector, and a
// carbon-fibre panel under a matte glare shield carrying three screens — an
// attitude display with speed, altitude and heading, a moving map, and the
// run page — plus a G-meter with its tell-tales and a row of LED annunciators.
// The low wings, symmetric-section as aerobatic wings are, sit in the lower
// corners of the view.
//
// It is drawn in its own pass straight after the world into the same HDR
// target, over a cleared depth buffer, so the nearest trim never fights the far
// hills for depth precision and the cockpit goes through the same bloom and
// tone mapping as everything else. It lives in its own scene but under the
// world's light: every frame the sun and the sky are turned into the aircraft's
// frame, so the clear-coat flashes and shadows slide across the nose as she
// rolls. Reflections come from an environment map rebuilt from the sky for
// each time of day.
//
// Static parts are baked into one mesh per material, so the cockpit draws in a
// few dozen calls. The screens are canvases redrawn at their own rates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { renderer, camera } from '../view.js';
import { clamp, lerp, smooth, mulberry32 } from '../util.js';
import { G, Game, P, S, dents } from '../state.js';
import { SUNDIR } from '../sun.js';
import { Quality } from '../quality.js';
import { splats } from '../damage.js';
import { gDrops } from '../weather.js';
import { MAX_VX, SPEED_MAX } from './config.js';
import { sunLight, hemiLight } from './sky.js';
import { Fuel, Haz, Rings, af, coursePathX, groundH } from './world.js';

const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(camera.fov,camera.aspect,0.02,40);
cam.rotation.order="YXZ";

// ---------- helpers ----------
// Canvases are CPU-backed: several are redrawn while flying, and uploading a
// GPU-accelerated canvas to WebGL stalls the pipeline while the two sync.
function canvasTex(w,h,draw,srgb=true){
  const c=document.createElement("canvas"); c.width=w; c.height=h;
  const x=c.getContext("2d",{willReadFrequently:true});
  draw(x,w,h);
  const t=new THREE.CanvasTexture(c);
  if(srgb) t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return {tex:t,ctx:x,canvas:c};
}
const std=(o)=>new THREE.MeshStandardMaterial(o);
const SANS="'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);

// ---------- livery ----------
const WHITE="#f1f0ec", RED="#d3262e", INK="#1c2330";

// ---------- materials ----------
const trimBlack=std({color:"#141416",roughness:0.55});
const matteBlack=std({color:"#1b1b1d",roughness:0.92});
const alcantara=std({color:"#232325",roughness:0.95});
const satinMetal=std({color:"#8a8c90",metalness:1,roughness:0.3});
// Glass is drawn as reflection only, added over the view: diffuse black, so a
// pane is invisible except where it catches the sky or the sun, as real glass is.
const glass=std({color:0x000000,metalness:0,roughness:0.03,transparent:true,
  blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});

// ---------- the fuselage: glossy composite, coaming to spinner ----------
const Z_COAM=-0.50, Z_NOSE=-2.30;
const PROP_Y=-0.52, PROP_Z=-2.62;
const cowlArt=canvasTex(1024,512,paintCowl);
function paintCowl(x,w,h){
  // u runs from the coaming (0) to the nose (1); v runs round the section,
  // bottom-left (0) over the top (0.5) to bottom-right (1)
  x.fillStyle="#e9e7e1"; x.fillRect(0,0,w,h);
  // the sunburst: rays fanning back from the spinner over the whole nose
  x.save(); x.translate(w*1.02,h*0.5);
  const rays=7;
  for(let i=0;i<rays;i++){
    const a0=Math.PI+(i/(rays-1)-0.5)*1.7-0.07, a1=a0+0.14+(i%2)*0.05;
    x.fillStyle=i%3===1?INK:RED;
    x.beginPath(); x.moveTo(0,0);
    x.lineTo(Math.cos(a0)*w*1.4,Math.sin(a0)*w*1.4);
    x.lineTo(Math.cos(a1)*w*1.4,Math.sin(a1)*w*1.4);
    x.closePath(); x.fill();
  }
  x.restore();
  // a red cheat line along each side, and a black anti-glare panel on top
  // right in front of the screen, as aerobatic noses carry
  x.fillStyle=RED; x.fillRect(0,h*0.10,w,h*0.035); x.fillRect(0,h*0.865,w,h*0.035);
  const ag=x.createLinearGradient(0,0,w*0.34,0);
  ag.addColorStop(0,"rgba(22,22,24,1)"); ag.addColorStop(1,"rgba(22,22,24,0)");
  x.fillStyle=ag; x.fillRect(0,h*0.40,w*0.34,h*0.20);
  // panel lines and flush fasteners of the removable cowling
  const uC=0.30;
  x.strokeStyle="rgba(40,40,44,0.55)"; x.lineWidth=2;
  x.beginPath(); x.moveTo(uC*w,0); x.lineTo(uC*w,h); x.stroke();
  for(const v of [0.30,0.70]){ x.beginPath(); x.moveTo(uC*w,v*h); x.lineTo(w,v*h); x.stroke(); }
  x.fillStyle="rgba(70,72,78,0.8)";
  for(let u=uC*w+16;u<w;u+=32) for(const v of [0.30,0.70]){ x.beginPath(); x.arc(u,v*h,2.2,0,7); x.fill(); }
  for(let v=12;v<h;v+=24){ x.beginPath(); x.arc(uC*w,v,2.2,0,7); x.fill(); }
  // an oil door and a flush fuel cap
  x.strokeStyle="rgba(40,40,44,0.5)"; x.strokeRect(0.62*w,0.44*h,70,40);
  x.fillStyle="rgba(150,152,158,0.9)"; x.beginPath(); x.arc(0.22*w,0.36*h,11,0,7); x.fill();
}
function fuselageGeometry(){
  const NZ=40, NP=34;
  const pos=[], uv=[], idx=[];
  for(let i=0;i<=NZ;i++){
    const k=i/NZ, z=lerp(Z_COAM,Z_NOSE,k);
    const hw=lerp(0.40,0.20,Math.pow(smooth(k),0.9));
    const top=lerp(-0.212,-0.395,Math.pow(k,1.35));
    const arch=hw*0.66;
    for(let j=0;j<=NP;j++){
      const s=j/NP;
      let x,y;
      if(s<0.14){ x=-hw; y=lerp(-1.1,top-arch,s/0.14); }
      else if(s>0.86){ x=hw; y=lerp(top-arch,-1.1,(s-0.86)/0.14); }
      else{
        const a=((s-0.14)/0.72-0.5)*Math.PI;
        x=hw*Math.sin(a); y=top-arch*(1-Math.pow(Math.cos(a),0.8));
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
// car-paint: a clear coat over the livery, so the sky slides over the nose
// (a softer coat than a show car's: seen this close to edge-on, a mirror
// finish would show nothing but sky)
const cowlMat=new THREE.MeshPhysicalMaterial({map:cowlArt.tex,roughness:0.45,metalness:0,
  clearcoat:0.55,clearcoatRoughness:0.14,envMapIntensity:0.55});
const fuselage=new THREE.Mesh(fuselageGeometry(),cowlMat);
fuselage.castShadow=true; fuselage.receiveShadow=true;
scene.add(fuselage);

// the sides alongside the cockpit, and the carbon tub inside
const carbonArt=canvasTex(256,256,(x,w,h)=>{
  x.fillStyle="#151517"; x.fillRect(0,0,w,h);
  // a 2x2 twill: diagonal steps of lighter and darker tows
  const s=16;
  for(let j=0;j<h/s;j++) for(let i=0;i<w/s;i++){
    const on=((i+j)>>1)%2===0;
    const g=x.createLinearGradient(i*s,j*s,i*s+(on?s:0),j*s+(on?0:s));
    g.addColorStop(0,on?"#2a2b2f":"#1b1c1f"); g.addColorStop(0.5,on?"#3a3c41":"#232428"); g.addColorStop(1,on?"#2a2b2f":"#1b1c1f");
    x.fillStyle=g; x.fillRect(i*s,j*s,s,s);
  }
});
carbonArt.tex.wrapS=carbonArt.tex.wrapT=THREE.RepeatWrapping;
carbonArt.tex.repeat.set(6,4);
const carbon=new THREE.MeshPhysicalMaterial({map:carbonArt.tex,roughness:0.35,metalness:0.2,
  clearcoat:1,clearcoatRoughness:0.08});
{
  const side=std({color:"#d6d4ce",roughness:0.62,envMapIntensity:0.4});
  for(const sx of [-1,1]){
    const o=new THREE.Mesh(new THREE.PlaneGeometry(1.3,0.85),side);
    o.position.set(sx*0.43,-0.70,0.12); o.rotation.y=sx*Math.PI/2;
    o.receiveShadow=true; scene.add(o);
    const lip=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.02,1.25),alcantara);
    lip.position.set(sx*0.40,-0.283,0.10); lip.receiveShadow=true; scene.add(lip);
    const w=new THREE.Mesh(new THREE.PlaneGeometry(1.2,0.8),carbon);
    w.position.set(sx*0.365,-0.68,0.10); w.rotation.y=-sx*Math.PI/2;
    w.receiveShadow=true; scene.add(w);
  }
}

// ---------- the low wings: symmetric section, as aerobatic wings are ----------
const wingArt=canvasTex(1024,256,(x,w,h)=>{
  // u: root (0) to tip (1); v: round the section from trailing edge top (0)
  // over the leading edge (0.5) to trailing edge bottom (1)
  x.fillStyle=WHITE; x.fillRect(0,0,w,h);
  // red chevrons toward the tip, and the aileron's hinge line
  for(let i=0;i<3;i++){
    const u=w*(0.62+i*0.11);
    x.fillStyle=i===1?INK:RED;
    x.beginPath(); x.moveTo(u,0); x.lineTo(u+50,h*0.5); x.lineTo(u,h); x.lineTo(u+34,h); x.lineTo(u+84,h*0.5); x.lineTo(u+34,0); x.closePath(); x.fill();
  }
  x.strokeStyle="rgba(40,40,44,0.55)"; x.lineWidth=2;
  x.beginPath(); x.moveTo(w*0.18,h*0.16); x.lineTo(w*0.97,h*0.16); x.stroke();
  x.beginPath(); x.moveTo(w*0.18,h*0.84); x.lineTo(w*0.97,h*0.84); x.stroke();
  x.fillStyle=RED; x.fillRect(w*0.985,0,w*0.015,h);
});
function wingGeometry(sx){
  const NS=14, NC=22;
  const pos=[], uv=[], idx=[];
  // NACA 00xx half-thickness at chord fraction c
  const yt=(c,t)=>5*t*(0.2969*Math.sqrt(c)-0.1260*c-0.3516*c*c+0.2843*c*c*c-0.1036*c*c*c*c);
  for(let i=0;i<=NS;i++){
    const u=i/NS, span=lerp(0.36,3.9,u);
    const chord=lerp(1.75,1.05,u), le=lerp(-1.55,-1.30,u), thick=lerp(0.16,0.12,u);
    const y0=-0.90+u*0.03;
    for(let j=0;j<=NC;j++){
      const v=j/NC;
      const c=Math.pow(Math.abs(1-2*v),1.6);           // chord fraction, bunched at the nose
      const up=v<0.5?1:-1;
      pos.push(sx*span, y0+up*yt(c,thick)*chord, le+c*chord);
      uv.push(u,v);
    }
  }
  for(let i=0;i<NS;i++) for(let j=0;j<NC;j++){
    const a=i*(NC+1)+j, b=a+NC+1;
    if(sx>0) idx.push(a,b,a+1, a+1,b,b+1); else idx.push(a,a+1,b, a+1,b+1,b);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
{
  const m=new THREE.MeshPhysicalMaterial({map:wingArt.tex,roughness:0.42,clearcoat:1,clearcoatRoughness:0.06});
  for(const sx of [-1,1]){
    const w=new THREE.Mesh(wingGeometry(sx),m);
    w.castShadow=true; w.receiveShadow=true; scene.add(w);
  }
}

// ---------- the panel: carbon, under a matte glare shield ----------
const PW=0.365, PANEL_Z=-0.50;
{
  const s=new THREE.Shape();
  s.moveTo(-PW,-0.64); s.lineTo(PW,-0.64); s.lineTo(PW,-0.232);
  s.quadraticCurveTo(0,-0.188,-PW,-0.232); s.closePath();
  const g=new THREE.ShapeGeometry(s,24);
  const p=g.attributes.position, uv=g.attributes.uv;
  for(let i=0;i<p.count;i++) uv.setXY(i,(p.getX(i)+PW)/(2*PW),(p.getY(i)+0.64)/0.47);
  const panel=new THREE.Mesh(g,carbon);
  panel.position.z=PANEL_Z; panel.receiveShadow=true;
  scene.add(panel);
  // the glare shield: a hood from the panel's top edge forward to the deflector
  const N=24, pos=[], idx=[];
  for(let i=0;i<=N;i++){
    const x=-PW+i/N*2*PW, k=x/PW, yb=-0.210-0.022*k*k;
    pos.push(x,yb,PANEL_Z+0.03, x,yb+0.012,PANEL_Z-0.02, x,yb-0.004,PANEL_Z-0.13);
  }
  for(let i=0;i<N;i++) for(let j=0;j<2;j++){
    const a=i*3+j, b=a+3;
    idx.push(a,b,a+1, a+1,b,b+1);
  }
  const hg=new THREE.BufferGeometry();
  hg.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  hg.setIndex(idx); hg.computeVertexNormals();
  const hood=new THREE.Mesh(hg,matteBlack);
  hood.castShadow=true; hood.receiveShadow=true;
  scene.add(hood);
}
// the padded edge of the cockpit opening
{
  const pts=[];
  for(let i=0;i<=16;i++){
    const x=-PW+i/16*2*PW, k=x/PW;
    pts.push(V3(x,-0.200-0.022*k*k,PANEL_Z+0.035));
  }
  pts.push(V3(0.39,-0.262,-0.36),V3(0.39,-0.272,0.05),V3(0.35,-0.272,0.55),V3(0,-0.272,0.74),
    V3(-0.35,-0.272,0.55),V3(-0.39,-0.272,0.05),V3(-0.39,-0.262,-0.36));
  const curve=new THREE.CatmullRomCurve3(pts,true,"centripetal");
  const roll=new THREE.Mesh(new THREE.TubeGeometry(curve,160,0.016,10,true),alcantara);
  roll.castShadow=true; roll.receiveShadow=true;
  scene.add(roll);
}

// ---------- the screens ----------
// Glossy black glass that emits what it shows: readable in the shade of the
// glare shield, and still catching the sky.
function screen(x,y,w,h,cw,ch){
  const art=canvasTex(cw,ch,(c)=>{ c.fillStyle="#000"; c.fillRect(0,0,cw,ch); });
  const bezel=new THREE.Mesh(new THREE.BoxGeometry(w+0.016,h+0.022,0.012),trimBlack);
  bezel.position.set(x,y,PANEL_Z+0.006); bezel.receiveShadow=true;
  const face=new THREE.Mesh(new THREE.PlaneGeometry(w,h),std({color:0x000000,roughness:0.12,
    emissive:0xffffff,emissiveMap:art.tex,emissiveIntensity:1.0}));
  face.position.set(x,y,PANEL_Z+0.0125); face.userData.dynamic=true;
  // soft-keys along the bottom of the bezel
  for(let i=0;i<5;i++){
    const b=new THREE.Mesh(new THREE.BoxGeometry(w*0.12,0.006,0.006),satinMetal);
    b.position.set(x-w*0.4+i*w*0.2,y-h/2-0.0075,PANEL_Z+0.013);
    scene.add(b);
  }
  scene.add(bezel,face);
  return {art,w:cw,h:ch,key:""};
}
const SY=-0.279, SH=0.102;
const mfdMap=screen(-0.262,SY,0.176,SH,384,256);
const pfd=screen(-0.030,SY,0.232,SH,512,256);
const mfdRun=screen(0.262,SY,0.176,SH,384,256);

function drawPFD(){
  const x=pfd.art.ctx, w=pfd.w, h=pfd.h, cx=w*0.5, cy=h*0.52;
  const bank=P.roll, pitch=Math.atan2(P.vy,Math.max(10,P.speed))*57.3, ppd=5.2;
  x.save();
  x.beginPath(); x.rect(0,0,w,h); x.clip();
  // the horizon turns exactly as the real one does through the deflector
  x.translate(cx,cy); x.rotate(-bank); x.translate(0,pitch*ppd);
  x.fillStyle="#2e73d8"; x.fillRect(-w,-h*2,w*2,h*2);
  x.fillStyle="#8a5a2c"; x.fillRect(-w,0,w*2,h*2);
  x.fillStyle="#ffffff"; x.fillRect(-w,-1.5,w*2,3);
  x.font="600 15px "+SANS; x.textAlign="right"; x.textBaseline="middle";
  for(let d=-30;d<=30;d+=5){
    if(!d) continue;
    const y=-d*ppd, len=d%10===0?64:34;
    x.fillRect(-len/2,y-1,len,2);
    if(d%10===0){ x.fillText(Math.abs(d),-len/2-6,y); }
  }
  x.restore();
  // bank scale and pointer
  x.strokeStyle="#fff"; x.lineWidth=2; x.fillStyle="#fff";
  x.beginPath(); x.arc(cx,cy,h*0.40,Math.PI*1.25,Math.PI*1.75); x.stroke();
  for(const a of [-45,-30,-20,-10,0,10,20,30,45]){
    const r=a*Math.PI/180-Math.PI/2, l=a%30===0?14:8;
    x.beginPath(); x.moveTo(cx+Math.cos(r)*h*0.40,cy+Math.sin(r)*h*0.40);
    x.lineTo(cx+Math.cos(r)*(h*0.40+l),cy+Math.sin(r)*(h*0.40+l)); x.stroke();
  }
  x.save(); x.translate(cx,cy); x.rotate(-bank);
  x.beginPath(); x.moveTo(0,-h*0.40+2); x.lineTo(-7,-h*0.40+14); x.lineTo(7,-h*0.40+14); x.closePath(); x.fill();
  x.restore();
  // the aircraft symbol
  x.fillStyle="#ffd21e"; x.strokeStyle="#000"; x.lineWidth=1.5;
  x.beginPath(); x.moveTo(cx-70,cy); x.lineTo(cx-26,cy); x.lineTo(cx-26,cy+8); x.lineTo(cx-70,cy+8); x.closePath(); x.fill(); x.stroke();
  x.beginPath(); x.moveTo(cx+70,cy); x.lineTo(cx+26,cy); x.lineTo(cx+26,cy+8); x.lineTo(cx+70,cy+8); x.closePath(); x.fill(); x.stroke();
  x.fillRect(cx-4,cy-2,8,8);
  // speed and altitude tapes
  const tape=(x0,val,step,unit,left)=>{
    x.fillStyle="rgba(0,0,0,0.45)"; x.fillRect(x0,0,76,h);
    x.fillStyle="#fff"; x.font="600 15px "+SANS; x.textAlign=left?"right":"left";
    const px=3.0/step*10;
    for(let v=Math.floor((val-40*step/10)/step)*step;v<=val+40*step/10;v+=step){
      const y=cy-(v-val)*px/ (step/10) *0.1*10/10;
      if(y<8||y>h-8) continue;
      x.fillRect(left?x0+62:x0,y-1,14,2);
      x.fillText(String(Math.round(v)),left?x0+58:x0+18,y);
    }
    x.fillStyle="#000"; x.strokeStyle="#fff"; x.lineWidth=2;
    x.beginPath(); x.rect(x0+2,cy-17,72,34); x.fill(); x.stroke();
    x.fillStyle="#fff"; x.font="700 22px "+SANS; x.textAlign="center";
    x.fillText(String(Math.round(val)),x0+38,cy+1);
    x.fillStyle="#9fd4ff"; x.font="600 13px "+SANS; x.fillText(unit,x0+38,14);
  };
  tape(0,P.speed*3.6,20,"KM/H",true);
  tape(w-76,P.y,20,"ALT M",false);
  // heading along the top
  const head=(-P.roll*26+Game.wind*0.5+360)%360;
  x.fillStyle="rgba(0,0,0,0.5)"; x.fillRect(96,0,w-192,26);
  x.fillStyle="#fff"; x.font="600 14px "+SANS; x.textAlign="center";
  for(let d=-40;d<=40;d+=10){
    const hd=((Math.round((head+d)/10)*10)%360+360)%360, off=((hd-head+540)%360)-180;
    const X=cx+off*3.4;
    if(X<104||X>w-104) continue;
    x.fillText(hd%90===0?"NESW"[hd/90]:String(hd/10),X,13);
  }
  x.fillStyle="#ffd21e"; x.beginPath(); x.moveTo(cx,26); x.lineTo(cx-6,34); x.lineTo(cx+6,34); x.closePath(); x.fill();
  // height above the ground, when it matters
  const agl=P.y-groundH(P.x,P.z);
  if(agl<150){ x.fillStyle=agl<40?"#ffae3a":"#9fd4ff"; x.font="700 16px "+SANS; x.textAlign="right"; x.fillText("AGL "+Math.max(0,Math.round(agl)),w-84,h-14); }
  pfd.art.tex.needsUpdate=true;
}
function drawMap(){
  const x=mfdMap.art.ctx, w=mfdMap.w, h=mfdMap.h;
  x.fillStyle="#05080c"; x.fillRect(0,0,w,h);
  const RANGE=1500, HALF=620;
  const map=(wx,wz)=>({x:w/2+(wx-P.x)/HALF*(w/2), y:h-14-((P.z-wz)/RANGE)*(h-30)});
  x.strokeStyle="rgba(90,130,160,0.25)"; x.lineWidth=1;
  for(const r of [500,1000,1500]){ x.beginPath(); x.arc(w/2,h-14,r/RANGE*(h-30),Math.PI,0); x.stroke(); }
  x.strokeStyle="#e040c8"; x.lineWidth=3; x.beginPath();               // the course, in GPS magenta
  for(let j=0;j<=24;j++){ const wz=P.z-RANGE*(j/24), p=map(coursePathX(wz),wz); j?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y); }
  x.stroke();
  for(const r of Rings.list){
    if(!r.active||r.z>P.z||P.z-r.z>RANGE) continue;
    const p=map(r.x,r.z);
    x.strokeStyle=r.hit?"#3fe07a":(r.gold?"#ffd21e":"#4fd8ff"); x.lineWidth=3;
    x.beginPath(); x.arc(p.x,p.y,r.gold?7:5,0,7); x.stroke();
  }
  x.fillStyle="#3fe07a";
  for(const f of Fuel.list){ if(!f.active||f.z>P.z||P.z-f.z>RANGE) continue; const p=map(f.x,f.z); x.fillRect(p.x-4,p.y-4,8,8); }
  x.fillStyle="#ff4d4d";
  for(const l of [Haz.masts,Haz.turbines,Haz.balloons]) for(const hz of l){
    if(!hz.active||hz.z>P.z||P.z-hz.z>RANGE) continue; const p=map(hz.x,hz.z); x.fillRect(p.x-3,p.y-3,6,6);
  }
  x.strokeStyle="#ff4d4d"; x.lineWidth=2;
  for(const hz of Haz.lines){
    if(!hz.active||hz.z>P.z||P.z-hz.z>RANGE) continue;
    const a=map(hz.x-hz.span/2,hz.z), b=map(hz.x+hz.span/2,hz.z);
    x.beginPath(); x.moveTo(a.x,a.y); x.lineTo(b.x,b.y); x.stroke();
  }
  if(af.active&&af.z<P.z&&P.z-af.z<RANGE+af.len){
    const a=map(af.x,af.z+af.len/2), b=map(af.x,af.z-af.len/2);
    x.strokeStyle="#ffffff"; x.lineWidth=7; x.beginPath(); x.moveTo(a.x,a.y); x.lineTo(b.x,b.y); x.stroke();
  }
  const me=map(P.x,P.z);
  x.fillStyle="#fff"; x.beginPath();
  x.moveTo(me.x,me.y-11); x.lineTo(me.x-8,me.y+6); x.lineTo(me.x,me.y+2); x.lineTo(me.x+8,me.y+6); x.closePath(); x.fill();
  x.fillStyle="#9fd4ff"; x.font="700 18px "+SANS; x.textAlign="left"; x.textBaseline="top";
  x.fillText("MAP",10,8);
  x.textAlign="right"; x.fillStyle="#6f8aa0"; x.font="600 15px "+SANS; x.fillText("1.5 KM",w-10,10);
  mfdMap.art.tex.needsUpdate=true;
}
function drawRun(){
  const lvlLen=5000+700*G.lvl;
  const prog=clamp(1-(G.levelEnd-P.dist)/lvlLen,0,1);
  const key=[Math.floor(G.score),G.ringsHit,G.rings,G.combo,G.lvl,(P.dist/1000).toFixed(2),P.lives,Math.round(prog*100)].join("|");
  if(key===mfdRun.key) return;
  mfdRun.key=key;
  const x=mfdRun.art.ctx, w=mfdRun.w, h=mfdRun.h;
  x.fillStyle="#05080c"; x.fillRect(0,0,w,h);
  x.textBaseline="alphabetic";
  x.fillStyle="#6f8aa0"; x.font="700 16px "+SANS; x.textAlign="left"; x.fillText("SCORE",14,28);
  x.fillStyle="#ffffff"; x.font="700 54px "+SANS; x.fillText(Math.floor(G.score).toLocaleString(),12,86);
  x.fillStyle="#6f8aa0"; x.font="700 15px "+SANS;
  x.fillText("RINGS",14,120); x.fillText("SECTOR",200,120);
  x.fillStyle="#ffffff"; x.font="700 28px "+SANS;
  x.fillText(G.ringsHit+"/"+G.rings,14,152);
  if(G.combo>1){ x.fillStyle="#ffd21e"; x.fillText("x"+G.combo,120,152); }
  x.fillStyle="#ffffff"; x.fillText("S"+G.lvl+"  "+(P.dist/1000).toFixed(1)+" km",200,152);
  x.fillStyle="#6f8aa0"; x.font="700 15px "+SANS; x.fillText("AIRFRAME",14,190);
  for(let i=0;i<3;i++){
    x.fillStyle=i<P.lives?(P.lives<=1?"#ff4d4d":"#3fe07a"):"#1e2830";
    x.fillRect(110+i*44,176,38,16);
  }
  x.fillStyle="#1e2830"; x.fillRect(14,218,w-28,12);
  x.fillStyle="#4fd8ff"; x.fillRect(14,218,(w-28)*prog,12);
  x.fillStyle="#6f8aa0"; x.font="600 13px "+SANS; x.fillText("SECTOR PROGRESS",14,248);
  mfdRun.art.tex.needsUpdate=true;
}

// ---------- the G-meter, between the attitude display and the run page ----------
const GM={};
{
  const r=0.034, x0=0.132, y0=SY+0.012;
  const art=canvasTex(256,256,(x,w)=>{
    const c=w/2;
    const rr=w*0.48;
    x.fillStyle="#0b0b0c"; x.beginPath(); x.arc(c,c,rr,0,7); x.fill();
    const a0=Math.PI*0.75, sw=Math.PI*1.5, g2a=g=>a0+sw*(g+5)/15;
    const arc=(g0,g1,col)=>{ x.strokeStyle=col; x.lineWidth=rr*0.10; x.beginPath(); x.arc(c,c,rr*0.80,g2a(g0),g2a(g1)); x.stroke(); };
    arc(-3,6,"#1f9e4a"); arc(6,8,"#e0b020"); arc(8,10,"#d0302a"); arc(-5,-3,"#d0302a");
    x.strokeStyle="#fff"; x.fillStyle="#fff"; x.textAlign="center"; x.textBaseline="middle";
    x.font="700 "+Math.round(rr*0.2)+"px "+SANS;
    for(let g=-5;g<=10;g++){
      const a=g2a(g), major=g%5===0||g===1;
      x.lineWidth=major?4:2;
      x.beginPath(); x.moveTo(c+Math.cos(a)*rr*(major?0.62:0.70),c+Math.sin(a)*rr*(major?0.62:0.70));
      x.lineTo(c+Math.cos(a)*rr*0.88,c+Math.sin(a)*rr*0.88); x.stroke();
      if(major) x.fillText(String(g),c+Math.cos(a)*rr*0.46,c+Math.sin(a)*rr*0.46);
    }
    x.fillStyle="#8a8f96"; x.font="700 "+Math.round(rr*0.15)+"px "+SANS; x.fillText("G",c,c+rr*0.40);
  });
  const g=new THREE.Group(); g.position.set(x0,y0,PANEL_Z+0.006);
  const face=new THREE.Mesh(new THREE.CircleGeometry(r,48),std({map:art.tex,roughness:0.6}));
  const bezel=new THREE.Mesh(new THREE.TorusGeometry(r*1.05,r*0.10,10,48),trimBlack);
  bezel.position.z=0.003;
  const needleGeo=(len,wid)=>{ const s=new THREE.Shape();
    s.moveTo(-r*0.15,-wid); s.lineTo(r*len,-wid*0.3); s.lineTo(r*(len+0.05),0); s.lineTo(r*len,wid*0.3); s.lineTo(-r*0.15,wid); s.closePath();
    return new THREE.ShapeGeometry(s); };
  const needle=new THREE.Mesh(needleGeo(0.82,r*0.05),std({color:"#ffffff",emissive:"#ffffff",emissiveIntensity:0.15}));
  needle.position.z=0.006; needle.userData.dynamic=true;
  const tellMat=std({color:"#ff8a1e",emissive:"#ff8a1e",emissiveIntensity:0.3});
  const tellHi=new THREE.Mesh(needleGeo(0.78,r*0.025),tellMat); tellHi.position.z=0.0045; tellHi.userData.dynamic=true;
  const tellLo=new THREE.Mesh(needleGeo(0.78,r*0.025),tellMat); tellLo.position.z=0.0045; tellLo.userData.dynamic=true;
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(r*0.1,r*0.1,0.004,16),trimBlack);
  hub.rotation.x=Math.PI/2; hub.position.z=0.008;
  const lens=new THREE.Mesh(new THREE.CircleGeometry(r,32),glass); lens.position.z=0.011;
  g.add(face,bezel,tellHi,tellLo,needle,hub,lens);
  scene.add(g);
  Object.assign(GM,{needle,tellHi,tellLo,g:1,hi:1,lo:1,pvy:0});
}
const gAngle=g=>-(Math.PI*0.75+Math.PI*1.5*(clamp(g,-5,10)+5)/15);

// ---------- LED annunciators on the glare shield ----------
const lamps=[];
{
  const specs=[["FUEL","#ffae3a",()=>G.fuel<20],["TERR","#ff4b3e",()=>Game.warnObst],
               ["RWY","#46e07a",()=>af.active&&(af.phase===1||af.phase===2||af.phase===4)]];
  const housing=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.022,0.018),trimBlack);
  housing.position.set(-0.20,-0.206,-0.555); housing.rotation.x=-0.3;
  housing.castShadow=true; scene.add(housing);
  specs.forEach(([label,col,on],i)=>{
    const art=canvasTex(128,64,(x,w,h)=>{
      x.fillStyle="#0c0c0d"; x.fillRect(0,0,w,h);
      x.fillStyle=col; x.font="800 30px "+SANS; x.textAlign="center"; x.textBaseline="middle"; x.fillText(label,w/2,h/2+1);
    });
    const m=std({color:0x000000,roughness:0.2,emissive:0xffffff,emissiveMap:art.tex,emissiveIntensity:0.12});
    const lamp=new THREE.Mesh(new THREE.PlaneGeometry(0.044,0.016),m);
    lamp.position.set(-0.252+i*0.052,-0.2005,-0.5445); lamp.rotation.x=-0.3;
    lamp.userData.dynamic=true;
    scene.add(lamp);
    lamps.push({m,on,blink:i<2});
  });
}

// ---------- the wind deflector ----------
const WS={};
{
  const R=0.34, CZ=-0.32, PHI=0.62, NU=24, NV=6;
  const shape=(u,v)=>{                                   // u,v in 0..1
    const phi=(u-0.5)*2*PHI;
    const yb=-0.210, yt=-0.070-0.050*Math.pow((u-0.5)*2,2);
    const y=lerp(yb,yt,v);
    const lean=(y-yb)*0.95;                                // raked well back
    return V3(R*Math.sin(phi), y, CZ-R*Math.cos(phi)+lean);
  };
  const pos=[], uv=[], idx=[];
  for(let i=0;i<=NU;i++) for(let j=0;j<=NV;j++){ const p=shape(i/NU,j/NV); pos.push(p.x,p.y,p.z); uv.push(i/NU,j/NV); }
  for(let i=0;i<NU;i++) for(let j=0;j<NV;j++){ const a=i*(NV+1)+j, b=a+NV+1; idx.push(a,b,a+1, a+1,b,b+1); }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geo.setIndex(idx); geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo,glass));
  // a smoke tint, darkening what is seen through it a little
  const tint=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:"#22323e",transparent:true,opacity:0.24,
    depthWrite:false,side:THREE.DoubleSide}));
  scene.add(tint);
  // grime on the screen: bird strikes and rain, painted as they happen
  const grime=canvasTex(512,160,()=>{});
  const gm=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:grime.tex,transparent:true,
    roughness:0.4,depthWrite:false,side:THREE.DoubleSide}));
  gm.renderOrder=1; gm.userData.dynamic=true;
  scene.add(gm);
  // a black rubber edge along the top, and the base seal
  const edge=[], base=[];
  for(let i=0;i<=NU;i++){ edge.push(shape(i/NU,1)); base.push(shape(i/NU,0)); }
  const top=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge),48,0.0022,6),trimBlack);
  const seal=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(base),48,0.004,6),trimBlack);
  top.castShadow=true; scene.add(top,seal);
  Object.assign(WS,{grime,splatN:0});
}

// ---------- the spinner and the propeller ----------
{
  const prof=[];
  for(let i=0;i<=16;i++){ const k=i/16; prof.push(new THREE.Vector2(0.135*Math.pow(1-k,0.62),k*0.42)); }
  const sp=new THREE.Mesh(new THREE.LatheGeometry(prof,32),
    new THREE.MeshPhysicalMaterial({color:RED,roughness:0.3,clearcoat:1,clearcoatRoughness:0.05}));
  sp.rotation.x=-Math.PI/2; sp.position.set(0,PROP_Y,PROP_Z+0.36);
  scene.add(sp);
}
const propU={time:{value:0},rev:{value:1},sunLocal:{value:new THREE.Vector3()},sunCol:{value:new THREE.Color()}};
const prop=new THREE.Mesh(new THREE.CircleGeometry(0.96,64),new THREE.ShaderMaterial({
  uniforms:propU,
  vertexShader:`varying vec2 vP; void main(){ vP=position.xy/0.96; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader:`
    uniform float time,rev; uniform vec3 sunLocal,sunCol; varying vec2 vP;
    void main(){
      float r=length(vP), a=atan(vP.y,vP.x);
      // three composite blades smeared into soft sectors, turning at the slow apparent rate
      float sec=pow(0.5+0.5*cos(3.0*(a-time*(0.7+rev*0.9))),6.0);
      float body=smoothstep(0.12,0.55,r)*(1.0-smoothstep(0.96,1.0,r));
      float tips=smoothstep(0.88,0.91,r)*(1.0-smoothstep(0.95,0.98,r));
      float alpha=body*(0.026+0.030*sec)+tips*0.028;
      vec3 col=mix(vec3(0.04,0.04,0.045),vec3(0.95,0.95,0.95),tips);
      // looking into the sun the disc lights up, as a real one does
      float back=pow(max(sunLocal.z,0.0),3.0);
      col+=sunCol*back*0.5*body;
      alpha+=back*0.05*body;
      gl_FragColor=vec4(col,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent:true, depthWrite:false, side:THREE.DoubleSide,
}));
prop.position.set(0,PROP_Y,PROP_Z);
prop.renderOrder=2; prop.userData.dynamic=true;
scene.add(prop);

// ---------- damage and grime, painted when it happens ----------
const Damage={dentN:0,oiled:false};
function paintDent(seed){
  const r=mulberry32(seed|0), x=cowlArt.ctx, w=1024, h=512;
  const u=(0.10+r()*0.30)*w, v=(0.38+r()*0.24)*h, rad=16+r()*24;
  x.save(); x.translate(u,v); x.rotate(r()*3);
  const g=x.createRadialGradient(-rad*0.3,-rad*0.3,2,0,0,rad);
  g.addColorStop(0,"rgba(255,255,255,0.4)"); g.addColorStop(0.5,"rgba(60,60,64,0.35)"); g.addColorStop(1,"rgba(60,60,64,0)");
  x.fillStyle=g; x.beginPath(); x.ellipse(0,0,rad,rad*0.7,0,0,7); x.fill();
  x.strokeStyle="rgba(40,40,44,0.6)"; x.lineWidth=1.4;                     // cracked gel coat
  for(let i=0;i<5;i++){ const a=r()*6.3, l=rad*(0.5+r()); x.beginPath(); x.moveTo(0,0); x.lineTo(Math.cos(a)*l,Math.sin(a)*l*0.6); x.stroke(); }
  x.restore();
  cowlArt.tex.needsUpdate=true;
}
function paintOil(){
  const r=mulberry32(4242), x=cowlArt.ctx;
  for(let i=0;i<6;i++){
    const u=(0.30+r()*0.45)*1024, v=(0.40+r()*0.20)*512;
    const g=x.createLinearGradient(u,0,u-160,0);
    g.addColorStop(0,"rgba(30,22,10,0.55)"); g.addColorStop(1,"rgba(30,22,10,0)");
    x.fillStyle=g; x.fillRect(u-160,v-4-r()*6,160,8+r()*8);
  }
  cowlArt.tex.needsUpdate=true;
}
function repaintCowl(){ paintCowl(cowlArt.ctx,1024,512); cowlArt.tex.needsUpdate=true; }
function drawGrime(t){
  const x=WS.grime.ctx, w=512, h=160;
  x.clearRect(0,0,w,h);
  for(const s of splats){
    const r=mulberry32((s.seed*1000)|0);
    const u=(0.2+r()*0.6)*w, v=(0.25+r()*0.5)*h, rad=10+s.r*1.4;
    x.fillStyle="rgba(109,106,74,0.75)"; x.beginPath(); x.ellipse(u,v,rad,rad*0.7,r()*3,0,7); x.fill();
    x.fillStyle="rgba(143,138,94,0.7)";
    for(let i=0;i<6;i++){ const a=r()*6.3, d=rad*(0.9+r()*0.9); x.beginPath(); x.arc(u+Math.cos(a)*d,v+Math.sin(a)*d*0.7,rad*0.2*(0.5+r()),0,7); x.fill(); }
  }
  if(Game.weather===2){
    if(Math.random()<0.5&&gDrops.length<80) gDrops.push({x:Math.random()*w,y:Math.random()*h*0.5,r:2+Math.random()*4,t0:t});
    for(let i=gDrops.length-1;i>=0;i--){
      const d=gDrops[i];
      d.y+=1.2+d.r*0.5;
      if(t-d.t0>5200||d.y>h){ gDrops.splice(i,1); continue; }
      x.fillStyle="rgba(200,220,240,0.35)"; x.beginPath(); x.arc(d.x,d.y,d.r,0,7); x.fill();
      x.fillStyle="rgba(255,255,255,0.55)"; x.fillRect(d.x-d.r*0.3,d.y-d.r*0.5,d.r*0.5,d.r*0.5);
    }
  }
  WS.grime.tex.needsUpdate=true;
}

// ---------- bake: every static part merged into one mesh per material ----------
// Built as dozens of small pieces, the cockpit costs a draw call apiece — and
// again for the shadow pass. Anything that never moves is flattened into its
// material's single mesh: the whole cockpit draws in a few dozen calls.
function bakeStatics(root){
  root.updateMatrixWorld(true);
  const groups=new Map();
  root.traverse(o=>{
    if(!o.isMesh) return;
    for(let p=o;p;p=p.parent) if(p.userData.dynamic) return;
    if(!groups.has(o.material)) groups.set(o.material,[]);
    groups.get(o.material).push(o);
  });
  for(const [mat,meshes] of groups){
    if(meshes.length<2) continue;
    const parts=meshes.map(m=>{
      let g=m.geometry.clone().applyMatrix4(m.matrixWorld);
      if(g.index) g=g.toNonIndexed();
      for(const k of Object.keys(g.attributes)) if(k!=="position"&&k!=="normal"&&k!=="uv") g.deleteAttribute(k);
      if(!g.attributes.uv) g.setAttribute("uv",new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
      if(!g.attributes.normal) g.computeVertexNormals();
      return g;
    });
    const merged=new THREE.Mesh(mergeGeometries(parts,false),mat);
    merged.castShadow=meshes.some(m=>m.castShadow);
    merged.receiveShadow=meshes.some(m=>m.receiveShadow);
    merged.renderOrder=Math.max(...meshes.map(m=>m.renderOrder));
    for(const m of meshes) m.parent.remove(m);
    for(const p of parts) p.dispose();
    root.add(merged);
  }
}
bakeStatics(scene);

// ---------- light, in the aircraft's frame ----------
const sun=new THREE.DirectionalLight(0xffffff,1);
sun.shadow.mapSize.set(1024,1024);
{ const c=sun.shadow.camera; c.left=-2.6; c.right=2.6; c.top=2.6; c.bottom=-2.6; c.near=0.1; c.far=20; }
sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.012; sun.shadow.radius=1;
sun.target.position.set(0,-0.3,-1.2);
scene.add(sun,sun.target);
const hemi=new THREE.HemisphereLight(0xffffff,0x444444,1);
scene.add(hemi);
Quality.onChange(spec=>{ sun.castShadow=spec.shadows; });

// Reflections: a sky-and-ground gradient, turned into an environment map for
// each time of day.
const pmrem=new THREE.PMREMGenerator(renderer);
let envRT=null;
function buildEnvironment(td){
  const s=new THREE.Scene();
  const geo=new THREE.SphereGeometry(10,32,16);
  const col=[], p=geo.attributes.position, c=new THREE.Color();
  const zen=new THREE.Color(td.zenith), hor=new THREE.Color(td.horizon), haze=new THREE.Color(td.haze),
        ground=new THREE.Color("#4a5a34");
  for(let i=0;i<p.count;i++){
    const y=p.getY(i)/10;
    if(y>0) c.copy(hor).lerp(zen,Math.pow(y,0.5));
    else c.copy(haze).lerp(ground,Math.min(1,-y*4));
    col.push(c.r,c.g,c.b);
  }
  geo.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
  s.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide})));
  const rt=pmrem.fromScene(s,0.02);
  if(envRT) envRT.dispose();
  envRT=rt;
  scene.environment=rt.texture;
  scene.environmentIntensity=0.9;
  geo.dispose();
}

const _qInv=new THREE.Quaternion(), _sunL=new THREE.Vector3(), _up=new THREE.Vector3();
let lastT=0, mapT=0, pfdT=0, grimeT=0;

export const Cockpit={
  scene, camera:cam,
  /** Rebuild the reflections for a time of day, and reset the G tell-tales. */
  setSky(td){ buildEnvironment(td); GM.hi=1; GM.lo=1; },
  /** Pose, light and animate the cockpit for this frame; returns the pass to render. */
  update(t){
    const dt=Math.min(0.1,Math.max(0,(t-lastT)/1000)); lastT=t;
    if(cam.fov!==camera.fov||cam.aspect!==camera.aspect){
      cam.fov=camera.fov; cam.aspect=camera.aspect; cam.updateProjectionMatrix();
    }
    // the pilot's head: lags the aircraft in a turn or a pull, and the airframe
    // buzzes with the engine and rumbles on the grass
    const hx=-clamp(P.vx*0.26,-26,26)*0.0006, hy=clamp(-P.vy*0.20,-18,18)*0.0006;
    const rumble=0.00035+Game.shake*0.004;
    cam.position.set(hx+Math.sin(t*0.093)*rumble,hy+Math.sin(t*0.131+1.3)*rumble,Math.sin(t*0.071)*rumble*0.5);
    cam.rotation.set(Math.sin(t*0.05)*Game.shake*0.004,0,Math.sin(t*0.063)*Game.shake*0.004);

    // the world's sun and sky, turned into the aircraft's frame
    _qInv.copy(camera.quaternion).invert();
    _sunL.copy(SUNDIR).applyQuaternion(_qInv);
    _up.set(0,1,0).applyQuaternion(_qInv);
    sun.color.copy(sunLight.color); sun.intensity=sunLight.intensity;
    sun.position.copy(sun.target.position).addScaledVector(_sunL,8);
    hemi.color.copy(hemiLight.color); hemi.groundColor.copy(hemiLight.groundColor);
    hemi.intensity=hemiLight.intensity; hemi.position.copy(_up);
    scene.environmentRotation.setFromQuaternion(_qInv);

    // load factor: the bank holds it in a turn, pulling up adds to it
    if(dt>0){
      const pull=(P.vy-GM.pvy)/dt/9.81; GM.pvy=P.vy;
      const want=Game.state===S.MENU?1:clamp(1/Math.max(0.2,Math.cos(clamp(P.roll,-1.4,1.4)))+pull*0.35,-4,9.5);
      GM.g+=(want-GM.g)*(1-Math.exp(-dt*5));
      if(Game.state===S.PLAY){ GM.hi=Math.max(GM.hi,GM.g); GM.lo=Math.min(GM.lo,GM.g); }
    }
    GM.needle.rotation.z=gAngle(GM.g);
    GM.tellHi.rotation.z=gAngle(GM.hi);
    GM.tellLo.rotation.z=gAngle(GM.lo);
    for(const l of lamps){
      const on=l.on()&&(!l.blink||Math.floor(t/260)%2===0);
      l.m.emissiveIntensity=on?3.0:0.10;
    }

    // the propeller
    prop.visible=Game.state!==S.MENU;
    propU.time.value=t*0.001;
    propU.rev.value=0.45+P.speed/SPEED_MAX*0.55;
    propU.sunLocal.value.copy(_sunL).multiplyScalar(-1);
    propU.sunCol.value.copy(sunLight.color);

    // damage as it happens
    if(dents.length<Damage.dentN||(P.lives>2&&Damage.oiled)){ repaintCowl(); Damage.dentN=0; Damage.oiled=false; }
    while(Damage.dentN<dents.length) paintDent(dents[Damage.dentN++].seed);
    if(P.lives<=2&&!Damage.oiled&&Game.state!==S.MENU){ paintOil(); Damage.oiled=true; }
    grimeT-=dt;
    if(splats.length!==WS.splatN||(Game.weather===2&&grimeT<=0)||(Game.weather!==2&&gDrops.length)){
      if(Game.weather!==2) gDrops.length=0;
      drawGrime(t); WS.splatN=splats.length; grimeT=0.066;
    }
    // the screens, each at the rate it needs
    pfdT-=dt; mapT-=dt;
    if(pfdT<=0){ drawPFD(); pfdT=1/30; }
    if(mapT<=0){ drawMap(); mapT=0.15; }
    drawRun();
    return this.pass;
  },
  pass:{scene,camera:cam}
};

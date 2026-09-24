// Skylark — the open cockpit, built in 3D.
//
// The cockpit is real geometry in metres around the pilot's eye (the origin,
// looking down -z), rendered in its own pass straight after the world into the
// same HDR target: the depth buffer is cleared between the two, so the nearest
// strut never fights the far hills for depth precision, and the cockpit goes
// through the same bloom and tone mapping as everything else.
//
// It lives in its own scene but under the world's light. Every frame the sun
// and the sky are rotated into the aircraft's frame, so the brass warms, the
// wing's shadow slides across the cowling and the glass flashes as she banks.
// Reflections come from a small environment map rebuilt from the sky for each
// time of day.
//
// Instruments are geometry too: dial faces painted once, needles, cards and
// balls that move, lamps that actually emit (and so bloom). The two boards on
// brackets at the front corners — the chart and the logbook card — are
// canvases redrawn a few times a second. Damage and grime are painted into the
// cowling and windscreen textures when they happen.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { renderer, camera } from '../view.js';
import { clamp, lerp, smooth, mulberry32 } from '../util.js';
import { G, Game, P, S, dents } from '../state.js';
import { SUNDIR } from '../sun.js';
import { Quality } from '../quality.js';
import { splats } from '../damage.js';
import { gDrops } from '../weather.js';
import { MAX_VX, MAX_Y, SPEED_MAX } from './config.js';
import { sunLight, hemiLight } from './sky.js';
import { Fuel, Haz, Rings, af, coursePathX } from './world.js';

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
const MONO="ui-monospace,Menlo,Consolas,monospace";

// ---------- materials ----------
const brass=std({color:"#d0a44a",metalness:1,roughness:0.32});
const steel=std({color:"#9a9c9a",metalness:1,roughness:0.38});
const leather=std({color:"#3b2616",roughness:0.62});
const strutPaint=std({color:"#7a6e58",roughness:0.55});
const darkMetal=std({color:"#2a2622",metalness:0.6,roughness:0.5});
const wireMat=std({color:"#3a3a38",metalness:0.5,roughness:0.5});
const stringerMat=std({color:"#6a4a2a",roughness:0.7});
const boardMat=std({color:"#3a2a18",roughness:0.6});
// Glass is drawn as reflection only, added over the view: diffuse black, so a
// pane is invisible except where it catches the sky or the sun, as real glass is.
const glass=std({color:0x000000,metalness:0,roughness:0.04,transparent:true,
  blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});

// ---------- the fuselage: decking and cowling, one skin from coaming to nose ----------
const Z_COAM=-0.50, Z_FIRE=-0.86, Z_NOSE=-2.36;
const PROP_Y=-0.44, PROP_Z=-2.52;
const cowlArt=canvasTex(1024,512,paintCowl);
function paintCowl(x,w,h){
  // u runs from the coaming (0) to the nose (1); v runs round the section,
  // bottom-left (0) over the top (0.5) to bottom-right (1)
  x.fillStyle="#3c5645"; x.fillRect(0,0,w,h);
  const rng=mulberry32(77);
  for(let i=0;i<900;i++){                                      // dope mottling
    x.fillStyle=`rgba(${rng()<0.5?"20,30,22":"120,140,120"},${0.025+rng()*0.035})`;
    x.beginPath(); x.arc(rng()*w,rng()*h,4+rng()*26,0,7); x.fill();
  }
  const uF=(Z_FIRE-Z_COAM)/(Z_NOSE-Z_COAM);
  // the decking forward of the coaming is plywood under the dope: slightly lighter
  x.fillStyle="rgba(150,160,130,0.10)"; x.fillRect(0,0,uF*w,h);
  // panel seams: the firewall line and the hinged top panels either side
  x.strokeStyle="rgba(12,18,14,0.75)"; x.lineWidth=2.2;
  x.beginPath(); x.moveTo(uF*w,0); x.lineTo(uF*w,h); x.stroke();
  for(const v of [0.36,0.64]){
    x.beginPath(); x.moveTo(uF*w,v*h); x.lineTo(w,v*h); x.stroke();
    x.strokeStyle="rgba(200,215,195,0.18)"; x.lineWidth=1;       // lit lip of the seam
    x.beginPath(); x.moveTo(uF*w,v*h+2); x.lineTo(w,v*h+2); x.stroke();
    x.strokeStyle="rgba(12,18,14,0.75)"; x.lineWidth=2.2;
  }
  // rivet rows along every seam
  x.fillStyle="rgba(10,14,11,0.8)";
  for(let u=uF*w+8;u<w;u+=14){ for(const v of [0.36,0.64]){ x.beginPath(); x.arc(u,v*h-6,1.6,0,7); x.fill(); x.beginPath(); x.arc(u,v*h+8,1.6,0,7); x.fill(); } }
  for(let v=10;v<h;v+=14){ x.beginPath(); x.arc(uF*w-6,v,1.6,0,7); x.fill(); x.beginPath(); x.arc(uF*w+8,v,1.6,0,7); x.fill(); }
  // cooling louvres on the side panels
  for(const vc of [0.20,0.80]){
    for(let i=0;i<7;i++){
      const u=(uF+0.06+i*0.045)*w, v=vc*h;
      x.fillStyle="rgba(8,10,8,0.85)"; x.fillRect(u,v-26,10,52);
      x.fillStyle="rgba(190,205,185,0.25)"; x.fillRect(u+10,v-26,2,52);
    }
  }
  // exhaust soot streaming back along the sides
  for(const vc of [0.16,0.84]){
    const g=x.createLinearGradient(0.62*w,0,0.1*w,0);
    g.addColorStop(0,"rgba(20,16,12,0.55)"); g.addColorStop(1,"rgba(20,16,12,0)");
    x.fillStyle=g; x.fillRect(0.1*w,vc*h-18,0.52*w,36);
  }
  // wear where hands and boots go, near the coaming
  x.fillStyle="rgba(170,175,150,0.12)";
  for(let i=0;i<40;i++){ x.fillRect(rng()*uF*w*1.6,0.35*h+rng()*0.3*h,2+rng()*10,1+rng()*2); }
}
function fuselageGeometry(){
  const NZ=36, NP=34;
  const pos=[], uv=[], idx=[];
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
const cowlMat=std({map:cowlArt.tex,roughness:0.5,metalness:0.22});
const fuselage=new THREE.Mesh(fuselageGeometry(),cowlMat);
fuselage.castShadow=true; fuselage.receiveShadow=true;
scene.add(fuselage);

// the fuselage sides alongside the cockpit, and their inner walls
{
  const side=std({color:"#3a5343",roughness:0.6,metalness:0.1});
  const inner=std({color:"#2a2016",roughness:0.9});
  for(const sx of [-1,1]){
    const o=new THREE.Mesh(new THREE.PlaneGeometry(1.3,0.85),side);
    o.position.set(sx*0.43,-0.70,0.12); o.rotation.y=sx*Math.PI/2;
    o.receiveShadow=true; scene.add(o);
    const lip=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.02,1.25),side);
    lip.position.set(sx*0.40,-0.283,0.10); lip.receiveShadow=true; scene.add(lip);
    const w=new THREE.Mesh(new THREE.PlaneGeometry(1.2,0.8),inner);
    w.position.set(sx*0.365,-0.68,0.10); w.rotation.y=-sx*Math.PI/2;
    w.receiveShadow=true; scene.add(w);
    for(let i=0;i<4;i++){                                   // wooden stringers inside
      const st=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.022,1.2),stringerMat);
      st.position.set(sx*0.355,-0.36-i*0.16,0.10); scene.add(st);
    }
  }
}

// ---------- the instrument panel ----------
const PW=0.37, PANEL_Z=-0.50;
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
  // maker's plate
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
  scene.add(panel);
}
// the padded leather roll round the opening
{
  const pts=[];
  for(let i=0;i<=16;i++){
    const x=-PW+i/16*2*PW, k=x/PW;
    pts.push(new THREE.Vector3(x,-0.194-0.040*k*k,PANEL_Z+0.012));
  }
  pts.push(new THREE.Vector3(0.39,-0.262,-0.36),new THREE.Vector3(0.39,-0.272,0.05),
    new THREE.Vector3(0.35,-0.272,0.55),new THREE.Vector3(0,-0.272,0.74),
    new THREE.Vector3(-0.35,-0.272,0.55),new THREE.Vector3(-0.39,-0.272,0.05),
    new THREE.Vector3(-0.39,-0.262,-0.36));
  const curve=new THREE.CatmullRomCurve3(pts,true,"centripetal");
  const roll=new THREE.Mesh(new THREE.TubeGeometry(curve,160,0.022,10,true),leather);
  roll.castShadow=true; roll.receiveShadow=true;
  scene.add(roll);
}

// ---------- instruments ----------
// All the dial faces share one atlas (4 x 2 cells of 256), so once baked they
// are a single draw.
const dialAtlas=canvasTex(1024,512,()=>{});
const dialMat=std({map:dialAtlas.tex,roughness:0.7});
let dialCells=0;
/** Paint a face into the next atlas cell; returns a CircleGeometry mapped onto it. */
function dialFace(r,paint){
  const cell=dialCells++, cx=(cell%4)*256, cy=Math.floor(cell/4)*256;
  const x=dialAtlas.ctx;
  x.save(); x.translate(cx,cy); x.beginPath(); x.rect(0,0,256,256); x.clip();
  paint(x,256);
  x.restore();
  dialAtlas.tex.needsUpdate=true;
  const g=new THREE.CircleGeometry(r,48);
  const uv=g.attributes.uv;
  // canvas rows run down, texture v runs up (flipY): cell row 0 is the top half
  for(let i=0;i<uv.count;i++) uv.setXY(i,(cell%4+uv.getX(i))/4,(1-Math.floor(cell/4)+uv.getY(i))/2);
  return g;
}
function paintDial(spec){
  return (x,w)=>{
    const c=w/2, r=w*0.47;
    const f=x.createRadialGradient(c-r*0.3,c-r*0.35,r*0.1,c,c,r);
    f.addColorStop(0,"#2e2a25"); f.addColorStop(1,"#0f0d0b");
    x.fillStyle=f; x.beginPath(); x.arc(c,c,r,0,7); x.fill();
    const a0=Math.PI*0.75, sw=Math.PI*1.5;
    if(spec.red!=null){
      x.strokeStyle="#c8362a"; x.lineWidth=r*0.09;
      x.beginPath(); x.arc(c,c,r*0.80,a0+sw*spec.red,a0+sw*(spec.redTo??1)); x.stroke();
    }
    const n=spec.ticks;
    for(let i=0;i<=n*2;i++){
      const a=a0+sw*i/(n*2), major=i%2===0;
      x.strokeStyle=major?"#ece4d0":"#a69e8c"; x.lineWidth=major?r*0.045:r*0.022;
      x.beginPath();
      x.moveTo(c+Math.cos(a)*r*(major?0.70:0.78),c+Math.sin(a)*r*(major?0.70:0.78));
      x.lineTo(c+Math.cos(a)*r*0.88,c+Math.sin(a)*r*0.88); x.stroke();
    }
    x.fillStyle="#ece4d0"; x.font="700 "+Math.round(r*0.19)+"px "+MONO;
    x.textAlign="center"; x.textBaseline="middle";
    spec.nums.forEach((t,i)=>{
      const a=a0+sw*i/(spec.nums.length-1);
      x.fillText(t,c+Math.cos(a)*r*0.54,c+Math.sin(a)*r*0.54);
    });
    x.fillStyle="#c9b98f"; x.font="600 "+Math.round(r*0.15)+"px "+MONO;
    x.fillText(spec.label,c,c+r*0.42);
    if(spec.unit){ x.fillStyle="#8a826f"; x.font="500 "+Math.round(r*0.11)+"px "+MONO; x.fillText(spec.unit,c,c-r*0.30); }
  };
}
function needleGeometry(r){
  const s=new THREE.Shape();
  s.moveTo(-r*0.20,-r*0.035); s.lineTo(r*0.80,-r*0.012); s.lineTo(r*0.86,0);
  s.lineTo(r*0.80,r*0.012); s.lineTo(-r*0.20,r*0.035); s.closePath();
  return new THREE.ShapeGeometry(s);
}
const needleMat=std({color:"#f2ead6",roughness:0.4,emissive:"#f2ead6",emissiveIntensity:0.06});
const gauges=[];
function gauge(spec,x,y,r){
  const g=new THREE.Group();
  g.position.set(x,y,PANEL_Z+0.004);
  const face=new THREE.Mesh(dialFace(r,paintDial(spec)),dialMat);
  face.receiveShadow=true;
  const bezel=new THREE.Mesh(new THREE.TorusGeometry(r*1.04,r*0.085,12,48),brass);
  bezel.position.z=0.004; bezel.castShadow=true; bezel.receiveShadow=true;
  const needle=new THREE.Mesh(needleGeometry(r),needleMat);
  needle.position.z=0.006; needle.userData.dynamic=true;
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(r*0.09,r*0.09,0.006,16),darkMetal);
  hub.rotation.x=Math.PI/2; hub.position.z=0.008;
  const lens=new THREE.Mesh(new THREE.CircleGeometry(r*1.0,32),glass);
  lens.position.z=0.012;
  g.add(face,bezel,needle,hub,lens);
  scene.add(g);
  const o={needle,value:spec.start??0,read:spec.read};
  gauges.push(o);
  return o;
}
const GY=-0.292, GR=0.047;
gauge({label:"A.S.I.",unit:"KM/H",ticks:7,nums:["0","60","120","180","240","300","360","420"].slice(0,8),red:0.9,
       read:()=>clamp(P.speed/SPEED_MAX,0,1)},-0.215,GY,GR);
gauge({label:"ALTIMETER",unit:"x10 M",ticks:5,nums:["0","8","16","24","32","40"],
       read:()=>clamp(P.y/MAX_Y,0,1)},-0.107,GY,GR);
gauge({label:"FUEL",ticks:4,nums:["E","¼","½","¾","F"],red:0,redTo:0.2,
       read:()=>clamp(G.fuel/100,0,1)},0.107,GY,GR);
gauge({label:"R.P.M.",unit:"x100",ticks:6,nums:["0","5","10","15","20","25","30"],red:0.88,
       read:t=>0.70+Math.sin(t*0.011)*0.012+(P.speed/SPEED_MAX)*0.22},0.215,GY,GR);

// turn & bank in the middle
const TB={};
{
  const r=0.052;
  const g=new THREE.Group(); g.position.set(0,GY-0.004,PANEL_Z+0.004);
  const faceGeo=dialFace(r,(x,w)=>{
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
  const faceM=new THREE.Mesh(faceGeo,dialMat);
  const bezel=new THREE.Mesh(new THREE.TorusGeometry(r*1.04,r*0.085,12,48),brass);
  bezel.position.z=0.004; bezel.castShadow=true;
  // the little aeroplane that banks with you
  const plane=new THREE.Group(); plane.position.set(0,r*0.18,0.007);
  const wingBar=new THREE.Mesh(new THREE.BoxGeometry(r*1.25,r*0.07,0.002),needleMat);
  const fin=new THREE.Mesh(new THREE.BoxGeometry(r*0.07,r*0.28,0.002),needleMat); fin.position.y=r*0.14;
  const dot=new THREE.Mesh(new THREE.CircleGeometry(r*0.08,16),needleMat);
  plane.add(wingBar,fin,dot);
  plane.userData.dynamic=true;
  // the slip ball in its curved glass tube
  const tube=new THREE.Mesh(new THREE.TorusGeometry(r*1.25,r*0.11,8,24,Math.PI*0.4),
    std({color:"#3a3630",roughness:0.3,transparent:true,opacity:0.85}));
  tube.position.set(0,r*0.72,0.006); tube.rotation.z=-Math.PI*0.7;
  const ball=new THREE.Mesh(new THREE.SphereGeometry(r*0.09,12,10),std({color:"#e8e0c8",roughness:0.3}));
  ball.userData.dynamic=true;
  const lens=new THREE.Mesh(new THREE.CircleGeometry(r,32),glass); lens.position.z=0.014;
  g.add(faceM,bezel,plane,tube,ball,lens);
  scene.add(g);
  Object.assign(TB,{r,plane,ball,slip:0});
}

// warning lamps on a brass bar on the decking, left of the compass, in the
// pilot's eyeline rather than down on the panel
const lamps=[];
{
  const bar=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.026,0.02),darkMetal);
  bar.position.set(-0.115,-0.202,-0.575); bar.rotation.x=-0.35;
  bar.castShadow=true; bar.receiveShadow=true; scene.add(bar);
  const specs=[["FUEL","#ffae3a",()=>G.fuel<20],["TERR","#ff5a4e",()=>Game.warnObst],
               ["GEAR","#8fe8a0",()=>af.active&&(af.phase===1||af.phase===2||af.phase===4)]];
  specs.forEach(([label,col,on],i)=>{
    const art=canvasTex(128,64,(x,w,h)=>{
      x.fillStyle=col; x.fillRect(0,0,w,h);
      x.fillStyle="rgba(20,14,8,0.85)"; x.font="800 30px "+MONO;
      x.textAlign="center"; x.textBaseline="middle"; x.fillText(label,w/2,h/2+2);
    });
    const m=std({map:art.tex,emissive:col,emissiveMap:art.tex,emissiveIntensity:0,roughness:0.3});
    m.color.setScalar(0.35);
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(0.036,0.018,0.006),m);
    lamp.position.set(-0.162+i*0.047,-0.200,-0.563); lamp.rotation.x=-0.35;
    const rim=new THREE.Mesh(new THREE.BoxGeometry(0.041,0.023,0.004),brass);
    rim.position.set(-0.162+i*0.047,-0.200,-0.565); rim.rotation.x=-0.35;
    scene.add(rim,lamp);
    lamps.push({m,on,blink:i<2});
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
  scene.add(g);
  Object.assign(Compass,{card});
}

// ---------- windscreen ----------
const WS={};
{
  const R=0.36, CZ=-0.30, PHI=0.56, NU=20, NV=6;
  const shape=(u,v)=>{                                   // u,v in 0..1
    const phi=(u-0.5)*2*PHI;
    const yb=-0.212, yt=-0.045-0.055*Math.pow((u-0.5)*2,2);
    const y=lerp(yb,yt,v);
    const lean=(y-yb)*0.34;
    return new THREE.Vector3(R*Math.sin(phi), y, CZ-R*Math.cos(phi)+lean);
  };
  const pos=[], uv=[], idx=[];
  for(let i=0;i<=NU;i++) for(let j=0;j<=NV;j++){ const p=shape(i/NU,j/NV); pos.push(p.x,p.y,p.z); uv.push(i/NU,j/NV); }
  for(let i=0;i<NU;i++) for(let j=0;j<NV;j++){ const a=i*(NV+1)+j, b=a+NV+1; idx.push(a,b,a+1, a+1,b,b+1); }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geo.setIndex(idx); geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo,glass));
  // grime on the glass: bird strikes and rain, painted as they happen
  const grime=canvasTex(512,160,()=>{});
  const gm=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:grime.tex,transparent:true,
    roughness:0.4,depthWrite:false,side:THREE.DoubleSide}));
  gm.renderOrder=1;
  scene.add(gm);
  // the frame: a polished strip up each side and over the top
  const edge=[];
  for(let i=0;i<=NU;i++) edge.push(shape(i/NU,1));
  const top=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge),40,0.006,6),brass);
  const sides=[0,1].map(s=>new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.LineCurve3(shape(s,0),shape(s,1)),4,0.007,6),brass));
  for(const m of [top,...sides]){ m.castShadow=true; scene.add(m); }
  Object.assign(WS,{grime,splatN:0,dropT:0});
}

// ---------- the parasol wing, its struts and wires ----------
const WING_Y=0.70, LE_Z=-1.08, TE_Z=0.36, SPAN=4.9;
const wingArt=canvasTex(2048,512,(x,w,h)=>{
  // u: span from -SPAN (0) to +SPAN (1); v: chord from leading edge (0) to trailing (1)
  x.fillStyle="#d8cfb3"; x.fillRect(0,0,w,h);
  const px=m=>(m+SPAN)/(2*SPAN)*w;
  // rib tapes every 30 cm, pinked and stitched
  for(let m=-SPAN;m<=SPAN;m+=0.30){
    const u=px(m);
    x.fillStyle="rgba(120,108,80,0.30)"; x.fillRect(u-4,0,8,h);
    x.fillStyle="rgba(250,244,226,0.35)"; x.fillRect(u-2,0,4,h);
    x.fillStyle="rgba(90,80,60,0.45)";
    for(let v=6;v<h;v+=12) x.fillRect(u-0.5,v,1.2,3);
  }
  // spars showing through the fabric as shadow bands
  for(const v of [0.22,0.64]){ x.fillStyle="rgba(90,80,55,0.16)"; x.fillRect(0,v*h-10,w,20); }
  // ailerons outboard, and a pinked tape along the trailing edge
  x.strokeStyle="rgba(80,70,50,0.55)"; x.lineWidth=2;
  for(const s of [-1,1]){
    const a=px(s*2.6), b=px(s*SPAN*0.98);
    x.beginPath(); x.moveTo(a,0.80*h); x.lineTo(b,0.80*h); x.moveTo(a,0.80*h); x.lineTo(a,h); x.stroke();
  }
  // roundels, outboard of the cabane, where the pilot can see them
  for(const s of [-1,1]){
    const u=px(s*1.35), v=0.47*h, rr=0.33/(2*SPAN)*w;
    x.save(); x.translate(u,v); x.scale(1,(2*SPAN/1.44)*(h/w)); // round on the wing, not in texels
    x.fillStyle="#2b4f86"; x.beginPath(); x.arc(0,0,rr,0,7); x.fill();
    x.fillStyle="#f2ecd8"; x.beginPath(); x.arc(0,0,rr*0.64,0,7); x.fill();
    x.fillStyle="#c33a28"; x.beginPath(); x.arc(0,0,rr*0.30,0,7); x.fill();
    x.restore();
  }
  // weathering
  const rng=mulberry32(19);
  for(let i=0;i<300;i++){ x.fillStyle=`rgba(90,80,60,${rng()*0.05})`; x.fillRect(rng()*w,rng()*h,10+rng()*60,2+rng()*8); }
});
const wingMat=std({map:wingArt.tex,roughness:0.85,emissive:"#fff1d6",emissiveMap:wingArt.tex,emissiveIntensity:0});
const wing=new THREE.Group();
{
  // the underside, with the cut-out over the cockpit so the pilot can see up
  const s=new THREE.Shape();
  const NOTCH=0.42, NZ=-0.02;
  s.moveTo(-SPAN,LE_Z); s.lineTo(SPAN,LE_Z); s.lineTo(SPAN,TE_Z); s.lineTo(NOTCH+0.12,TE_Z);
  s.quadraticCurveTo(NOTCH,NZ,0,NZ); s.quadraticCurveTo(-NOTCH,NZ,-NOTCH-0.12,TE_Z);
  s.lineTo(-SPAN,TE_Z); s.closePath();
  const g=new THREE.ShapeGeometry(s,12);
  const p=g.attributes.position, uv=g.attributes.uv;
  for(let i=0;i<p.count;i++) uv.setXY(i,(p.getX(i)+SPAN)/(2*SPAN),(p.getY(i)-LE_Z)/(TE_Z-LE_Z));
  g.rotateX(Math.PI/2);                                  // shape y -> world z, facing down
  const under=new THREE.Mesh(g,wingMat);
  under.position.y=WING_Y; under.castShadow=true; under.receiveShadow=true;
  wing.add(under);
  // the rounded leading edge and a thin trailing edge, so it has thickness
  const le=new THREE.Mesh(new THREE.CylinderGeometry(0.075,0.075,SPAN*2,16),
    std({color:"#cfc6aa",roughness:0.8}));
  le.rotation.z=Math.PI/2; le.position.set(0,WING_Y+0.075,LE_Z); le.castShadow=true;
  const teTape=new THREE.Mesh(new THREE.BoxGeometry(SPAN*2,0.012,0.02),std({color:"#b8ae90",roughness:0.8}));
  teTape.position.set(0,WING_Y+0.01,TE_Z);
  wing.add(le,teTape);
}
scene.add(wing);
function strut(a,b,w,d,mat){
  const len=a.distanceTo(b);
  const m=new THREE.Mesh(new THREE.CylinderGeometry(1,1,len,12),mat);
  m.scale.set(w,1,d);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());
  m.castShadow=true; m.receiveShadow=true;
  scene.add(m);
  return m;
}
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
for(const sx of [-1,1]){
  // cabane struts from the top longerons up to the centre section
  // (the rear pair stands behind the pilot's shoulders, out of view)
  strut(V3(sx*0.33,-0.25,-0.84),V3(sx*0.25,WING_Y,-0.86),0.011,0.008,strutPaint);
  strut(V3(sx*0.36,-0.27,0.42),V3(sx*0.25,WING_Y,0.12),0.011,0.008,strutPaint);
  // the lift struts: a faired V from the lower longeron out to the wing
  strut(V3(sx*0.42,-1.00,-0.95),V3(sx*2.30,WING_Y,-0.86),0.024,0.009,strutPaint);
  strut(V3(sx*0.42,-1.00,-0.45),V3(sx*2.30,WING_Y,-0.02),0.024,0.009,strutPaint);
  // one flying wire each side, from the cabane foot out under the wing
  strut(V3(sx*0.33,-0.25,-0.84),V3(sx*1.55,WING_Y,-0.95),0.0017,0.0017,wireMat);
}

// ---------- engine details: spinner, exhaust stacks, filler cap ----------
{
  const sp=new THREE.Mesh(new THREE.SphereGeometry(0.13,24,16,0,Math.PI*2,0,Math.PI*0.5),
    std({color:"#e4d9bd",roughness:0.35,metalness:0.3}));
  sp.rotation.x=-Math.PI/2; sp.scale.set(1,1.7,1); sp.position.set(0,PROP_Y,PROP_Z+0.02);
  scene.add(sp);
  const exMat=std({color:"#5a4436",metalness:0.7,roughness:0.55});
  for(const sx of [-1,1]) for(let i=0;i<2;i++){
    const e=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.026,0.20,12),exMat);
    e.position.set(sx*(0.36-i*0.01),-0.42,-1.30-i*0.28);
    e.rotation.set(0.9,0,sx*1.1);
    e.castShadow=true; scene.add(e);
  }
  const capM=new THREE.Mesh(new THREE.CylinderGeometry(0.032,0.036,0.018,20),steel);
  capM.position.set(-0.10,-0.255,-1.45); capM.rotation.x=-0.07;
  capM.castShadow=true; scene.add(capM);
}

// ---------- the propeller: a disc of blur, not blades ----------
const propU={time:{value:0},rev:{value:1},sunLocal:{value:new THREE.Vector3()},sunCol:{value:new THREE.Color()}};
const prop=new THREE.Mesh(new THREE.CircleGeometry(0.98,64),new THREE.ShaderMaterial({
  uniforms:propU,
  vertexShader:`varying vec2 vP; void main(){ vP=position.xy/0.98; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader:`
    uniform float time,rev; uniform vec3 sunLocal,sunCol; varying vec2 vP;
    void main(){
      float r=length(vP), a=atan(vP.y,vP.x);
      // two blades smeared into soft sectors, turning at the slow apparent rate
      float sec=pow(0.5+0.5*cos(2.0*(a-time*(0.7+rev*0.9))),6.0);
      float body=smoothstep(0.10,0.55,r)*(1.0-smoothstep(0.96,1.0,r));
      float alpha=body*(0.030+0.035*sec)+smoothstep(0.90,0.93,r)*(1.0-smoothstep(0.95,0.98,r))*0.055;
      vec3 col=mix(vec3(0.05,0.045,0.04),vec3(0.85,0.64,0.20),smoothstep(0.90,0.93,r));
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
prop.userData.dynamic=true;
prop.renderOrder=2;
scene.add(prop);

// ---------- the two boards: chart on the left, logbook card on the right ----------
function board(sx){
  const g=new THREE.Group();
  const art=canvasTex(384,288,()=>{});
  const back=new THREE.Mesh(new THREE.BoxGeometry(0.205,0.158,0.008),boardMat);
  const paper=new THREE.Mesh(new THREE.PlaneGeometry(0.19,0.1425),std({map:art.tex,roughness:0.9,
    emissive:"#ffffff",emissiveMap:art.tex,emissiveIntensity:0.05}));
  paper.position.z=0.0045;
  const clip=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.016,0.012),brass);
  clip.position.set(0,0.071,0.008);
  const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,0.16,8),darkMetal);
  arm.position.set(-sx*0.07,-0.13,-0.02); arm.rotation.z=sx*0.5;
  g.add(back,paper,clip,arm);
  for(const m of [back,clip,arm]){ m.castShadow=true; m.receiveShadow=true; }
  paper.receiveShadow=true;
  // placed low in the front corner, turned to face the pilot
  g.position.set(sx*0.325,-0.192,-0.365);
  g.lookAt(0,0.02,0);
  g.rotateX(-0.12);
  scene.add(g);
  return {art,key:""};
}
const chart=board(-1), logbook=board(1);

function drawChart(){
  const x=chart.art.ctx, w=384, h=288;
  x.fillStyle="#e9ddc0"; x.fillRect(0,0,w,h);
  const RANGE=1500, HALF=560;
  const map=(wx,wz)=>({x:w/2+(wx-P.x)/HALF*(w/2), y:h-((P.z-wz)/RANGE)*h});
  x.strokeStyle="rgba(150,130,95,0.45)"; x.lineWidth=1.2;
  for(let i=0;i<7;i++){
    x.beginPath();
    for(let j=0;j<=10;j++){
      const wz=P.z-RANGE*(j/10), p=map(P.x-HALF+(i/6)*HALF*2+Math.sin(wz*0.002+i)*40,wz);
      j?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y);
    }
    x.stroke();
  }
  x.strokeStyle="#8a4a2a"; x.lineWidth=2.4; x.beginPath();
  for(let j=0;j<=24;j++){ const wz=P.z-RANGE*(j/24), p=map(coursePathX(wz),wz); j?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y); }
  x.stroke();
  for(const r of Rings.list){
    if(!r.active||r.z>P.z||P.z-r.z>RANGE) continue;
    const p=map(r.x,r.z);
    x.strokeStyle=r.hit?"#3f8f4f":(r.gold?"#c08a12":"#c33a28"); x.lineWidth=r.gold?3.4:2.4;
    x.beginPath(); x.arc(p.x,p.y,r.gold?6:4.6,0,7); x.stroke();
  }
  x.fillStyle="#2f7f4f";
  for(const f of Fuel.list){ if(!f.active||f.z>P.z||P.z-f.z>RANGE) continue; const p=map(f.x,f.z); x.fillRect(p.x-3.5,p.y-3.5,7,7); }
  x.fillStyle="#7a2a1a";
  for(const l of [Haz.masts,Haz.turbines,Haz.balloons]) for(const hz of l){
    if(!hz.active||hz.z>P.z||P.z-hz.z>RANGE) continue; const p=map(hz.x,hz.z); x.fillRect(p.x-2.5,p.y-2.5,5,5);
  }
  x.strokeStyle="#7a2a1a"; x.lineWidth=2;
  for(const hz of Haz.lines){
    if(!hz.active||hz.z>P.z||P.z-hz.z>RANGE) continue;
    const a=map(hz.x-hz.span/2,hz.z), b=map(hz.x+hz.span/2,hz.z);
    x.beginPath(); x.moveTo(a.x,a.y); x.lineTo(b.x,b.y); x.stroke();
  }
  if(af.active&&af.z<P.z&&P.z-af.z<RANGE+af.len){
    const a=map(af.x,af.z+af.len/2), b=map(af.x,af.z-af.len/2);
    x.strokeStyle="#1a1a1a"; x.lineWidth=6; x.beginPath(); x.moveTo(a.x,a.y); x.lineTo(b.x,b.y); x.stroke();
  }
  const me=map(P.x,P.z);
  x.fillStyle="#20180e"; x.beginPath();
  x.moveTo(me.x,me.y-10); x.lineTo(me.x-7,me.y+5); x.lineTo(me.x+7,me.y+5); x.closePath(); x.fill();
  x.fillStyle="rgba(90,70,40,0.7)"; x.font="700 18px "+MONO; x.textAlign="left"; x.textBaseline="alphabetic";
  x.fillText("CHART",10,h-10);
  chart.art.tex.needsUpdate=true;
}
function drawLogbook(){
  const lvlLen=5000+700*G.lvl;
  const prog=clamp(1-(G.levelEnd-P.dist)/lvlLen,0,1);
  const key=[Math.floor(G.score),G.ringsHit,G.rings,G.combo,G.lvl,(P.dist/1000).toFixed(2),P.lives,Math.round(prog*100)].join("|");
  if(key===logbook.key) return;
  logbook.key=key;
  const x=logbook.art.ctx, w=384, h=288;
  x.fillStyle="#efe4c8"; x.fillRect(0,0,w,h);
  x.strokeStyle="rgba(150,120,80,0.35)"; x.lineWidth=1;
  for(let y=58;y<h;y+=38){ x.beginPath(); x.moveTo(14,y); x.lineTo(w-14,y); x.stroke(); }
  x.fillStyle="#7a2a1a"; x.fillRect(14,14,w-28,4);
  x.textBaseline="middle";
  x.fillStyle="#2a1c10"; x.font="800 44px "+MONO; x.textAlign="left";
  x.fillText(Math.floor(G.score).toLocaleString(),18,82);
  x.fillStyle="#6a5a44"; x.font="700 18px "+MONO; x.textAlign="right"; x.fillText("SCORE",w-18,40);
  x.textAlign="left"; x.fillStyle="#2a1c10"; x.font="700 26px "+MONO;
  x.fillText("RINGS "+G.ringsHit+"/"+G.rings+(G.combo>1?"  x"+G.combo:""),18,134);
  x.fillText("S"+G.lvl+"   "+(P.dist/1000).toFixed(2)+" km",18,172);
  x.fillStyle=P.lives<=1?"#b02a1a":"#2a5a2a";
  x.fillText("AIRFRAME "+"■".repeat(Math.max(0,P.lives))+"□".repeat(Math.max(0,3-P.lives)),18,210);
  x.fillStyle="rgba(40,28,14,0.25)"; x.fillRect(18,244,w-36,14);
  x.fillStyle="#c08a2a"; x.fillRect(18,244,(w-36)*prog,14);
  x.fillStyle="#6a5a44"; x.font="700 15px "+MONO; x.fillText("SECTOR",18,272);
  logbook.art.tex.needsUpdate=true;
}

// ---------- damage and grime, painted when it happens ----------
const Damage={dentN:0,oiled:false};
function paintDent(seed){
  const r=mulberry32(seed|0), x=cowlArt.ctx, w=1024, h=512;
  const u=(0.12+r()*0.30)*w, v=(0.38+r()*0.24)*h, rad=18+r()*26;
  x.save(); x.translate(u,v); x.rotate(r()*3);
  const g=x.createRadialGradient(-rad*0.3,-rad*0.3,2,0,0,rad);
  g.addColorStop(0,"rgba(210,220,200,0.30)"); g.addColorStop(0.5,"rgba(10,14,10,0.35)"); g.addColorStop(1,"rgba(10,14,10,0)");
  x.fillStyle=g; x.beginPath(); x.ellipse(0,0,rad,rad*0.7,0,0,7); x.fill();
  x.strokeStyle="rgba(200,205,190,0.55)"; x.lineWidth=1.4;                // paint scraped to bare metal
  for(let i=0;i<5;i++){ const a=r()*6.3, l=rad*(0.5+r()); x.beginPath(); x.moveTo(0,0); x.lineTo(Math.cos(a)*l,Math.sin(a)*l*0.6); x.stroke(); }
  x.restore();
  cowlArt.tex.needsUpdate=true;
}
function paintOil(){
  const r=mulberry32(4242), x=cowlArt.ctx;
  for(let i=0;i<6;i++){
    const u=(0.30+r()*0.45)*1024, v=(0.40+r()*0.20)*512;
    const g=x.createLinearGradient(u,0,u-140,0);
    g.addColorStop(0,"rgba(20,14,6,0.55)"); g.addColorStop(1,"rgba(20,14,6,0)");
    x.fillStyle=g; x.fillRect(u-140,v-4-r()*6,140,8+r()*8);
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
sun.target.position.set(0,-0.2,-1.0);
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
  scene.environmentIntensity=0.85;
  geo.dispose();
}

const _qInv=new THREE.Quaternion(), _sunL=new THREE.Vector3(), _up=new THREE.Vector3();
let lastT=0, boardT=0, grimeT=0;

export const Cockpit={
  scene, camera:cam,
  /** Rebuild the reflections for a time of day (sky.js calls this). */
  setSky(td){ buildEnvironment(td); },
  /** Pose, light and animate the cockpit for this frame; returns the pass to render. */
  update(t){
    const dt=Math.min(0.1,Math.max(0,(t-lastT)/1000)); lastT=t;
    if(cam.fov!==camera.fov||cam.aspect!==camera.aspect){
      cam.fov=camera.fov; cam.aspect=camera.aspect; cam.updateProjectionMatrix();
    }
    // the pilot's head: lags the aircraft in a turn or a pull, and the airframe
    // rumbles with the engine and on the grass
    const hx=-clamp(P.vx*0.26,-26,26)*0.0006, hy=clamp(-P.vy*0.20,-18,18)*0.0006;
    const rumble=0.00045+Game.shake*0.004;
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
    // doped linen glows when the sun is above the wing
    wingMat.emissiveIntensity=0.10+Math.max(0,_sunL.y)*0.45;

    // instruments, each with a little lag, as real needles have
    const k=1-Math.exp(-dt*7);
    for(const g of gauges){
      g.value+=(g.read(t)-g.value)*k;
      g.needle.rotation.z=-(Math.PI*0.75+Math.PI*1.5*clamp(g.value,0,1.02));
    }
    TB.plane.rotation.z=P.roll*0.9;
    TB.slip+=(clamp((P.vx/MAX_VX)-P.roll*2.1,-1,1)-TB.slip)*(1-Math.exp(-dt*4));
    const ba=-Math.PI*0.5-TB.slip*Math.PI*0.18;           // the ball runs away from the turn
    TB.ball.position.set(Math.cos(ba)*TB.r*1.25,TB.r*0.72+Math.sin(ba)*TB.r*1.25,0.010);
    const head=(-P.roll*26+Game.wind*0.5+360)%360;
    Compass.card.rotation.y=head*Math.PI/180;
    for(const l of lamps){
      const on=l.on()&&(!l.blink||Math.floor(t/260)%2===0);
      l.m.emissiveIntensity=on?3.2:0;
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
    // the boards, a few times a second
    boardT-=dt;
    if(boardT<=0){ drawChart(); boardT=0.15; }
    drawLogbook();
    return this.pass;
  },
  pass:{scene,camera:cam}
};

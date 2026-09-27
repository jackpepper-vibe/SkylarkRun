// Wayfarer — the cabin of a high-wing four-seat tourer, from the left seat.
//
// The pilot sits left of the centreline, so the whole cabin is offset to the
// right of the eye: the left windscreen pillar close by, the right one far
// out. Through the raked windscreen the white nose runs down to the spinner;
// overhead is the headliner with a wet compass hanging from the windscreen
// frame and the sun visors folded up. The panel is the classic layout — the
// six basic instruments in front of the pilot, the radio stack with a moving
// map in the middle, engine gauges and a run page on the right — under a
// padded glare shield, with a yoke for each seat that turns and slides with
// the controls. Rain on this screen streams back across it rather than running
// down, and inside the cabin it is quieter and dimmer than in an open cockpit.
import * as THREE from 'three';
import { clamp, lerp } from '../../util.js';
import { Game, P, S } from '../../state.js';
import { Aircraft } from '../aircraft.js';
import { SANS, MONO, V3, bakeStatics, canvasTex, cowlDamage, dialSet, drawMap, drawRun, fuselageSkin,
         glassMaterial, grime, LAMPS, propeller, read, runKey, std, surface, tube, updateLamps } from './kit.js';

const CX=0.27;                         // the cabin's centreline, right of the pilot's eye
const XL=-0.26, XR=0.80;               // inside of the left and right walls
const PZ=-0.66;                        // the panel face
const GS=-0.160;                       // the glare shield's edge over the panel
const WS0={y:-0.18,z:-0.86}, WS1={y:0.30,z:-0.40};   // windscreen foot and head
const ROOF=0.32;
const PROP={x:CX,y:-0.47,z:-2.40};

function paintCowl(x,w,h){
  // u from the windscreen (0) to the nose (1); v round the section
  x.fillStyle="#f2f1ec"; x.fillRect(0,0,w,h);
  const g=x.createLinearGradient(0,0,w,0);
  g.addColorStop(0,"rgba(0,0,0,0.05)"); g.addColorStop(1,"rgba(0,0,0,0)");
  x.fillStyle=g; x.fillRect(0,0,w,h);
  // the livery: a navy stripe with a gold pinstripe, swept along each side
  for(const s of [1,-1]){
    const v0=s>0?0.18:0.82;
    x.fillStyle="#1d3a6a"; x.beginPath();
    x.moveTo(0,(v0-0.05*s)*h); x.lineTo(w,(v0+0.03*s)*h); x.lineTo(w,(v0+0.10*s)*h); x.lineTo(0,(v0+0.02*s)*h); x.closePath(); x.fill();
    x.fillStyle="#d6a93a"; x.fillRect(0,(v0+0.035*s)*h-2,w,4);
  }
  // cowling seams, fasteners and the oil door
  x.strokeStyle="rgba(60,62,66,0.5)"; x.lineWidth=2;
  x.beginPath(); x.moveTo(0.22*w,0); x.lineTo(0.22*w,h); x.stroke();
  x.beginPath(); x.moveTo(0.22*w,h*0.5); x.lineTo(w,h*0.5); x.stroke();
  x.fillStyle="rgba(90,92,96,0.8)";
  for(let u=0.24*w;u<w;u+=36){ x.beginPath(); x.arc(u,h*0.5-6,2,0,7); x.fill(); x.beginPath(); x.arc(u,h*0.5+6,2,0,7); x.fill(); }
  x.strokeStyle="rgba(60,62,66,0.45)"; x.strokeRect(0.36*w,0.40*h,90,36);
}

export function build(){
  const root=new THREE.Group();
  const vinyl=std({color:"#1f2023",roughness:0.85});
  const panelPaint=std({color:"#2b2d31",roughness:0.7});
  const trim=std({color:"#b3ab9c",roughness:0.75});
  const headliner=std({color:"#cfcbc2",roughness:0.95});
  const chrome=std({color:"#c8ccd0",metalness:1,roughness:0.22});
  const black=std({color:"#101012",roughness:0.5});
  const glass=glassMaterial(0.03);

  // ---------- the nose through the windscreen ----------
  const cowlArt=canvasTex(1024,512,paintCowl);
  {
    const skin=new THREE.Mesh(fuselageSkin(WS0.z+0.02,-2.28,k=>lerp(0.52,0.30,Math.pow(k,1.4)),
      k=>lerp(-0.225,-0.38,Math.pow(k,1.2)),0.55,-1.2),
      new THREE.MeshPhysicalMaterial({map:cowlArt.tex,roughness:0.35,clearcoat:0.6,clearcoatRoughness:0.15}));
    skin.position.x=CX; skin.castShadow=true; skin.receiveShadow=true;
    root.add(skin);
    const prof=[];
    for(let i=0;i<=14;i++){ const k=i/14; prof.push(new THREE.Vector2(0.15*Math.pow(1-k,0.55),k*0.30)); }
    const sp=new THREE.Mesh(new THREE.LatheGeometry(prof,28),
      new THREE.MeshPhysicalMaterial({color:"#f2f1ec",roughness:0.3,clearcoat:1}));
    sp.rotation.x=-Math.PI/2; sp.position.set(PROP.x,PROP.y,PROP.z+0.10); root.add(sp);
  }
  const damage=cowlDamage(cowlArt,()=>paintCowl(cowlArt.ctx,1024,512),{style:"metal",region:[0.08,0.45,0.38,0.62]});
  const prop=propeller(root,{radius:0.95,blades:2,tip:"#f2f2f2",hub:0.12,x:PROP.x,y:PROP.y,z:PROP.z});

  // ---------- the windscreen, its pillars, the roof and the doors ----------
  const dirt=grime(640,320,{run:"up"});
  const wsAt=(u,v)=>{
    const x=lerp(XL,XR,u), bow=Math.sin(u*Math.PI)*0.10;          // bowed out in the middle
    return V3(x, lerp(WS0.y,WS1.y,v), lerp(WS0.z,WS1.z,v)-bow*(1-v*0.6));
  };
  {
    const geo=surface(20,8,wsAt);
    root.add(new THREE.Mesh(geo,glass));
    const tint=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:"#2a3a3a",transparent:true,opacity:0.10,
      depthWrite:false,side:THREE.DoubleSide}));
    root.add(tint);
    const gm=new THREE.Mesh(geo,dirt.mat); gm.renderOrder=1; gm.userData.dynamic=true; root.add(gm);
    // the pillars, and the header and sill of the frame
    for(const u of [0,1]){
      const pts=[wsAt(u,0),wsAt(u,0.5),wsAt(u,1)];
      tube(root,pts.map(p=>p.clone().add(V3(u?-0.018:0.018,0,0.01))),0.030,trim,false,12);
    }
    const header=[]; for(let i=0;i<=12;i++) header.push(wsAt(i/12,1).add(V3(0,0.012,0.012)));
    tube(root,header,0.024,trim,false,24);
    // the roof and its headliner
    const roof=new THREE.Mesh(new THREE.PlaneGeometry(XR-XL+0.1,1.3),headliner);
    roof.rotation.x=Math.PI/2; roof.position.set(CX,ROOF,WS1.z+0.62); roof.receiveShadow=true; roof.castShadow=true;
    root.add(roof);
    // side windows and the door frames below them
    // a moulded door card: two tones, a stitched seam, a map pocket
    const doorArt=canvasTex(512,256,(x,w,h)=>{
      const g=x.createLinearGradient(0,0,0,h);
      g.addColorStop(0,"#8c877d"); g.addColorStop(0.45,"#7c776e"); g.addColorStop(0.46,"#5e5a54"); g.addColorStop(1,"#4e4b46");
      x.fillStyle=g; x.fillRect(0,0,w,h);
      x.strokeStyle="rgba(240,236,226,0.35)"; x.setLineDash([6,5]); x.lineWidth=2;
      x.beginPath(); x.moveTo(0,h*0.44); x.lineTo(w,h*0.44); x.stroke(); x.setLineDash([]);
      x.fillStyle="rgba(20,20,22,0.45)"; x.fillRect(w*0.30,h*0.62,w*0.46,h*0.26);
      x.strokeStyle="rgba(0,0,0,0.4)"; x.strokeRect(w*0.30,h*0.62,w*0.46,h*0.26);
    });
    const doorTrim=std({map:doorArt.tex,roughness:0.8});
    for(const [x,s] of [[XL,-1],[XR,1]]){
      const win=new THREE.Mesh(new THREE.PlaneGeometry(0.95,0.40),glass);
      win.rotation.y=s*Math.PI/2; win.position.set(x+s*0.01,0.10,0.02); root.add(win);
      // the door: a moulded trim panel under the window, a pull and an armrest low down
      const door=new THREE.Mesh(new THREE.PlaneGeometry(1.1,0.50),doorTrim);
      door.rotation.y=-s*Math.PI/2; door.position.set(x,-0.36,0.05); door.receiveShadow=true; root.add(door);
      tube(root,[V3(x-s*0.012,-0.115,WS1.z-0.06),V3(x-s*0.012,-0.115,0.50)],0.012,trim,false,4);   // sill
      const arm=new THREE.Mesh(new THREE.BoxGeometry(0.045,0.035,0.34),vinyl);
      arm.position.set(x-s*0.022,-0.34,0.06); arm.castShadow=true; root.add(arm);
      const pull=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.018,0.10),chrome);
      pull.position.set(x-s*0.012,-0.21,-0.22); root.add(pull);
      tube(root,[V3(x,-0.10,0.48),V3(x,ROOF-0.02,0.48)],0.018,trim,false,4);
    }
  }
  // the wet compass hanging from the frame, and the sun visors folded up
  const Compass={};
  {
    const g=new THREE.Group(); g.position.set(CX,WS1.y-0.05,WS1.z-0.06); g.scale.setScalar(0.8);
    const body=new THREE.Mesh(new THREE.BoxGeometry(0.075,0.055,0.06),black);
    const art=canvasTex(1024,64,(x,w,h)=>{
      x.fillStyle="#141414"; x.fillRect(0,0,w,h);
      x.fillStyle="#f0f0ea"; x.textAlign="center"; x.textBaseline="middle";
      const marks={0:"N",30:"3",60:"6",90:"E",120:"12",150:"15",180:"S",210:"21",240:"24",270:"W",300:"30",330:"33"};
      for(let d=0;d<360;d+=5){
        const u=(1-d/360)*w;
        x.fillRect(u-1,h*0.72,2,d%10===0?h*0.26:h*0.14);
        if(marks[d]){ x.font=(marks[d].length===1?"800 34px ":"700 26px ")+SANS; x.fillText(marks[d],u,h*0.38); }
      }
    });
    art.tex.wrapS=THREE.RepeatWrapping;
    const card=new THREE.Mesh(new THREE.CylinderGeometry(0.024,0.024,0.026,40,1,true),
      std({map:art.tex,roughness:0.6,emissive:"#ffffff",emissiveMap:art.tex,emissiveIntensity:0.05}));
    card.position.set(0,-0.002,0.012); card.userData.dynamic=true;
    const win=new THREE.Mesh(new THREE.PlaneGeometry(0.05,0.03),glass); win.position.set(0,-0.002,0.0305);
    const lub=new THREE.Mesh(new THREE.BoxGeometry(0.0015,0.03,0.001),std({color:"#e03020"})); lub.position.set(0,-0.002,0.031);
    const stem=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.05,0.02),black); stem.position.set(0,0.045,-0.01);
    g.add(body,card,win,lub,stem); root.add(g);
    Compass.card=card;
    for(const x of [0.02,0.52]){
      const v=new THREE.Mesh(new THREE.BoxGeometry(0.30,0.012,0.17),std({color:"#3a3c40",roughness:0.8}));
      v.position.set(x,ROOF-0.02,WS1.z+0.11); v.rotation.x=0.10; v.castShadow=true; root.add(v);
      tube(root,[V3(x-0.15,ROOF-0.015,WS1.z+0.03),V3(x+0.15,ROOF-0.015,WS1.z+0.03)],0.005,chrome,false,4);
    }
  }

  // ---------- the glare shield and the panel ----------
  {
    // the padded hood from the panel's top edge forward to the windscreen foot
    const hood=surface(16,3,(u,v)=>{
      const x=lerp(XL+0.01,XR-0.01,u), bow=Math.sin(u*Math.PI)*0.10;
      const z=lerp(PZ+0.03,WS0.z-bow+0.02,v);
      const y=GS+0.01*Math.sin(v*Math.PI)-0.015*v;
      return V3(x,y,z);
    });
    const h=new THREE.Mesh(hood,vinyl); h.castShadow=true; h.receiveShadow=true; root.add(h);
    tube(root,[V3(XL+0.01,GS-0.004,PZ+0.03),V3(CX,GS+0.004,PZ+0.035),V3(XR-0.01,GS-0.004,PZ+0.03)],0.016,vinyl,false,24);
    const s=new THREE.Shape();
    s.moveTo(XL,-0.62); s.lineTo(XR,-0.62); s.lineTo(XR,GS-0.01); s.lineTo(XL,GS-0.01); s.closePath();
    const panel=new THREE.Mesh(new THREE.ShapeGeometry(s),panelPaint);
    panel.position.z=PZ; panel.receiveShadow=true; root.add(panel);
  }
  const PF=PZ+0.004;
  const dials=dialSet({bezel:black,face:["#141416","#0a0a0b"],ink:"#f4f4f0",minor:"#a0a0a0",label:"#cfcfcf",font:SANS,z:PF});
  const R=0.042, C0=-0.108, C2=0.108, Y1=-0.252, Y2=-0.362;
  dials.gauge(root,{label:"AIRSPEED",unit:"KM/H",ticks:7,nums:["0","60","120","180","240","300","360","420"],
    arcs:[[0.10,0.28,"#e8e8e8"],[0.14,0.62,"#2a9a3a"],[0.62,0.86,"#e0b020"],[0.86,0.88,"#d0302a"]],read:read.speed},C0,Y1,R);
  dials.gauge(root,{label:"ALT",unit:"x10 M",ticks:5,nums:["0","8","16","24","32","40"],read:read.alt},C2,Y1,R);
  dials.gauge(root,{label:"VERT SPEED",unit:"M/S",ticks:4,nums:["-20","-10","0","10","20"],read:read.vsi,start:0.5},C2,Y2,R);
  // the attitude indicator: a live canvas, the little aeroplane fixed over it
  const AI=canvasTex(256,256,null);
  {
    const faceMat=std({map:AI.tex,roughness:0.5,emissive:"#ffffff",emissiveMap:AI.tex,emissiveIntensity:0.18});
    const g=new THREE.Group(); g.position.set(0,Y1,PF);
    const face=new THREE.Mesh(new THREE.CircleGeometry(R,40),faceMat); face.userData.dynamic=true;
    const bezel=new THREE.Mesh(new THREE.TorusGeometry(R*1.04,R*0.085,12,48),black); bezel.position.z=0.004;
    const lens=new THREE.Mesh(new THREE.CircleGeometry(R,32),glass); lens.position.z=0.012;
    const sym=new THREE.Mesh(new THREE.BoxGeometry(R*1.1,R*0.07,0.002),std({color:"#ff9a1e",emissive:"#ff9a1e",emissiveIntensity:0.4}));
    sym.position.z=0.008;
    g.add(face,bezel,lens,sym); root.add(g);
  }
  // the heading indicator: a rose that turns under a fixed lubber line
  const HI={};
  {
    const art=canvasTex(256,256,(x,w)=>{
      const c=w/2, r=w*0.47;
      x.fillStyle="#0c0c0d"; x.beginPath(); x.arc(c,c,r,0,7); x.fill();
      x.strokeStyle="#f4f4f0"; x.fillStyle="#f4f4f0"; x.textAlign="center"; x.textBaseline="middle";
      for(let d=0;d<360;d+=5){
        const a=d*Math.PI/180-Math.PI/2, l=d%30===0?0.16:(d%10===0?0.10:0.06);
        x.lineWidth=d%10===0?3:1.5;
        x.beginPath(); x.moveTo(c+Math.cos(a)*r*0.92,c+Math.sin(a)*r*0.92); x.lineTo(c+Math.cos(a)*r*(0.92-l),c+Math.sin(a)*r*(0.92-l)); x.stroke();
        if(d%30===0){
          x.save(); x.translate(c+Math.cos(a)*r*0.62,c+Math.sin(a)*r*0.62); x.rotate(a+Math.PI/2);
          x.font="700 "+(d%90===0?30:22)+"px "+SANS; x.fillText(d%90===0?"NESW"[d/90]:String(d/10),0,0); x.restore();
        }
      }
    });
    const g=dials.housing(root,0,Y2,R,null,PF);
    const rose=new THREE.Mesh(new THREE.CircleGeometry(R*0.98,40),std({map:art.tex,roughness:0.6}));
    rose.position.z=0.001; rose.userData.dynamic=true;
    const planeSym=new THREE.Mesh(new THREE.ShapeGeometry((()=>{ const s=new THREE.Shape();
      s.moveTo(0,R*0.34); s.lineTo(R*0.05,R*0.05); s.lineTo(R*0.30,-R*0.02); s.lineTo(R*0.30,-R*0.08); s.lineTo(R*0.05,-R*0.05);
      s.lineTo(R*0.04,-R*0.24); s.lineTo(R*0.12,-R*0.30); s.lineTo(-R*0.12,-R*0.30); s.lineTo(-R*0.04,-R*0.24); s.lineTo(-R*0.05,-R*0.05);
      s.lineTo(-R*0.30,-R*0.08); s.lineTo(-R*0.30,-R*0.02); s.lineTo(-R*0.05,R*0.05); s.closePath(); return s; })()),
      std({color:"#ff9a1e",emissive:"#ff9a1e",emissiveIntensity:0.3}));
    planeSym.position.z=0.006;
    const lub=new THREE.Mesh(new THREE.BoxGeometry(0.002,R*0.2,0.001),std({color:"#ff9a1e",emissive:"#ff9a1e",emissiveIntensity:0.3}));
    lub.position.set(0,R*0.82,0.006);
    g.add(rose,planeSym,lub);
    HI.rose=rose;
  }
  // the turn coordinator: the little aeroplane banks, the ball slips
  const TC={};
  {
    const faceG=dials.faceGeo(R,(x,w)=>{
      const c=w/2, rr=w*0.47;
      x.fillStyle="#0c0c0d"; x.beginPath(); x.arc(c,c,rr,0,7); x.fill();
      x.strokeStyle="#f4f4f0"; x.lineWidth=5;
      // wings level, and the standard-rate marks below them each side
      for(const an of [0,0.36,Math.PI,Math.PI-0.36]){
        x.beginPath(); x.moveTo(c+Math.cos(an)*rr*0.72,c+Math.sin(an)*rr*0.72); x.lineTo(c+Math.cos(an)*rr*0.9,c+Math.sin(an)*rr*0.9); x.stroke();
      }
      x.fillStyle="#cfcfcf"; x.font="700 20px "+SANS; x.textAlign="center"; x.textBaseline="middle";
      x.fillText("L",c-rr*0.62,c+rr*0.28); x.fillText("R",c+rr*0.62,c+rr*0.28);
      x.font="600 15px "+SANS; x.fillText("TURN COORDINATOR",c,c-rr*0.55);
    });
    const g=dials.housing(root,C0,Y2,R,faceG,PF);
    const plane=new THREE.Group(); plane.position.set(0,R*0.05,0.007); plane.userData.dynamic=true;
    plane.add(new THREE.Mesh(new THREE.BoxGeometry(R*1.3,R*0.08,0.002),dials.needleMat));
    const dot=new THREE.Mesh(new THREE.CircleGeometry(R*0.10,16),dials.needleMat); plane.add(dot);
    const tb=new THREE.Mesh(new THREE.BoxGeometry(R*0.9,R*0.16,0.003),std({color:"#1a1a1a",roughness:0.3}));
    tb.position.set(0,-R*0.52,0.006);
    const ball=new THREE.Mesh(new THREE.SphereGeometry(R*0.075,12,10),std({color:"#111",roughness:0.3}));
    ball.userData.dynamic=true;
    const back=new THREE.Mesh(new THREE.BoxGeometry(R*0.86,R*0.13,0.001),std({color:"#e8e4d8",roughness:0.4}));
    back.position.set(0,-R*0.52,0.0072);
    g.add(plane,tb,back,ball);
    Object.assign(TC,{plane,ball,slip:0});
  }
  // engine gauges on the right
  dials.gauge(root,{label:"RPM",unit:"x100",ticks:6,nums:["0","5","10","15","20","25","30"],
    arcs:[[0.55,0.86,"#2a9a3a"],[0.86,0.9,"#d0302a"]],read:read.rpm},0.555,-0.372,0.036);
  dials.gauge(root,{label:"FUEL",ticks:4,nums:["E","","½","","F"],arcs:[[0,0.15,"#d0302a"]],read:read.fuel},0.655,-0.372,0.029);
  dials.gauge(root,{label:"OIL T",ticks:4,nums:["","","","",""],arcs:[[0.25,0.75,"#2a9a3a"]],
    read:t=>0.5+Math.sin(t*0.0005)*0.03},0.742,-0.372,0.029);

  // ---------- the radio stack: a moving map, the radios, the run page ----------
  function screen(x,y,w,h,cw,ch){
    const art=canvasTex(cw,ch,(c)=>{ c.fillStyle="#000"; c.fillRect(0,0,cw,ch); });
    const bez=new THREE.Mesh(new THREE.BoxGeometry(w+0.018,h+0.024,0.014),black);
    bez.position.set(x,y,PF+0.004); bez.receiveShadow=true; root.add(bez);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(w,h),std({color:0x000000,roughness:0.15,
      emissive:0xffffff,emissiveMap:art.tex,emissiveIntensity:0.9}));
    face.position.set(x,y,PF+0.0115); face.userData.dynamic=true; root.add(face);
    for(let i=0;i<4;i++){
      const b=new THREE.Mesh(new THREE.CylinderGeometry(0.005,0.005,0.008,10),chrome);
      b.rotation.x=Math.PI/2; b.position.set(x-w/2-0.004+ (i<2?0:w+0.008), y+h*0.3-(i%2)*h*0.6, PF+0.012);
      root.add(b);
    }
    return {art,w:cw,h:ch,key:""};
  }
  const gps=screen(0.385,-0.268,0.160,0.104,384,256);
  const runPg=screen(0.640,-0.268,0.150,0.098,384,256);
  const LCD=canvasTex(512,128,null);
  {
    const box=(y,h)=>{ const b=new THREE.Mesh(new THREE.BoxGeometry(0.17,h,0.03),black); b.position.set(0.385,y,PF+0.006); b.castShadow=true; root.add(b); };
    box(-0.357,0.044); box(-0.410,0.040);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(0.15,0.078),std({color:0x000000,emissive:0xffffff,
      emissiveMap:LCD.tex,emissiveIntensity:1.0,roughness:0.2}));
    face.position.set(0.385,-0.383,PF+0.0215); face.userData.dynamic=true; root.add(face);
  }
  function drawLCD(){
    const x=LCD.ctx, w=512, h=128;
    x.fillStyle="#050805"; x.fillRect(0,0,w,h);
    x.fillStyle="#57f07a"; x.font="700 44px "+MONO; x.textBaseline="middle"; x.textAlign="left";
    x.fillText("122.475",16,32); x.fillStyle="#2a8a3a"; x.fillText("118.200",270,32);
    x.fillStyle="#ffb23a"; x.font="700 40px "+MONO; x.fillText("XPDR 7000",16,96);
    x.fillStyle=Game.state===S.PLAY?"#57f07a":"#2a8a3a"; x.fillText("ALT",370,96);
    LCD.tex.needsUpdate=true;
  }
  drawLCD();
  // three annunciators above the six-pack
  const lamps=[];
  LAMPS.forEach(([label,col,on,blink],i)=>{
    const art=canvasTex(128,64,(x,w,h)=>{
      x.fillStyle="#0c0c0d"; x.fillRect(0,0,w,h);
      x.fillStyle=col; x.font="800 30px "+SANS; x.textAlign="center"; x.textBaseline="middle"; x.fillText(label,w/2,h/2+1);
    });
    const m=std({color:0x000000,roughness:0.2,emissive:0xffffff,emissiveMap:art.tex,emissiveIntensity:0.12});
    const lamp=new THREE.Mesh(new THREE.PlaneGeometry(0.040,0.016),m);
    lamp.position.set(0.20+i*0.046,-0.188,PF+0.002); lamp.userData.dynamic=true;
    root.add(lamp);
    lamps.push({m,on,blink});
  });

  // ---------- the yokes ----------
  // The column comes out of the panel below the six-pack and the yoke turns
  // about it; only the tops of the horns rise into the pilot's view, as they
  // do from a real left seat. The group's origin is the hub, on the column axis.
  const YOKE={y:-0.42,z:-0.40};
  // satin plastics that catch the light, so a dark yoke still reads against a dark panel
  const yokeMat=std({color:"#4a4d52",roughness:0.32,metalness:0.1});
  const gripMat=std({color:"#26282b",roughness:0.6});
  const columnMat=std({color:"#6e7176",metalness:0.7,roughness:0.35});
  const COL_LEN=YOKE.z-PZ;              // panel face to hub; it slides in and out with the push
  function yoke(x){
    const g=new THREE.Group(); g.position.set(x,YOKE.y,YOKE.z); g.userData.dynamic=true;
    const horns=[V3(-0.155,0.17,0),V3(-0.150,0.10,0),V3(-0.12,0.02,0),V3(-0.05,-0.005,0),
                 V3(0.05,-0.005,0),V3(0.12,0.02,0),V3(0.150,0.10,0),V3(0.155,0.17,0)];
    tube(g,horns,0.014,yokeMat,false,48);
    for(const s of [-1,1]) tube(g,[V3(s*0.152,0.07,0),V3(s*0.156,0.18,0)],0.020,gripMat,false,8);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.03,20),yokeMat);
    hub.rotation.x=Math.PI/2; g.add(hub);
    const badge=new THREE.Mesh(new THREE.CircleGeometry(0.022,20),chrome); badge.position.z=0.016; g.add(badge);
    root.add(g);
    const col=new THREE.Mesh(new THREE.CylinderGeometry(0.011,0.011,COL_LEN,12),columnMat);
    col.rotation.x=Math.PI/2; col.position.set(x,YOKE.y,(YOKE.z+PZ)/2); col.userData.dynamic=true;
    root.add(col);
    return {g,col,x};
  }
  const yokes=[yoke(0),yoke(0.535)];

  bakeStatics(root);

  let mapT=0, lcdT=0, yRoll=0, yPush=0;
  return {
    root,
    shadow:{center:[CX,-0.1,-1.0],half:2.6},
    envIntensity:0.55,
    skyLight:0.55,
    rumble:0.0003,
    update(t,dt,f){
      dials.update(t,dt);
      // the yokes follow the controls: turned for bank, pushed and pulled for pitch
      const spec=Aircraft.spec;
      yRoll+=(clamp(P.roll/spec.bank,-1.2,1.2)*0.55-yRoll)*(1-Math.exp(-dt*8));
      yPush+=(clamp(P.vy/spec.maxVy,-1,1)*0.045-yPush)*(1-Math.exp(-dt*6));
      for(const y of yokes){
        y.g.rotation.z=-yRoll;
        y.g.position.z=YOKE.z+yPush;
        y.col.position.z=(YOKE.z+PZ)/2+yPush;
      }
      // the attitude indicator
      {
        const x=AI.ctx, w=256, c=w/2, pitch=Math.atan2(P.vy,Math.max(10,P.speed))*57.3;
        x.save(); x.fillStyle="#000"; x.fillRect(0,0,w,w);
        x.beginPath(); x.arc(c,c,w*0.48,0,7); x.clip();
        x.translate(c,c); x.rotate(-P.roll); x.translate(0,pitch*3.2);
        x.fillStyle="#3a7fd0"; x.fillRect(-w,-w*2,w*2,w*2);
        x.fillStyle="#7a4f2a"; x.fillRect(-w,0,w*2,w*2);
        x.fillStyle="#fff"; x.fillRect(-w,-2,w*2,4);
        for(const d of [-20,-10,10,20]){ x.fillRect(-(d%20?22:36),-d*3.2-1.5,d%20?44:72,3); }
        x.restore();
        x.strokeStyle="#fff"; x.lineWidth=4;
        for(const a of [-60,-30,-20,-10,0,10,20,30,60]){
          const r=a*Math.PI/180-Math.PI/2, l=a%30===0?18:10;
          x.beginPath(); x.moveTo(c+Math.cos(r)*w*0.46,c+Math.sin(r)*w*0.46); x.lineTo(c+Math.cos(r)*(w*0.46-l),c+Math.sin(r)*(w*0.46-l)); x.stroke();
        }
        AI.tex.needsUpdate=true;
      }
      HI.rose.rotation.z=read.heading()*Math.PI/180;
      TC.plane.rotation.z=-clamp(P.roll*1.6,-0.7,0.7);
      TC.slip+=(clamp((P.vx/spec.maxVx)-P.roll*2.1,-1,1)-TC.slip)*(1-Math.exp(-dt*4));
      TC.ball.position.set(TC.slip*R*0.34,-R*0.52,0.009);
      Compass.card.rotation.y=read.heading()*Math.PI/180+Math.sin(t*0.0013)*0.04;
      updateLamps(lamps,t);
      prop.update(t,f);
      damage.update();
      dirt.update(t,dt);
      mapT-=dt; lcdT-=dt;
      if(mapT<=0){ drawMap(gps.art.ctx,gps.w,gps.h,"glass"); gps.art.tex.needsUpdate=true; mapT=0.15; }
      if(lcdT<=0){ drawLCD(); lcdT=1; }
      const k=runKey();
      if(k!==runPg.key){ runPg.key=k; drawRun(runPg.art.ctx,runPg.w,runPg.h,"glass"); runPg.art.tex.needsUpdate=true; }
    }
  };
}

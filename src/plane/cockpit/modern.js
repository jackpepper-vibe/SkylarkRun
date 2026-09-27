// Sunburst 330 — the open cockpit of a modern aerobatic single-seater.
//
// Ahead is a long glossy composite cowling in a sunburst livery running to a
// pointed spinner, a short tinted wind deflector, and a carbon-fibre panel
// under a matte glare shield carrying three screens — an attitude display with
// speed, altitude and heading, a moving map, and the run page — plus a G-meter
// with its tell-tales and a row of LED annunciators. The low wings,
// symmetric-section as aerobatic wings are, sit in the lower corners.
import * as THREE from 'three';
import { clamp, lerp, smooth } from '../../util.js';
import { Game, P, S } from '../../state.js';
import { SANS, V3, bakeStatics, canvasTex, cowlDamage, drawMap, drawPFD, drawRun, glassMaterial,
         grime, LAMPS, propeller, runKey, std, surface, updateLamps } from './kit.js';

const WHITE="#f1f0ec", RED="#d3262e", INK="#1c2330";
const Z_COAM=-0.50, Z_NOSE=-2.30;
const PROP_Y=-0.52, PROP_Z=-2.62;
const PW=0.365, PANEL_Z=-0.50;
const SY=-0.279;

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
  x.strokeStyle="rgba(40,40,44,0.5)"; x.strokeRect(0.62*w,0.44*h,70,40);
  x.fillStyle="rgba(150,152,158,0.9)"; x.beginPath(); x.arc(0.22*w,0.36*h,11,0,7); x.fill();
}
function fuselageGeometry(){
  const NZ=40, NP=34, pos=[], uv=[], idx=[];
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
function wingGeometry(sx){
  const NS=14, NC=22, pos=[], uv=[], idx=[];
  // NACA 00xx half-thickness at chord fraction c
  const yt=(c,t)=>5*t*(0.2969*Math.sqrt(c)-0.1260*c-0.3516*c*c+0.2843*c*c*c-0.1036*c*c*c*c);
  for(let i=0;i<=NS;i++){
    const u=i/NS, span=lerp(0.36,3.9,u);
    const chord=lerp(1.75,1.05,u), le=lerp(-1.55,-1.30,u), thick=lerp(0.16,0.12,u);
    const y0=-0.90+u*0.03;
    for(let j=0;j<=NC;j++){
      const v=j/NC;
      const c=Math.pow(Math.abs(1-2*v),1.6);
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

export function build(){
  const root=new THREE.Group();
  const trimBlack=std({color:"#141416",roughness:0.55});
  const matteBlack=std({color:"#1b1b1d",roughness:0.92});
  const alcantara=std({color:"#232325",roughness:0.95});
  const satinMetal=std({color:"#8a8c90",metalness:1,roughness:0.3});
  const glass=glassMaterial(0.03);

  // ---------- the fuselage: glossy composite, coaming to spinner ----------
  const cowlArt=canvasTex(1024,512,paintCowl);
  // car-paint: a clear coat over the livery, softer than a show car's, since
  // seen this close to edge-on a mirror finish would show nothing but sky
  const cowlMat=new THREE.MeshPhysicalMaterial({map:cowlArt.tex,roughness:0.45,metalness:0,
    clearcoat:0.55,clearcoatRoughness:0.14,envMapIntensity:0.55});
  const fuselage=new THREE.Mesh(fuselageGeometry(),cowlMat);
  fuselage.castShadow=true; fuselage.receiveShadow=true;
  root.add(fuselage);
  const damage=cowlDamage(cowlArt,()=>paintCowl(cowlArt.ctx,1024,512),{style:"gel"});

  // the sides alongside the cockpit, and the carbon tub inside
  const carbonArt=canvasTex(256,256,(x,w,h)=>{
    x.fillStyle="#151517"; x.fillRect(0,0,w,h);
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
      o.receiveShadow=true; root.add(o);
      const lip=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.02,1.25),alcantara);
      lip.position.set(sx*0.40,-0.283,0.10); lip.receiveShadow=true; root.add(lip);
      const w=new THREE.Mesh(new THREE.PlaneGeometry(1.2,0.8),carbon);
      w.position.set(sx*0.365,-0.68,0.10); w.rotation.y=-sx*Math.PI/2;
      w.receiveShadow=true; root.add(w);
    }
  }

  // ---------- the low wings ----------
  const wingArt=canvasTex(1024,256,(x,w,h)=>{
    x.fillStyle=WHITE; x.fillRect(0,0,w,h);
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
  {
    const m=new THREE.MeshPhysicalMaterial({map:wingArt.tex,roughness:0.42,clearcoat:1,clearcoatRoughness:0.06});
    for(const sx of [-1,1]){
      const w=new THREE.Mesh(wingGeometry(sx),m);
      w.castShadow=true; w.receiveShadow=true; root.add(w);
    }
  }

  // ---------- the panel: carbon, under a matte glare shield ----------
  {
    const s=new THREE.Shape();
    s.moveTo(-PW,-0.64); s.lineTo(PW,-0.64); s.lineTo(PW,-0.232);
    s.quadraticCurveTo(0,-0.188,-PW,-0.232); s.closePath();
    const g=new THREE.ShapeGeometry(s,24);
    const p=g.attributes.position, uv=g.attributes.uv;
    for(let i=0;i<p.count;i++) uv.setXY(i,(p.getX(i)+PW)/(2*PW),(p.getY(i)+0.64)/0.47);
    const panel=new THREE.Mesh(g,carbon);
    panel.position.z=PANEL_Z; panel.receiveShadow=true;
    root.add(panel);
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
    root.add(hood);
  }
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
    root.add(roll);
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
    for(let i=0;i<5;i++){
      const b=new THREE.Mesh(new THREE.BoxGeometry(w*0.12,0.006,0.006),satinMetal);
      b.position.set(x-w*0.4+i*w*0.2,y-h/2-0.0075,PANEL_Z+0.013);
      root.add(b);
    }
    root.add(bezel,face);
    return {art,w:cw,h:ch,key:""};
  }
  const mfdMap=screen(-0.262,SY,0.176,0.102,384,256);
  const pfd=screen(-0.030,SY,0.232,0.102,512,256);
  const mfdRun=screen(0.262,SY,0.176,0.102,384,256);

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
    root.add(g);
    Object.assign(GM,{needle,tellHi,tellLo,g:1,hi:1,lo:1,pvy:0});
  }
  const gAngle=g=>-(Math.PI*0.75+Math.PI*1.5*(clamp(g,-5,10)+5)/15);

  // ---------- LED annunciators on the glare shield ----------
  const lamps=[];
  {
    const housing=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.022,0.018),trimBlack);
    housing.position.set(-0.20,-0.206,-0.555); housing.rotation.x=-0.3;
    housing.castShadow=true; root.add(housing);
    LAMPS.forEach(([label,col,on,blink],i)=>{
      const art=canvasTex(128,64,(x,w,h)=>{
        x.fillStyle="#0c0c0d"; x.fillRect(0,0,w,h);
        x.fillStyle=col; x.font="800 30px "+SANS; x.textAlign="center"; x.textBaseline="middle"; x.fillText(label,w/2,h/2+1);
      });
      const m=std({color:0x000000,roughness:0.2,emissive:0xffffff,emissiveMap:art.tex,emissiveIntensity:0.12});
      const lamp=new THREE.Mesh(new THREE.PlaneGeometry(0.044,0.016),m);
      lamp.position.set(-0.252+i*0.052,-0.2005,-0.5445); lamp.rotation.x=-0.3;
      lamp.userData.dynamic=true;
      root.add(lamp);
      lamps.push({m,on,blink});
    });
  }

  // ---------- the wind deflector ----------
  const dirt=grime(512,160);
  {
    const R=0.34, CZ=-0.32, PHI=0.62;
    const shape=(u,v)=>{
      const phi=(u-0.5)*2*PHI;
      const yb=-0.210, yt=-0.070-0.050*Math.pow((u-0.5)*2,2);
      const y=lerp(yb,yt,v);
      const lean=(y-yb)*0.95;                                // raked well back
      return V3(R*Math.sin(phi), y, CZ-R*Math.cos(phi)+lean);
    };
    const geo=surface(24,6,shape);
    root.add(new THREE.Mesh(geo,glass));
    const tint=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:"#22323e",transparent:true,opacity:0.24,
      depthWrite:false,side:THREE.DoubleSide}));
    root.add(tint);
    const gm=new THREE.Mesh(geo,dirt.mat);
    gm.renderOrder=1; gm.userData.dynamic=true;
    root.add(gm);
    const edge=[], base=[];
    for(let i=0;i<=24;i++){ edge.push(shape(i/24,1)); base.push(shape(i/24,0)); }
    const top=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge),48,0.0022,6),trimBlack);
    const seal=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(base),48,0.004,6),trimBlack);
    top.castShadow=true; root.add(top,seal);
  }

  // ---------- the spinner and the propeller ----------
  {
    const prof=[];
    for(let i=0;i<=16;i++){ const k=i/16; prof.push(new THREE.Vector2(0.135*Math.pow(1-k,0.62),k*0.42)); }
    const sp=new THREE.Mesh(new THREE.LatheGeometry(prof,32),
      new THREE.MeshPhysicalMaterial({color:RED,roughness:0.3,clearcoat:1,clearcoatRoughness:0.05}));
    sp.rotation.x=-Math.PI/2; sp.position.set(0,PROP_Y,PROP_Z+0.36);
    root.add(sp);
  }
  const prop=propeller(root,{radius:0.96,blades:3,tip:"#f2f2f2",hub:0.12,y:PROP_Y,z:PROP_Z});

  bakeStatics(root);

  let mapT=0, pfdT=0;
  return {
    root,
    shadow:{center:[0,-0.3,-1.2],half:2.6},
    envIntensity:0.9,
    setSky(){ GM.hi=1; GM.lo=1; },
    update(t,dt,f){
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
      updateLamps(lamps,t);
      prop.update(t,f);
      damage.update();
      dirt.update(t,dt);
      pfdT-=dt; mapT-=dt;
      if(pfdT<=0){ drawPFD(pfd.art.ctx,pfd.w,pfd.h); pfd.art.tex.needsUpdate=true; pfdT=1/30; }
      if(mapT<=0){ drawMap(mfdMap.art.ctx,mfdMap.w,mfdMap.h,"glass"); mfdMap.art.tex.needsUpdate=true; mapT=0.15; }
      const k=runKey();
      if(k!==mfdRun.key){ mfdRun.key=k; drawRun(mfdRun.art.ctx,mfdRun.w,mfdRun.h,"glass"); mfdRun.art.tex.needsUpdate=true; }
    }
  };
}

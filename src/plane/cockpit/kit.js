// Skylark — the cockpit builder's kit.
//
// Every cockpit is its own module (modern, vintage, biplane, cabin, trike),
// but they are built from the same parts: canvas textures, a baking pass that
// flattens static geometry into one mesh per material, a propeller disc, a
// windscreen that collects bird strikes and rain, a cowling that dents, round
// dials sharing one atlas, and the moving-map and run-page displays in paper
// and glass styles. Each part reads the game state itself, so a cockpit module
// is mostly geometry and placement.
//
// Everything is in metres round the pilot's eye at the origin, looking down -z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { renderer } from '../../view.js';
import { clamp, mulberry32 } from '../../util.js';
import { G, Game, P, S, dents } from '../../state.js';
import { splats } from '../../damage.js';
import { gDrops } from '../../weather.js';
import { Fuel, Haz, Rings, af, coursePathX, groundH } from '../world.js';
import { Aircraft } from '../aircraft.js';
import { Tour } from '../sectors.js';

export const SANS="'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
export const MONO="ui-monospace,Menlo,Consolas,monospace";
export const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
export const std=o=>new THREE.MeshStandardMaterial(o);

// ---------- canvases ----------
// Canvases are CPU-backed: several are redrawn while flying, and uploading a
// GPU-accelerated canvas to WebGL stalls the pipeline while the two sync.
export function canvasTex(w,h,draw,srgb=true){
  const c=document.createElement("canvas"); c.width=w; c.height=h;
  const x=c.getContext("2d",{willReadFrequently:true});
  if(draw) draw(x,w,h);
  const t=new THREE.CanvasTexture(c);
  if(srgb) t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return {tex:t,ctx:x,canvas:c};
}

// ---------- glass ----------
/**
 * Glass drawn as reflection only, added over the view: diffuse black, so a pane
 * is invisible except where it catches the sky or the sun, as real glass is.
 */
export const glassMaterial=(roughness=0.04)=>std({color:0x000000,metalness:0,roughness,transparent:true,
  blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});

// ---------- geometry ----------
/** A round (or elliptical, sx/sz) rod between two points. */
export function strut(parent,a,b,w,d,mat,seg=12){
  const len=a.distanceTo(b);
  const m=new THREE.Mesh(new THREE.CylinderGeometry(1,1,len,seg),mat);
  m.scale.set(w,1,d);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(V3(0,1,0),b.clone().sub(a).normalize());
  m.castShadow=true; m.receiveShadow=true;
  parent.add(m);
  return m;
}
/** A tube along a list of points. */
export function tube(parent,pts,r,mat,closed=false,seg=48){
  const m=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,closed,"centripetal"),seg,r,8,closed),mat);
  m.castShadow=true; m.receiveShadow=true;
  parent.add(m);
  return m;
}
/** A grid surface from a function (u, v) -> Vector3, with uvs. */
export function surface(NU,NV,fn,flip=false){
  const pos=[], uv=[], idx=[];
  for(let i=0;i<=NU;i++) for(let j=0;j<=NV;j++){
    const p=fn(i/NU,j/NV); pos.push(p.x,p.y,p.z); uv.push(i/NU,j/NV);
  }
  for(let i=0;i<NU;i++) for(let j=0;j<NV;j++){
    const a=i*(NV+1)+j, b=a+NV+1;
    if(flip) idx.push(a,a+1,b, a+1,b+1,b); else idx.push(a,b,a+1, a+1,b,b+1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/**
 * A wing panel with a real section: NACA four-digit thickness about a mean
 * line with `camber`, lofted between two span stations. x0 -> x1 is the span
 * (either direction), y the height at each end (dihedral), le the leading
 * edge's z, c the chord, t the thickness ratio. uv: u along the span, v round
 * the section from the trailing edge over the top (0) to under it (1).
 */
export function airfoilWing({x0,x1,y0,y1,le0,le1,c0,c1,t0=0.12,t1=0.12,camber=0,NS=12,NC=20}){
  const pos=[], uv=[], idx=[];
  const yt=(c,t)=>5*t*(0.2969*Math.sqrt(c)-0.1260*c-0.3516*c*c+0.2843*c*c*c-0.1036*c*c*c*c);
  for(let i=0;i<=NS;i++){
    const u=i/NS, x=x0+(x1-x0)*u, y=y0+(y1-y0)*u, le=le0+(le1-le0)*u, ch=c0+(c1-c0)*u, t=t0+(t1-t0)*u;
    for(let j=0;j<=NC;j++){
      const v=j/NC;
      const c=Math.pow(Math.abs(1-2*v),1.6);             // chord fraction, bunched at the nose
      const up=v<0.5?1:-1;
      const mean=camber*4*c*(1-c);
      pos.push(x, y+(mean+up*yt(c,t))*ch, le+c*ch);
      uv.push(u,v);
    }
  }
  const flip=x1<x0;
  for(let i=0;i<NS;i++) for(let j=0;j<NC;j++){
    const a=i*(NC+1)+j, b=a+NC+1;
    if(flip) idx.push(a,a+1,b, a+1,b+1,b); else idx.push(a,b,a+1, a+1,b,b+1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/**
 * A fuselage skin from a coaming at zA forward to a nose at zB: a flat-sided
 * section with an arched top, its half-width, top height and arch given as
 * functions of k (0 at the coaming, 1 at the nose). uv: u = k, v round the
 * section from bottom-left over the top to bottom-right.
 */
export function fuselageSkin(zA,zB,hw,top,archK,bottom=-1.1,NZ=40,NP=34){
  const pos=[], uv=[], idx=[];
  for(let i=0;i<=NZ;i++){
    const k=i/NZ, z=zA+(zB-zA)*k, w=hw(k), tp=top(k), arch=w*archK;
    for(let j=0;j<=NP;j++){
      const s=j/NP;
      let x,y;
      if(s<0.14){ x=-w; y=bottom+(tp-arch-bottom)*(s/0.14); }
      else if(s>0.86){ x=w; y=tp-arch+(bottom-tp+arch)*((s-0.86)/0.14); }
      else{
        const a=((s-0.14)/0.72-0.5)*Math.PI;
        x=w*Math.sin(a); y=tp-arch*(1-Math.pow(Math.cos(a),0.8));
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

// ---------- bake: every static part merged into one mesh per material ----------
// Built as dozens of small pieces, a cockpit costs a draw call apiece — and
// again for the shadow pass. Anything that never moves is flattened into its
// material's single mesh, so a whole cockpit draws in a few dozen calls. Mark
// anything that moves (or that owns a moving child) userData.dynamic.
export function bakeStatics(root){
  root.updateMatrixWorld(true);
  const groups=new Map();
  root.traverse(o=>{
    if(!o.isMesh) return;
    for(let p=o;p;p=p.parent) if(p.userData.dynamic) return;
    if(!groups.has(o.material)) groups.set(o.material,[]);
    groups.get(o.material).push(o);
  });
  const inv=new THREE.Matrix4().copy(root.matrixWorld).invert();
  for(const [mat,meshes] of groups){
    if(meshes.length<2) continue;
    const parts=meshes.map(m=>{
      let g=m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,m.matrixWorld));
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

// ---------- the propeller: a disc of blur, not blades ----------
/**
 * A spinning propeller as a shader disc: `blades` soft sectors turning at the
 * slow apparent rate a camera sees, painted tips, and a glow when the pilot
 * looks through it into the sun. Hidden on the menu unless the hangar is
 * running the engine for the preview.
 */
export function propeller(parent,{radius=0.96,blades=2,tip="#e8c24a",hub=0.12,x=0,y=0,z=-2.5}){
  const u={time:{value:0},rev:{value:1},sunLocal:{value:new THREE.Vector3()},sunCol:{value:new THREE.Color()},
           tipCol:{value:new THREE.Color(tip)}};
  const mat=new THREE.ShaderMaterial({
    uniforms:u,
    vertexShader:`varying vec2 vP; void main(){ vP=position.xy/${radius.toFixed(3)}; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`
      uniform float time,rev; uniform vec3 sunLocal,sunCol,tipCol; varying vec2 vP;
      void main(){
        float r=length(vP), a=atan(vP.y,vP.x);
        float sec=pow(0.5+0.5*cos(${blades.toFixed(1)}*(a-time*(0.7+rev*0.9))),6.0);
        float body=smoothstep(${hub.toFixed(3)},0.55,r)*(1.0-smoothstep(0.96,1.0,r));
        float tips=smoothstep(0.88,0.91,r)*(1.0-smoothstep(0.95,0.98,r));
        float alpha=body*(0.026+0.032*sec)+tips*0.05;
        vec3 col=mix(vec3(0.045,0.042,0.04),tipCol,tips);
        float back=pow(max(sunLocal.z,0.0),3.0);        // into the sun, the disc lights up
        col+=sunCol*back*0.5*body;
        alpha+=back*0.05*body;
        gl_FragColor=vec4(col,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent:true, depthWrite:false, side:THREE.DoubleSide,
  });
  const m=new THREE.Mesh(new THREE.CircleGeometry(radius,64),mat);
  m.position.set(x,y,z); m.renderOrder=2; m.userData.dynamic=true;
  parent.add(m);
  return {
    mesh:m,
    update(t,f){
      m.visible=Game.state!==S.MENU||Game.hangar;
      u.time.value=t*0.001;
      u.rev.value=0.45+f.speedFrac*0.55;
      u.sunLocal.value.copy(f.sunL).multiplyScalar(-1);
      u.sunCol.value.copy(f.sunCol);
    }
  };
}

// ---------- grime: bird strikes and rain on the screen ----------
/**
 * A canvas laid over a windscreen: splats where birds hit, beads of rain that
 * run in a shower. Redrawn only when something changed, and at 15 Hz in rain.
 * `run` is how the drops move: down an open screen's face, or streaming back
 * across an enclosed one.
 */
export function grime(w=512,h=160,{run="down"}={}){
  const art=canvasTex(w,h,null);
  let splatN=-1, t0=0;
  const mat=new THREE.MeshStandardMaterial({map:art.tex,transparent:true,roughness:0.4,
    depthWrite:false,side:THREE.DoubleSide});
  function draw(t){
    const x=art.ctx;
    x.clearRect(0,0,w,h);
    for(const s of splats){
      const r=mulberry32((s.seed*1000)|0);
      const u=(0.2+r()*0.6)*w, v=(0.25+r()*0.5)*h, rad=(10+s.r*1.4)*w/512;
      x.fillStyle="rgba(109,106,74,0.75)"; x.beginPath(); x.ellipse(u,v,rad,rad*0.7,r()*3,0,7); x.fill();
      x.fillStyle="rgba(143,138,94,0.7)";
      for(let i=0;i<6;i++){ const a=r()*6.3, d=rad*(0.9+r()*0.9); x.beginPath(); x.arc(u+Math.cos(a)*d,v+Math.sin(a)*d*0.7,rad*0.2*(0.5+r()),0,7); x.fill(); }
    }
    if(Game.weather===2){
      if(Math.random()<0.5&&gDrops.length<80) gDrops.push({x:Math.random()*w,y:Math.random()*h*(run==="down"?0.5:1),r:2+Math.random()*4,t0:t});
      for(let i=gDrops.length-1;i>=0;i--){
        const d=gDrops[i];
        if(run==="down") d.y+=1.2+d.r*0.5;
        else { d.y-=0.6+d.r*0.4; d.x+=(d.x-w/2)*0.012; }        // blown up and out across the glass
        if(t-d.t0>5200||d.y>h||d.y<0||d.x<0||d.x>w){ gDrops.splice(i,1); continue; }
        x.fillStyle="rgba(200,220,240,0.35)"; x.beginPath(); x.arc(d.x,d.y,d.r,0,7); x.fill();
        x.fillStyle="rgba(255,255,255,0.55)"; x.fillRect(d.x-d.r*0.3,d.y-d.r*0.5,d.r*0.5,d.r*0.5);
      }
    }
    art.tex.needsUpdate=true;
  }
  return {
    mat, art,
    update(t,dt){
      t0-=dt;
      const wet=Game.weather===2;
      if(splats.length!==splatN||(wet&&t0<=0)||(!wet&&gDrops.length)){
        if(!wet) gDrops.length=0;
        draw(t); splatN=splats.length; t0=0.066;
      }
    }
  };
}

// ---------- the cowling: dents and oil, painted when they happen ----------
/**
 * Damage on a painted surface: each strike dents it (style "gel" cracks a
 * composite, "metal" scrapes paint to bare metal, "fabric" tears doped linen),
 * and once the airframe is down a life the engine starts to weep oil. `region`
 * is the [u0, u1, v0, v1] of the canvas that faces the pilot.
 */
export function cowlDamage(art,repaint,{w=1024,h=512,style="metal",region=[0.10,0.40,0.38,0.62]}={}){
  let dentN=0, oiled=false;
  const light=style==="gel"?"rgba(255,255,255,0.4)":(style==="fabric"?"rgba(250,240,210,0.35)":"rgba(210,220,200,0.30)");
  const crack=style==="metal"?"rgba(200,205,190,0.55)":"rgba(40,40,44,0.6)";
  function dent(seed){
    const r=mulberry32(seed|0), x=art.ctx;
    const u=(region[0]+r()*(region[1]-region[0]))*w, v=(region[2]+r()*(region[3]-region[2]))*h, rad=(16+r()*24)*w/1024;
    x.save(); x.translate(u,v); x.rotate(r()*3);
    const g=x.createRadialGradient(-rad*0.3,-rad*0.3,2,0,0,rad);
    g.addColorStop(0,light); g.addColorStop(0.5,"rgba(30,30,32,0.35)"); g.addColorStop(1,"rgba(30,30,32,0)");
    x.fillStyle=g; x.beginPath(); x.ellipse(0,0,rad,rad*0.7,0,0,7); x.fill();
    x.strokeStyle=crack; x.lineWidth=1.4;
    for(let i=0;i<5;i++){ const a=r()*6.3, l=rad*(0.5+r()); x.beginPath(); x.moveTo(0,0); x.lineTo(Math.cos(a)*l,Math.sin(a)*l*0.6); x.stroke(); }
    x.restore();
    art.tex.needsUpdate=true;
  }
  function oil(){
    const r=mulberry32(4242), x=art.ctx;
    for(let i=0;i<6;i++){
      const u=(region[1]-0.05+r()*0.40)*w, v=(region[2]+r()*(region[3]-region[2]))*h;
      const g=x.createLinearGradient(u,0,u-160*w/1024,0);
      g.addColorStop(0,"rgba(30,22,10,0.55)"); g.addColorStop(1,"rgba(30,22,10,0)");
      x.fillStyle=g; x.fillRect(u-160*w/1024,v-4-r()*6,160*w/1024,8+r()*8);
    }
    art.tex.needsUpdate=true;
  }
  return {
    update(){
      const full=Aircraft.spec.lives;
      if(dents.length<dentN||(P.lives>=full&&oiled)){ repaint(); art.tex.needsUpdate=true; dentN=0; oiled=false; }
      while(dentN<dents.length) dent(dents[dentN++].seed);
      if(P.lives<full&&!oiled&&Game.state!==S.MENU&&Game.state!==S.TAKEOFF){ oil(); oiled=true; }
    }
  };
}

// ---------- round dials, sharing one atlas ----------
/**
 * A set of round instruments. Every face is painted into one 4 x 2 atlas, so
 * once baked they are a single draw; needles move, with a little lag as real
 * needles have. `look` sets the style: bezel material, face and ink colours.
 */
export function dialSet({bezel,needleMat,face=["#2e2a25","#0f0d0b"],ink="#ece4d0",minor="#a69e8c",label="#c9b98f",font=MONO,z=0}){
  const atlas=canvasTex(1024,512,null);
  const faceMat=std({map:atlas.tex,roughness:0.7});
  const glass=glassMaterial();
  const needles=[];
  let cells=0;
  const nMat=needleMat||std({color:ink,roughness:0.4,emissive:ink,emissiveIntensity:0.06});
  function faceGeo(r,paint){
    const cell=cells++, cx=(cell%4)*256, cy=Math.floor(cell/4)*256;
    const x=atlas.ctx;
    x.save(); x.translate(cx,cy); x.beginPath(); x.rect(0,0,256,256); x.clip();
    paint(x,256);
    x.restore();
    atlas.tex.needsUpdate=true;
    const g=new THREE.CircleGeometry(r,48);
    const uv=g.attributes.uv;
    // canvas rows run down, texture v runs up (flipY): cell row 0 is the top half
    for(let i=0;i<uv.count;i++) uv.setXY(i,(cell%4+uv.getX(i))/4,(1-Math.floor(cell/4)+uv.getY(i))/2);
    return g;
  }
  const paintScale=spec=>(x,w)=>{
    const c=w/2, r=w*0.47;
    const f=x.createRadialGradient(c-r*0.3,c-r*0.35,r*0.1,c,c,r);
    f.addColorStop(0,face[0]); f.addColorStop(1,face[1]);
    x.fillStyle=f; x.beginPath(); x.arc(c,c,r,0,7); x.fill();
    const a0=Math.PI*0.75, sw=Math.PI*1.5;
    for(const [from,to,col] of spec.arcs||[]){
      x.strokeStyle=col; x.lineWidth=r*0.09;
      x.beginPath(); x.arc(c,c,r*0.80,a0+sw*from,a0+sw*to); x.stroke();
    }
    const n=spec.ticks;
    for(let i=0;i<=n*2;i++){
      const a=a0+sw*i/(n*2), major=i%2===0;
      x.strokeStyle=major?ink:minor; x.lineWidth=major?r*0.045:r*0.022;
      x.beginPath();
      x.moveTo(c+Math.cos(a)*r*(major?0.70:0.78),c+Math.sin(a)*r*(major?0.70:0.78));
      x.lineTo(c+Math.cos(a)*r*0.88,c+Math.sin(a)*r*0.88); x.stroke();
    }
    x.fillStyle=ink; x.font="700 "+Math.round(r*0.19)+"px "+font;
    x.textAlign="center"; x.textBaseline="middle";
    spec.nums.forEach((t,i)=>{
      const a=a0+sw*i/(spec.nums.length-1);
      x.fillText(t,c+Math.cos(a)*r*0.54,c+Math.sin(a)*r*0.54);
    });
    x.fillStyle=label; x.font="600 "+Math.round(r*0.15)+"px "+font;
    x.fillText(spec.label,c,c+r*0.42);
    if(spec.unit){ x.fillStyle=minor; x.font="500 "+Math.round(r*0.11)+"px "+font; x.fillText(spec.unit,c,c-r*0.30); }
  };
  function needleGeo(r){
    const s=new THREE.Shape();
    s.moveTo(-r*0.20,-r*0.035); s.lineTo(r*0.80,-r*0.012); s.lineTo(r*0.86,0);
    s.lineTo(r*0.80,r*0.012); s.lineTo(-r*0.20,r*0.035); s.closePath();
    return new THREE.ShapeGeometry(s);
  }
  /**
   * A group holding a face, bezel and lens at (x, y) on a panel facing +z.
   * With no face geometry the caller supplies its own (a live canvas, a rose).
   */
  function housing(parent,x,y,r,faceG,zz){
    const g=new THREE.Group(); g.position.set(x,y,zz??z);
    if(faceG){ const f=new THREE.Mesh(faceG,faceMat); f.receiveShadow=true; g.add(f); }
    const b=new THREE.Mesh(new THREE.TorusGeometry(r*1.04,r*0.085,12,48),bezel);
    b.position.z=0.004; b.castShadow=true; b.receiveShadow=true;
    const lens=new THREE.Mesh(new THREE.CircleGeometry(r,32),glass); lens.position.z=0.012;
    g.add(b,lens);
    parent.add(g);
    return g;
  }
  return {
    faceMat, glass, faceGeo, housing, needleMat:nMat,
    /** A needle dial: `read(t)` returns 0..1 of the scale. */
    gauge(parent,spec,x,y,r,zz){
      const g=housing(parent,x,y,r,faceGeo(r,paintScale(spec)),zz);
      const needle=new THREE.Mesh(needleGeo(r),nMat);
      needle.position.z=0.006; needle.userData.dynamic=true;
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(r*0.09,r*0.09,0.006,16),bezel);
      hub.rotation.x=Math.PI/2; hub.position.z=0.008;
      g.add(needle,hub);
      const o={needle,value:spec.start??0,read:spec.read};
      needles.push(o);
      return o;
    },
    update(t,dt){
      const k=1-Math.exp(-dt*7);
      for(const g of needles){
        g.value+=(g.read(t)-g.value)*k;
        g.needle.rotation.z=-(Math.PI*0.75+Math.PI*1.5*clamp(g.value,0,1.02));
      }
    }
  };
}

// ---------- readings the instruments share ----------
export const read={
  speed:()=>clamp(P.speed/150,0,1),
  alt:()=>clamp(P.y/400,0,1),
  fuel:()=>clamp(G.fuel/100,0,1),
  rpm:t=>0.70+Math.sin(t*0.011)*0.012+(P.speed/Aircraft.spec.speedMax)*0.22,
  vsi:()=>clamp(0.5+P.vy/40,0,1),
  heading:()=>(-P.roll*26+Game.wind*0.5+360)%360,
  agl:()=>P.y-groundH(P.x,P.z),
};

// ---------- the moving map ----------
/**
 * The course ahead, 1.5 km of it: the line in the course colour, gates (gold
 * flagged), fuel, hazards and the field. `style` is "paper" (a chart on a
 * kneeboard) or "glass" (a moving-map screen).
 */
export function drawMap(x,w,h,style){
  const paper=style==="paper";
  const C=paper?{bg:"#e9ddc0",grid:"rgba(150,130,95,0.45)",course:"#8a4a2a",ring:"#c33a28",hit:"#3f8f4f",gold:"#c08a12",
                 fuel:"#2f7f4f",haz:"#7a2a1a",field:"#1a1a1a",me:"#20180e",label:"rgba(90,70,40,0.7)"}
               :{bg:"#05080c",grid:"rgba(90,130,160,0.25)",course:"#e040c8",ring:"#4fd8ff",hit:"#3fe07a",gold:"#ffd21e",
                 fuel:"#3fe07a",haz:"#ff4d4d",field:"#ffffff",me:"#ffffff",label:"#9fd4ff"};
  x.fillStyle=C.bg; x.fillRect(0,0,w,h);
  const RANGE=1500, HALF=paper?560:620, s=w/384;
  const map=(wx,wz)=>({x:w/2+(wx-P.x)/HALF*(w/2), y:h-14*s-((P.z-wz)/RANGE)*(h-30*s)});
  x.strokeStyle=C.grid; x.lineWidth=1.2*s;
  if(paper){                                          // contours, roughly
    for(let i=0;i<7;i++){
      x.beginPath();
      for(let j=0;j<=10;j++){
        const wz=P.z-RANGE*(j/10), p=map(P.x-HALF+(i/6)*HALF*2+Math.sin(wz*0.002+i)*40,wz);
        j?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y);
      }
      x.stroke();
    }
  }else{
    for(const r of [500,1000,1500]){ x.beginPath(); x.arc(w/2,h-14*s,r/RANGE*(h-30*s),Math.PI,0); x.stroke(); }
  }
  x.strokeStyle=C.course; x.lineWidth=(paper?2.4:3)*s; x.beginPath();
  for(let j=0;j<=24;j++){ const wz=P.z-RANGE*(j/24), p=map(coursePathX(wz),wz); j?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y); }
  x.stroke();
  for(const r of Rings.list){
    if(!r.active||r.z>P.z||P.z-r.z>RANGE) continue;
    const p=map(r.x,r.z);
    x.strokeStyle=r.hit?C.hit:(r.gold?C.gold:C.ring); x.lineWidth=(r.gold?3.4:2.6)*s;
    x.beginPath(); x.arc(p.x,p.y,(r.gold?6.5:4.8)*s,0,7); x.stroke();
  }
  x.fillStyle=C.fuel;
  for(const f of Fuel.list){ if(!f.active||f.z>P.z||P.z-f.z>RANGE) continue; const p=map(f.x,f.z); x.fillRect(p.x-3.5*s,p.y-3.5*s,7*s,7*s); }
  x.fillStyle=C.haz;
  for(const l of [Haz.masts,Haz.turbines,Haz.balloons]) for(const hz of l){
    if(!hz.active||hz.z>P.z||P.z-hz.z>RANGE) continue; const p=map(hz.x,hz.z); x.fillRect(p.x-2.8*s,p.y-2.8*s,5.6*s,5.6*s);
  }
  x.strokeStyle=C.haz; x.lineWidth=2*s;
  for(const hz of Haz.lines){
    if(!hz.active||hz.z>P.z||P.z-hz.z>RANGE) continue;
    const a=map(hz.x-hz.span/2,hz.z), b=map(hz.x+hz.span/2,hz.z);
    x.beginPath(); x.moveTo(a.x,a.y); x.lineTo(b.x,b.y); x.stroke();
  }
  if(af.active&&af.z<P.z&&P.z-af.z<RANGE+af.len){
    const a=map(af.x,af.z+af.len/2), b=map(af.x,af.z-af.len/2);
    x.strokeStyle=C.field; x.lineWidth=6.5*s; x.beginPath(); x.moveTo(a.x,a.y); x.lineTo(b.x,b.y); x.stroke();
  }
  const me=map(P.x,P.z);
  x.fillStyle=C.me; x.beginPath();
  x.moveTo(me.x,me.y-10*s); x.lineTo(me.x-7.5*s,me.y+6*s); x.lineTo(me.x,me.y+2*s); x.lineTo(me.x+7.5*s,me.y+6*s); x.closePath(); x.fill();
  x.fillStyle=C.label; x.textBaseline="top";
  x.font="700 "+Math.round(17*s)+"px "+(paper?MONO:SANS); x.textAlign="left";
  x.fillText(paper?"CHART":"MAP",10*s,8*s);
  if(!paper){ x.textAlign="right"; x.fillStyle="#6f8aa0"; x.font="600 "+Math.round(14*s)+"px "+SANS; x.fillText("1.5 KM",w-10*s,10*s); }
}

// ---------- the run page ----------
/** A key that changes whenever anything on a run page would. */
export function runKey(){
  return [Math.floor(G.score),G.ringsHit,G.rings,G.combo,G.lvl,(P.dist/1000).toFixed(2),P.lives,
          Math.round(Tour.progressFrac()*100),G.objDone?1:0].join("|");
}
/**
 * The run's numbers: score, rings and chain, sector and distance, airframe,
 * sector progress. "paper" is a logbook card, "glass" a dark MFD page.
 */
export function drawRun(x,w,h,style){
  const paper=style==="paper", s=w/384, lives=Aircraft.spec.lives;
  const prog=Tour.progressFrac();
  if(paper){
    x.fillStyle="#efe4c8"; x.fillRect(0,0,w,h);
    x.strokeStyle="rgba(150,120,80,0.35)"; x.lineWidth=1;
    for(let y=58*s;y<h;y+=38*s){ x.beginPath(); x.moveTo(14*s,y); x.lineTo(w-14*s,y); x.stroke(); }
    x.fillStyle="#7a2a1a"; x.fillRect(14*s,14*s,w-28*s,4*s);
    x.textBaseline="middle";
    x.fillStyle="#2a1c10"; x.font="800 "+Math.round(44*s)+"px "+MONO; x.textAlign="left";
    x.fillText(Math.floor(G.score).toLocaleString(),18*s,82*s);
    x.fillStyle="#6a5a44"; x.font="700 "+Math.round(18*s)+"px "+MONO; x.textAlign="right"; x.fillText("SCORE",w-18*s,40*s);
    x.textAlign="left"; x.fillStyle="#2a1c10"; x.font="700 "+Math.round(26*s)+"px "+MONO;
    x.fillText("RINGS "+G.ringsHit+"/"+G.rings+(G.combo>1?"  x"+G.combo:""),18*s,134*s);
    x.fillText("S"+G.lvl+"   "+(P.dist/1000).toFixed(2)+" km",18*s,172*s);
    x.fillStyle=P.lives<=1?"#b02a1a":"#2a5a2a";
    x.fillText("AIRFRAME "+"■".repeat(Math.max(0,P.lives))+"□".repeat(Math.max(0,lives-P.lives)),18*s,210*s);
    x.fillStyle="rgba(40,28,14,0.25)"; x.fillRect(18*s,244*s,w-36*s,14*s);
    x.fillStyle="#c08a2a"; x.fillRect(18*s,244*s,(w-36*s)*prog,14*s);
    x.fillStyle="#6a5a44"; x.font="700 "+Math.round(15*s)+"px "+MONO; x.fillText("SECTOR"+(G.objDone?"  ✓ OBJECTIVE":""),18*s,272*s);
    return;
  }
  x.fillStyle="#05080c"; x.fillRect(0,0,w,h);
  x.textBaseline="alphabetic";
  x.fillStyle="#6f8aa0"; x.font="700 "+Math.round(16*s)+"px "+SANS; x.textAlign="left"; x.fillText("SCORE",14*s,28*s);
  x.fillStyle="#ffffff"; x.font="700 "+Math.round(54*s)+"px "+SANS; x.fillText(Math.floor(G.score).toLocaleString(),12*s,86*s);
  x.fillStyle="#6f8aa0"; x.font="700 "+Math.round(15*s)+"px "+SANS;
  x.fillText("RINGS",14*s,120*s); x.fillText("SECTOR",200*s,120*s);
  x.fillStyle="#ffffff"; x.font="700 "+Math.round(28*s)+"px "+SANS;
  x.fillText(G.ringsHit+"/"+G.rings,14*s,152*s);
  if(G.combo>1){ x.fillStyle="#ffd21e"; x.fillText("x"+G.combo,120*s,152*s); }
  x.fillStyle="#ffffff"; x.fillText("S"+G.lvl+"  "+(P.dist/1000).toFixed(1)+" km",200*s,152*s);
  x.fillStyle="#6f8aa0"; x.font="700 "+Math.round(15*s)+"px "+SANS; x.fillText("AIRFRAME",14*s,190*s);
  const bw=Math.min(38,132/lives)*s;
  for(let i=0;i<lives;i++){
    x.fillStyle=i<P.lives?(P.lives<=1?"#ff4d4d":"#3fe07a"):"#1e2830";
    x.fillRect(110*s+i*(bw+6*s),176*s,bw,16*s);
  }
  x.fillStyle="#1e2830"; x.fillRect(14*s,218*s,w-28*s,12*s);
  x.fillStyle="#4fd8ff"; x.fillRect(14*s,218*s,(w-28*s)*prog,12*s);
  x.fillStyle=G.objDone?"#3fe07a":"#6f8aa0"; x.font="600 "+Math.round(13*s)+"px "+SANS;
  x.fillText(G.objDone?"SECTOR PROGRESS · OBJECTIVE ✓":"SECTOR PROGRESS",14*s,248*s);
}

// ---------- the attitude display ----------
/** A primary flight display: horizon, pitch ladder, bank scale, tapes and heading. */
export function drawPFD(x,w,h,{tapes=true}={}){
  const cx=w*0.5, cy=h*0.52, s=h/256;
  const bank=P.roll, pitch=Math.atan2(P.vy,Math.max(10,P.speed))*57.3, ppd=5.2*s;
  x.save();
  x.beginPath(); x.rect(0,0,w,h); x.clip();
  x.translate(cx,cy); x.rotate(-bank); x.translate(0,pitch*ppd);
  x.fillStyle="#2e73d8"; x.fillRect(-w,-h*2,w*2,h*2);
  x.fillStyle="#8a5a2c"; x.fillRect(-w,0,w*2,h*2);
  x.fillStyle="#ffffff"; x.fillRect(-w,-1.5*s,w*2,3*s);
  x.font="600 "+Math.round(15*s)+"px "+SANS; x.textAlign="right"; x.textBaseline="middle";
  for(let d=-30;d<=30;d+=5){
    if(!d) continue;
    const y=-d*ppd, len=(d%10===0?64:34)*s;
    x.fillRect(-len/2,y-1*s,len,2*s);
    if(d%10===0) x.fillText(Math.abs(d),-len/2-6*s,y);
  }
  x.restore();
  x.strokeStyle="#fff"; x.lineWidth=2*s; x.fillStyle="#fff";
  x.beginPath(); x.arc(cx,cy,h*0.40,Math.PI*1.25,Math.PI*1.75); x.stroke();
  for(const a of [-45,-30,-20,-10,0,10,20,30,45]){
    const r=a*Math.PI/180-Math.PI/2, l=(a%30===0?14:8)*s;
    x.beginPath(); x.moveTo(cx+Math.cos(r)*h*0.40,cy+Math.sin(r)*h*0.40);
    x.lineTo(cx+Math.cos(r)*(h*0.40+l),cy+Math.sin(r)*(h*0.40+l)); x.stroke();
  }
  x.save(); x.translate(cx,cy); x.rotate(-bank);
  x.beginPath(); x.moveTo(0,-h*0.40+2*s); x.lineTo(-7*s,-h*0.40+14*s); x.lineTo(7*s,-h*0.40+14*s); x.closePath(); x.fill();
  x.restore();
  x.fillStyle="#ffd21e"; x.strokeStyle="#000"; x.lineWidth=1.5*s;
  x.beginPath(); x.moveTo(cx-70*s,cy); x.lineTo(cx-26*s,cy); x.lineTo(cx-26*s,cy+8*s); x.lineTo(cx-70*s,cy+8*s); x.closePath(); x.fill(); x.stroke();
  x.beginPath(); x.moveTo(cx+70*s,cy); x.lineTo(cx+26*s,cy); x.lineTo(cx+26*s,cy+8*s); x.lineTo(cx+70*s,cy+8*s); x.closePath(); x.fill(); x.stroke();
  x.fillRect(cx-4*s,cy-2*s,8*s,8*s);
  if(tapes){
    const tape=(x0,val,step,unit,left)=>{
      const tw=76*s;
      x.fillStyle="rgba(0,0,0,0.45)"; x.fillRect(x0,0,tw,h);
      x.fillStyle="#fff"; x.font="600 "+Math.round(15*s)+"px "+SANS; x.textAlign=left?"right":"left";
      for(let v=Math.floor((val-4*step)/step)*step;v<=val+4*step;v+=step){
        const y=cy-(v-val)*3*s;
        if(y<8*s||y>h-8*s) continue;
        x.fillRect(left?x0+62*s:x0,y-1*s,14*s,2*s);
        x.fillText(String(Math.round(v)),left?x0+58*s:x0+18*s,y);
      }
      x.fillStyle="#000"; x.strokeStyle="#fff"; x.lineWidth=2*s;
      x.beginPath(); x.rect(x0+2*s,cy-17*s,72*s,34*s); x.fill(); x.stroke();
      x.fillStyle="#fff"; x.font="700 "+Math.round(22*s)+"px "+SANS; x.textAlign="center";
      x.fillText(String(Math.round(val)),x0+38*s,cy+1*s);
      x.fillStyle="#9fd4ff"; x.font="600 "+Math.round(13*s)+"px "+SANS; x.fillText(unit,x0+38*s,14*s);
    };
    tape(0,P.speed*3.6,20,"KM/H",true);
    tape(w-76*s,P.y,20,"ALT M",false);
  }
  const head=read.heading();
  x.fillStyle="rgba(0,0,0,0.5)"; x.fillRect(96*s,0,w-192*s,26*s);
  x.fillStyle="#fff"; x.font="600 "+Math.round(14*s)+"px "+SANS; x.textAlign="center";
  for(let d=-40;d<=40;d+=10){
    const hd=((Math.round((head+d)/10)*10)%360+360)%360, off=((hd-head+540)%360)-180;
    const X=cx+off*3.4*s;
    if(X<104*s||X>w-104*s) continue;
    x.fillText(hd%90===0?"NESW"[hd/90]:String(hd/10),X,13*s);
  }
  x.fillStyle="#ffd21e"; x.beginPath(); x.moveTo(cx,26*s); x.lineTo(cx-6*s,34*s); x.lineTo(cx+6*s,34*s); x.closePath(); x.fill();
  const agl=read.agl();
  if(agl<150){ x.fillStyle=agl<40?"#ffae3a":"#9fd4ff"; x.font="700 "+Math.round(16*s)+"px "+SANS; x.textAlign="right"; x.fillText("AGL "+Math.max(0,Math.round(agl)),w-84*s,h-14*s); }
}

// ---------- warning lamps ----------
/** The three lamps every cockpit carries, in its own housing. */
export const LAMPS=[
  ["FUEL","#ffae3a",()=>G.fuel<20,true],
  ["TERR","#ff4b3e",()=>Game.warnObst,true],
  ["RWY","#46e07a",()=>af.active&&(af.phase===1||af.phase===2||af.phase===4),false],
];
/** Drive a list of {m, on, blink} lamp materials: bright when lit, dim when not. */
export function updateLamps(lamps,t,onI=3.0,offI=0.10){
  for(const l of lamps){
    const on=l.on()&&(!l.blink||Math.floor(t/260)%2===0);
    l.m.emissiveIntensity=on?onI:offI;
  }
}

// Skylark — the countryside's models: trees, hedges, farm buildings, rocks.
//
// Every model is built once, in metres, as a single merged geometry with its
// colours baked into vertex colours, so the scatter draws each kind with one
// instanced mesh and tints individual instances through instanceColor.
//
// Foliage is the part that decides whether a tree reads as a tree or as a
// gem. Canopies are clusters of lumpy spheres whose normals are bent toward
// the canopy's own centre, so the whole crown shades as one soft mass under
// the sun instead of as a hundred facets; the vertex colour darkens toward
// the base and the inside, which stands in for the self-shadowing a real crown
// has.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../util.js';

const _v=new THREE.Vector3(), _n=new THREE.Vector3(), _c=new THREE.Color();

/** Strip a primitive to position + normal and give it a colour attribute. */
function prep(geo){
  geo.deleteAttribute("uv");
  const n=geo.attributes.position.count;
  geo.setAttribute("color",new THREE.BufferAttribute(new Float32Array(n*3),3));
  return geo;
}
/** Paint every vertex, with an optional per-vertex shade(position, normal). */
function paint(geo,hex,shade){
  const p=geo.attributes.position, nr=geo.attributes.normal, c=geo.attributes.color;
  _c.set(hex);
  for(let i=0;i<p.count;i++){
    const k=shade?shade(_v.fromBufferAttribute(p,i),_n.fromBufferAttribute(nr,i)):1;
    c.setXYZ(i,_c.r*k,_c.g*k,_c.b*k);
  }
  return geo;
}
// mergeGeometries needs every part indexed or every part not; primitives come
// both ways, so everything is flattened first
function merge(parts){
  const flat=parts.map(p=>p.index?p.toNonIndexed():p);
  const g=mergeGeometries(flat,false);
  for(const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

// ---------- foliage ----------
/**
 * One lump of foliage: a jittered icosphere whose normals lean toward the
 * crown centre, coloured darker low down and on the inside.
 */
function lump(r,cx,cy,cz,crown,hex,rng,detail){
  const g=prep(new THREE.IcosahedronGeometry(r,detail));
  const p=g.attributes.position, nr=g.attributes.normal;
  // jitter by position, so vertices shared between faces move together
  const seed=rng()*100;
  for(let i=0;i<p.count;i++){
    _v.fromBufferAttribute(p,i);
    const j=1+0.16*Math.sin(_v.x*3.1+seed)*Math.cos(_v.y*2.7+seed*0.7)*Math.sin(_v.z*2.3+seed*1.3);
    p.setXYZ(i,_v.x*j+cx,_v.y*j+cy,_v.z*j+cz);
  }
  for(let i=0;i<p.count;i++){
    _v.fromBufferAttribute(p,i);
    const own=_n.fromBufferAttribute(nr,i).clone();
    const toCrown=_v.clone().sub(crown).normalize();
    nr.setXYZ(i,...own.multiplyScalar(0.35).add(toCrown.multiplyScalar(0.65)).normalize().toArray());
  }
  const top=crown.y+r, bot=crown.y-r*1.6;
  paint(g,hex,(v,n)=>{
    const up=Math.min(1,Math.max(0,(v.y-bot)/(top-bot)));
    const out=Math.min(1,v.clone().sub(crown).length()/(r*1.4));
    return 0.50+0.42*up+0.18*out;
  });
  return g;
}
function trunk(r0,r1,h,hex){
  const g=prep(new THREE.CylinderGeometry(r1,r0,h,6,1,true));
  g.translate(0,h/2,0);
  return paint(g,hex,v=>0.7+0.3*(v.y/h));
}

/** Broadleaf oak: a spreading crown of five or six lumps on a short bole. */
function oak(seed,detail){
  const rng=mulberry32(seed);
  const crown=new THREE.Vector3(0,7.0,0);
  const parts=[trunk(0.55,0.34,6.2,"#4e3c2c")];
  const n=5+((rng()*2)|0);
  parts.push(lump(3.1,0,7.2,0,crown,"#467834",rng,detail));
  for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2+rng()*0.6, d=2.0+rng()*0.9;
    parts.push(lump(2.1+rng()*0.8,Math.cos(a)*d,6.4+rng()*2.2,Math.sin(a)*d,crown,"#487a36",rng,detail));
  }
  parts.push(lump(2.2,0.4,9.0,-0.3,crown,"#54843c",rng,detail));
  return merge(parts);
}
/** Lombardy poplar: tall and narrow, the hedge-line landmark. */
function poplar(seed,detail){
  const rng=mulberry32(seed);
  const crown=new THREE.Vector3(0,8.5,0);
  const parts=[trunk(0.35,0.22,4.5,"#5a4a38")];
  for(let i=0;i<4;i++){
    const g=lump(1.7,0,0,0,crown,"#55853a",rng,detail);
    g.scale(1,1.9,1);
    g.translate((rng()-0.5)*0.6,4.8+i*2.6,(rng()-0.5)*0.6);
    parts.push(g);
  }
  return merge(parts);
}
/** Pine: dark tiers on a tall bare stem, for the uplands. */
function pine(seed,radial){
  const rng=mulberry32(seed);
  const parts=[trunk(0.40,0.25,6.5,"#5a4030")];
  const tiers=[[3.0,5.2,3.2],[2.4,7.4,2.8],[1.7,9.4,2.4],[1.0,11.0,1.8]];
  for(const [r,y,h] of tiers){
    const g=prep(new THREE.ConeGeometry(r*(0.9+rng()*0.2),h,radial,1));
    g.translate(0,y,0);
    parts.push(paint(g,"#2f5230",(v,n)=>0.55+0.35*Math.max(0,n.y)+0.12*(v.y/12)));
  }
  return merge(parts);
}

// ---------- hedges ----------
/**
 * One hedge segment, one metre long in x (scaled per instance to its length),
 * one metre high and wide: a lumpy rounded profile extruded along x. It
 * overlaps its neighbours slightly so a run of them reads as one hedge.
 */
function hedgeSegment(SEG,PROF){
  const pos=[], idx=[];
  for(let s=0;s<=SEG;s++){
    const x=-0.04+s/SEG*1.08;
    for(let k=0;k<PROF;k++){
      const a=k/(PROF-1)*Math.PI;                       // 0 at one foot, pi at the other
      const bump=1+0.18*Math.sin(x*19.0+k*1.7)*Math.sin(x*7.3+k*0.9);
      const y=Math.sin(a)*bump, z=Math.cos(a)*0.5*(0.92+0.12*Math.sin(x*11+k));
      pos.push(x,y,z);
    }
  }
  for(let s=0;s<SEG;s++) for(let k=0;k<PROF-1;k++){
    const a=s*PROF+k, b=a+PROF;
    idx.push(a,b,a+1, a+1,b,b+1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute("color",new THREE.BufferAttribute(new Float32Array(pos.length),3));
  return paint(g,"#3a5f2c",v=>0.45+0.55*Math.min(1,v.y));
}

// ---------- farm buildings ----------
/** A gable roof over a w x d footprint, ridge along x, with overhang. */
function gableRoof(w,d,eave,pitch,hex,over){
  const hw=w/2+over, hd=d/2+over, top=eave+pitch;
  const P=[                                  // two slopes, each a quad
    [-hw,eave,hd],[hw,eave,hd],[hw,top,0],[-hw,top,0],
    [hw,eave,-hd],[-hw,eave,-hd],[-hw,top,0],[hw,top,0],
  ];
  const pos=[], idx=[];
  for(const p of P) pos.push(...p);
  idx.push(0,1,2, 0,2,3, 4,5,6, 4,6,7);
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx);
  const ng=g.toNonIndexed();
  ng.computeVertexNormals();
  ng.setAttribute("color",new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count*3),3));
  return paint(ng,hex);
}
/** The two triangular gable ends, in the wall colour. */
function gables(w,d,eave,pitch,hex){
  const hw=w/2, hd=d/2, top=eave+pitch;
  const pos=[ hw,eave,hd, hw,eave,-hd, hw,top,0,   -hw,eave,-hd, -hw,eave,hd, -hw,top,0 ];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.computeVertexNormals();
  g.setAttribute("color",new THREE.BufferAttribute(new Float32Array(6*3),3));
  return paint(g,hex);
}
function box(w,h,d,x,y,z,hex,shade){
  const g=prep(new THREE.BoxGeometry(w,h,d)).toNonIndexed();
  g.translate(x,y+h/2,z);
  return paint(g,hex,shade);
}
/** Windows and a door let into both long walls. */
function openings(w,d,eave,rows,cols,door,glass,frame){
  const parts=[];
  for(const side of [1,-1]){
    const z=side*(d/2+0.03);
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const x=-w/2+w*(c+0.5)/cols;
        if(door&&r===0&&c===Math.floor(cols/2)&&side===1){
          parts.push(box(1.1,2.1,0.12,x,0,z,frame));
          continue;
        }
        const y=eave*(r+0.42)/rows;
        parts.push(box(1.05,1.15,0.10,x,y,z,frame));
        parts.push(box(0.80,0.90,0.14,x,y+0.12,z,glass));
      }
    }
  }
  return parts;
}

/** Whitewashed cottage, red tile roof, chimney at the gable. */
function cottage(){
  const w=10, d=6.4, eave=5.0, pitch=3.0;
  const wall="#ece6d6";
  return merge([
    box(w,eave,d,0,0,0,wall,(v,n)=>n.y<0.5?1:1),
    gables(w,d,eave,pitch,wall),
    gableRoof(w,d,eave,pitch,"#9a4a34",0.45),
    box(0.9,2.2,1.2,w/2-0.6,eave+pitch-0.6,0,"#8a5a44"),
    ...openings(w,d,eave,2,3,true,"#2b333c","#f4f0e6"),
  ]);
}
/** Stone farmhouse, slate roof, two chimneys. */
function farmhouse(){
  const w=12.5, d=7.2, eave=5.6, pitch=3.4;
  const wall="#b8ac96";
  return merge([
    box(w,eave,d,0,0,0,wall),
    gables(w,d,eave,pitch,wall),
    gableRoof(w,d,eave,pitch,"#5c6068",0.40),
    box(1.0,2.4,1.3,-w/2+0.7,eave+pitch-0.7,0,"#9a8e7a"),
    box(1.0,2.4,1.3, w/2-0.7,eave+pitch-0.7,0,"#9a8e7a"),
    ...openings(w,d,eave,2,4,true,"#262e36","#e8e2d2"),
    // a lean-to on the back
    box(5.0,3.0,3.2,-2.2,0,-d/2-1.6,wall),
    gableRoof(5.0,3.2,3.0,0.9,"#5c6068",0.2).translate(-2.2,0,-d/2-1.6),
  ]);
}
/** Timber barn: dark boards, grey corrugated roof, big doors. */
function barn(){
  const w=18, d=9.5, eave=4.8, pitch=4.2;
  const wall="#5e4636";
  return merge([
    box(w,eave,d,0,0,0,wall),
    gables(w,d,eave,pitch,wall),
    gableRoof(w,d,eave,pitch,"#7a7e7c",0.35),
    box(4.4,4.0,0.2,0,0,d/2+0.05,"#3a2a20"),
    box(4.4,4.0,0.2,0,0,-d/2-0.05,"#3a2a20"),
  ]);
}
/** Red brick barn with a pale roof, for colour in the yard. */
function redBarn(){
  const w=15, d=8.5, eave=5.2, pitch=3.8;
  const wall="#8e3e2e";
  return merge([
    box(w,eave,d,0,0,0,wall),
    gables(w,d,eave,pitch,wall),
    gableRoof(w,d,eave,pitch,"#6a6f70",0.35),
    box(3.6,3.8,0.2,-3,0,d/2+0.05,"#e8e0cc"),
    box(3.2,3.4,0.24,-3,0,d/2+0.07,"#5a2a20"),
  ]);
}
/** A low stone shed. */
function shed(){
  const w=7, d=4.6, eave=2.8, pitch=1.6;
  const wall="#a49a88";
  return merge([
    box(w,eave,d,0,0,0,wall),
    gables(w,d,eave,pitch,wall),
    gableRoof(w,d,eave,pitch,"#586068",0.3),
    box(1.2,2.0,0.12,1.4,0,d/2+0.03,"#4a3a2c"),
  ]);
}

// ---------- the airfield ----------
/** An arched hangar: brick flanks, a ribbed barrel roof, sliding doors. */
export function makeHangar(){
  const w=54, d=60, wall=10, rise=12;
  const parts=[box(w,wall,d,0,0,0,"#9a7a62")];
  // the barrel roof, ribbed by shading alternate panels
  const SEG=18, pos=[];
  for(let i=0;i<SEG;i++){
    const a0=i/SEG*Math.PI, a1=(i+1)/SEG*Math.PI;
    const x0=Math.cos(a0)*w/2*1.02, y0=wall+Math.sin(a0)*rise;
    const x1=Math.cos(a1)*w/2*1.02, y1=wall+Math.sin(a1)*rise;
    pos.push(x0,y0,d/2+0.4, x1,y1,d/2+0.4, x1,y1,-d/2-0.4,  x0,y0,d/2+0.4, x1,y1,-d/2-0.4, x0,y0,-d/2-0.4);
  }
  const roof=new THREE.BufferGeometry();
  roof.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  roof.computeVertexNormals();
  roof.setAttribute("color",new THREE.BufferAttribute(new Float32Array(pos.length),3));
  paint(roof,"#8c948e",(v,n)=>(Math.floor((Math.atan2(v.y-wall,v.x)/Math.PI)*SEG*2)%2?0.86:1.0));
  parts.push(roof);
  // the arched gable ends, filled, with the doors let into the front
  for(const side of [1,-1]){
    const fan=[];
    for(let i=0;i<SEG;i++){
      const a0=i/SEG*Math.PI, a1=(i+1)/SEG*Math.PI;
      const z=side*(d/2+0.05);
      const p0=[Math.cos(a0)*w/2, wall+Math.sin(a0)*rise], p1=[Math.cos(a1)*w/2, wall+Math.sin(a1)*rise];
      if(side>0) fan.push(0,wall,z, p0[0],p0[1],z, p1[0],p1[1],z);
      else       fan.push(0,wall,z, p1[0],p1[1],z, p0[0],p0[1],z);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(fan,3));
    g.computeVertexNormals();
    g.setAttribute("color",new THREE.BufferAttribute(new Float32Array(fan.length),3));
    parts.push(paint(g,"#b8b4a8"));
  }
  for(let i=0;i<6;i++){
    parts.push(box(7.6,9.2,0.3,-w/2+4.9+i*8.8,0,d/2+0.12,i%2?"#5c6a70":"#66747a"));
  }
  parts.push(box(w-2,0.8,0.4,0,9.2,d/2+0.2,"#3e4448"));
  return merge(parts);
}
/** The watch office: two rendered storeys, a glazed cab, a railed roof. */
export function makeTower(){
  const parts=[
    box(16,8,12,0,0,0,"#ece8dc"),
    box(12,4.5,9,0,8,0,"#ece8dc"),
    box(12.4,2.8,9.4,0,9.2,0,"#2c3a44"),                 // the glazed cab
    box(17,0.5,13,0,8,0,"#b8b2a4"),                      // the balcony slab
    box(12.8,0.5,9.8,0,12.5,0,"#b8b2a4"),
    box(1.2,3,1.2,4,13,2.5,"#6a6e70"),                   // anemometer mast foot
    box(0.25,5,0.25,4,16,2.5,"#6a6e70"),
  ];
  // the balcony rail, as posts round the slab
  for(let i=0;i<=8;i++){
    const t=i/8*17-8.5;
    parts.push(box(0.2,1.1,0.2,t,8.5,6.4,"#ffffff"));
    parts.push(box(0.2,1.1,0.2,t,8.5,-6.4,"#ffffff"));
  }
  parts.push(box(17,0.18,0.18,0,9.6,6.4,"#ffffff"));
  parts.push(box(17,0.18,0.18,0,9.6,-6.4,"#ffffff"));
  // ground-floor windows, the long way
  for(const side of [1,-1]) for(let i=0;i<4;i++){
    parts.push(box(2.2,1.8,0.12,-6+i*4,2.6,side*6.05,"#2c3a44"));
    parts.push(box(2.2,1.8,0.12,-6+i*4,5.4,side*6.05,"#2c3a44"));
  }
  return merge(parts);
}
/** A parked parasol monoplane, in its owner's colours. */
export function makeParkedPlane(body,trim){
  const parts=[];
  const fus=prep(new THREE.CylinderGeometry(0.55,0.95,7.2,10));
  fus.rotateX(Math.PI/2); fus.translate(0,2.2,0.4);
  parts.push(paint(fus,body,(v,n)=>0.75+0.25*Math.max(0,n.y)));
  const cowl=prep(new THREE.CylinderGeometry(0.95,0.95,1.2,10));
  cowl.rotateX(Math.PI/2); cowl.translate(0,2.2,-3.7);
  parts.push(paint(cowl,trim));
  parts.push(box(10.5,0.22,1.9,0,3.9,-1.4,body));        // the parasol wing
  parts.push(box(0.14,1.5,0.14,-1.1,2.4,-1.4,"#3a3632"));
  parts.push(box(0.14,1.5,0.14,1.1,2.4,-1.4,"#3a3632"));
  parts.push(box(3.6,0.14,1.1,0,2.4,3.6,body));          // tailplane
  parts.push(box(0.14,1.4,1.2,0,2.4,3.6,trim));          // fin
  for(const sx of [-1,1]){
    const wh=prep(new THREE.CylinderGeometry(0.45,0.45,0.25,10));
    wh.rotateZ(Math.PI/2); wh.translate(sx*1.0,0.45,-2.2);
    parts.push(paint(wh,"#2a2622"));
  }
  parts.push(box(0.12,2.0,0.18,0,1.2,-4.35,"#5a4632")); // propeller, stopped
  return merge(parts);
}

// ---------- rocks and bales ----------
function rock(){
  const g=prep(new THREE.DodecahedronGeometry(1,1));
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    _v.fromBufferAttribute(p,i);
    const j=1+0.22*Math.sin(_v.x*4.1)*Math.cos(_v.z*3.3+_v.y*2.1);
    p.setXYZ(i,_v.x*j,_v.y*j,_v.z*j);
  }
  g.computeVertexNormals();
  return paint(g,"#8c867a",(v,n)=>0.6+0.4*Math.max(0,n.y));
}
function bale(){
  const g=prep(new THREE.CylinderGeometry(1,1,1,14,1));
  g.rotateZ(Math.PI/2);
  return paint(g,"#c8a860",(v,n)=>Math.abs(n.x)>0.8?0.82:1.0);
}

/**
 * Every model, built once, as a pair: `near` for the ground close to the
 * aircraft, where things are big on screen and cast shadows, and `far` for
 * everything beyond, where a quarter of the triangles look the same.
 * Tree kinds come in two seeds each for variety.
 */
const pair=(near,far)=>({near,far:far||near});
export const Models={
  oak0:pair(oak(11,1),oak(11,0)),
  oak1:pair(oak(29,1),oak(29,0)),
  poplar:pair(poplar(7,1),poplar(7,0)),
  pine0:pair(pine(5,7),pine(5,5)),
  pine1:pair(pine(13,7),pine(13,5)),
  hedge:pair(hedgeSegment(7,8),hedgeSegment(3,5)),
  cottage:pair(cottage()), farmhouse:pair(farmhouse()), barn:pair(barn()),
  redBarn:pair(redBarn()), shed:pair(shed()),
  rock:pair(rock()),
  hay:pair(bale()),
};

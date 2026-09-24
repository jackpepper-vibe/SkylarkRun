// Skylark — the land: its shape, its fields, and the shader that paints them.
//
// One pure height function drives geometry, scatter placement and collision,
// so what you see is exactly what you hit. On top of that sits a field plan:
// every 95 m cell of the countryside is pasture, arable or woodland, with a
// crop, a row direction, hedges on some edges and a gate in them. The plan is
// deterministic, so the scatter (which plants the 3D hedges, trees and bales)
// and the ground shader (which paints the fields) read the same answer and
// agree about where every hedge runs.
//
// The ground is painted per pixel rather than per vertex. Vertex colours at
// terrain resolution smear a 95 m field into a soft blob; the shader instead
// looks the field up in a small data texture of plans around the aircraft and
// draws crop rows, furrows, tramlines, mowing stripes, headlands and hedge
// lines at whatever resolution the screen has, anti-aliased by their own
// screen-space frequency so nothing shimmers at a distance.
import * as THREE from 'three';
import { clamp, hash2, mulberry32, smooth, lerp, vnoise, tileableNoise } from '../util.js';
import { scene, renderer } from '../view.js';
import { Atmosphere } from '../atmosphere.js';
import { CANOPY_H } from './config.js';
import { P } from '../state.js';
import { Water } from './water.js';

// ---------- sector themes: the shape of the land ----------
export const THEMES=[
  {name:"MEADOWS",  amp:82,  f:1.05, ridge:1.00, water:-52, wood:0.60, arable:0.34},
  {name:"HIGHLANDS",amp:142, f:0.80, ridge:1.28, water:-96, wood:0.66, arable:0.46},
  {name:"LAKELAND", amp:96,  f:1.20, ridge:1.10, water:-14, wood:0.58, arable:0.40},
  {name:"DOWNLAND", amp:64,  f:0.92, ridge:0.94, water:-46, wood:0.68, arable:0.28},
];
export let TH=THEMES[0];
export function setTerrainTheme(i){ TH=THEMES[i]; }

// ---------- the airfield's footprint ----------
// Shared state for whichever strip is live: the height field grades flat
// under it, the scatter keeps it clear and the shader mows it.
export const af={active:false,x:0,z:0,y:0,len:1000,wid:64,group:null,
          phase:0,seen:false,rollT:0,strobes:null,papi:null,edge:null,
          windsockPivot:null};

// ---------- terrain height field ----------
export function baseH(x,z){
  const f=TH.f;
  let h =vnoise(x*0.00072*f, z*0.00072*f);
  h    +=vnoise(x*0.00210*f, z*0.00210*f)*0.42;
  h    +=vnoise(x*0.00580*f, z*0.00580*f)*0.15;
  h    +=vnoise(x*0.01400*f, z*0.01400*f)*0.06;        // hummocks and lane cuttings
  h=(h/1.63-0.5)*2;                                    // -1 .. 1
  const s=h<0?-1:1;
  return s*Math.pow(Math.abs(h),TH.ridge)*TH.amp;
}
export function groundH(x,z){
  let h=baseH(x,z);
  if(af.active){                                       // the airfield is graded flat
    const dx=Math.abs(x-af.x)-af.wid*0.5-80;
    const dz=Math.abs(z-af.z)-af.len*0.5-160;
    const d=Math.hypot(Math.max(0,dx),Math.max(0,dz));
    if(d<300){ const k=smooth(1-d/300); h=lerp(h,af.y,k); }
  }
  return h;
}
export function landuse(x,z){
  return vnoise(x*0.0024+7.7, z*0.0024+3.1)*0.72 + vnoise(x*0.0071+2.3, z*0.0071+5.9)*0.28;
}
export function isWood(x,z){ return landuse(x,z)>TH.wood; }
export function onField(x,z){                           // inside the graded airfield
  return af.active&&Math.abs(x-af.x)<af.wid*0.5+55&&Math.abs(z-af.z)<af.len*0.5+140;
}
// clearance = the altitude below which you are into the scenery
export function clearanceH(x,z){
  const g=groundH(x,z);
  if(onField(x,z)) return g;
  return g+(isWood(x,z)?CANOPY_H:2);
}

// ---------- the field plan ----------
export const CELL=95;
/** What grows in a field. Arable crops first, then grass, by palette index. */
export const CROP={ WHEAT:0, BARLEY:1, PLOUGH:2, GREEN:3, RAPE:4, STUBBLE:5 };
export const KIND={ PASTURE:0, ARABLE:1, WOOD:2 };

/**
 * The plan for one cell: what it is, which of its own edges (north = its
 * z-min side, west = its x-min side) carry a hedge, where the gate is, and
 * which way the rows run. Pure: the same cell always gets the same plan.
 */
export function cellPlan(gx,gz,out){
  const o=out||{};
  const r=mulberry32(((gx*73856093)^(gz*19349663))|0);
  const lu=landuse(gx*CELL+CELL*0.5, gz*CELL+CELL*0.5);
  o.lu=lu;
  o.kind=lu>TH.wood?KIND.WOOD:(lu>TH.arable?KIND.ARABLE:KIND.PASTURE);
  if(o.kind===KIND.ARABLE){
    const c=r();
    o.variant=c<0.26?CROP.WHEAT:c<0.44?CROP.BARLEY:c<0.62?CROP.PLOUGH:c<0.82?CROP.GREEN:c<0.90?CROP.RAPE:CROP.STUBBLE;
    o.hedgeN=r()<0.82; o.hedgeW=r()<0.72;
  }else{
    o.variant=(r()*6)|0;
    // pasture is fenced more often than hedged, but the old hedges survive
    o.hedgeN=r()<0.30; o.hedgeW=r()<0.24;
  }
  o.gate=0.15+r()*0.70;                 // along each hedged edge, as a fraction
  o.tint=r();
  o.angle=(r()<0.5?0:Math.PI*0.5)+(r()-0.5)*0.30;
  return o;
}

// ---------- the field map: plans around the aircraft, as a texture ----------
// 64 x 64 cells (about 6 km square), addressed toroidally: cell (gx, gz) lives
// at texel (gx mod 64, gz mod 64), so the window slides with the aircraft and
// only the texture contents change. It is offset forward, because almost all
// of the visible land is ahead.
const FN=64;
const FieldMap={
  data:new Uint8Array(FN*FN*4),
  tex:null, cx:1e9, cz:1e9,
  plan:{},
  build(){
    this.tex=new THREE.DataTexture(this.data,FN,FN,THREE.RGBAFormat,THREE.UnsignedByteType);
    this.tex.magFilter=THREE.NearestFilter; this.tex.minFilter=THREE.NearestFilter;
    this.tex.wrapS=this.tex.wrapT=THREE.RepeatWrapping;
    this.tex.generateMipmaps=false;
    this.tex.needsUpdate=true;
  },
  refresh(force){
    const cx=Math.floor(P.x/CELL), cz=Math.floor(P.z/CELL);
    if(!force&&cx===this.cx&&cz===this.cz) return;
    this.cx=cx; this.cz=cz;
    const d=this.data, p=this.plan;
    const gx0=cx-(FN>>1), gz0=cz-FN+14;
    for(let j=0;j<FN;j++){
      const gz=gz0+j, tz=((gz%FN)+FN)%FN;
      for(let i=0;i<FN;i++){
        const gx=gx0+i, tx=((gx%FN)+FN)%FN;
        cellPlan(gx,gz,p);
        const o=(tz*FN+tx)*4;
        d[o]  =p.kind*64+p.variant;
        d[o+1]=(p.tint*255)|0;
        d[o+2]=(p.hedgeN?1:0)|(p.hedgeW?2:0)|(Math.round(p.gate*63)<<2);
        d[o+3]=Math.round(((p.angle%Math.PI)+Math.PI)%Math.PI/Math.PI*255);
      }
    }
    this.tex.needsUpdate=true;
  }
};
FieldMap.build();

// ---------- detail noise: three tileable octaves, one per channel ----------
function makeDetailTexture(){
  const N=256;
  const img=new Uint8Array(N*N*4);
  const oct=[[4,11],[8,23],[16,37],[32,53],[64,71]].map(([p,sd])=>[p,tileableNoise(p,sd)]);
  // octaves `from`..`to`, each wrapping at the texture's edge
  const fbm=(x,y,from,to)=>{
    let sum=0;
    let amp=0.5;
    let tot=0;
    for(let k=from;k<to;k++){ sum+=oct[k][1](x*oct[k][0]/N,y*oct[k][0]/N)*amp; tot+=amp; amp*=0.55; }
    return sum/tot;
  };
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const o=(y*N+x)*4;
    img[o]  =clamp(fbm(x,y,0,3)*1.6-0.3,0,1)*255;       // broad mottling
    img[o+1]=clamp(fbm(x,y,1,4)*1.7-0.35,0,1)*255;      // clumps
    img[o+2]=clamp(fbm(x,y,2,5)*1.8-0.4,0,1)*255;       // grain
    img[o+3]=255;
  }
  const t=new THREE.DataTexture(img,N,N,THREE.RGBAFormat,THREE.UnsignedByteType);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.magFilter=THREE.LinearFilter; t.minFilter=THREE.LinearMipmapLinearFilter;
  t.generateMipmaps=true;
  t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate=true;
  return t;
}

// ---------- the ground material ----------
const lin=hex=>new THREE.Color(hex);           // sRGB hex -> linear working colour
const groundUniforms={
  fieldMap:{value:FieldMap.tex}, fieldN:{value:FN}, cellSize:{value:CELL},
  detailMap:{value:makeDetailTexture()},
  cropCol:{value:["#c7a24e","#d6c07e","#6c5037","#6c9638","#d9c53c","#bba36c"].map(lin)},
  grassCol:{value:["#4d7c33","#58883a","#44732e","#5f8c46","#527d38","#668f43"].map(lin)},
  woodCol:{value:lin("#243d1d")}, heathCol:{value:lin("#7a6c48")}, rockCol:{value:lin("#7b7366")},
  sandCol:{value:lin("#cdb988")}, snowCol:{value:lin("#eef2f6")}, mownCol:{value:lin("#5a8a3a")},
  hedgeCol:{value:lin("#35522a")}, marginCol:{value:lin("#6f9446")},
  waterLevel:{value:-52}, amp:{value:82}, woodTh:{value:0.6},
  afRect:{value:new THREE.Vector4(0,0,0,0)},
};

const GROUND_VERT_PARS=`
attribute vec2 land;
varying vec3 vTW;
varying vec2 vLand;
varying float vUp;
`;
const GROUND_VERT=`
vTW=(modelMatrix*vec4(transformed,1.0)).xyz;
vLand=land;
vUp=objectNormal.y;
`;
const GROUND_FRAG_PARS=`
varying vec3 vTW;
varying vec2 vLand;
varying float vUp;
uniform sampler2D fieldMap, detailMap;
uniform float fieldN, cellSize, waterLevel, amp, woodTh;
uniform vec3 cropCol[6], grassCol[6];
uniform vec3 woodCol, heathCol, rockCol, sandCol, snowCol, mownCol, hedgeCol, marginCol;
uniform vec4 afRect;

vec4 plan(vec2 c){ return texture2D(fieldMap,(c+0.5)/fieldN); }
// a periodic band pattern that fades out before it can alias
float bands(float u,float period,float fw){
  return sin(u*6.2831853/period)*(1.0-smoothstep(0.18,0.45,fw/period));
}
// a hedge along one edge: dist is metres from the edge line, along is metres
// along it; the gate is a gap in it
float hedgeLine(float dist,float along,float gate,float wob,float fw){
  float w=1.1+wob*0.7;
  float m=1.0-smoothstep(w,w+fw*1.5+0.3,dist);
  float g=smoothstep(3.0,4.2,abs(along-gate*cellSize));
  return m*g;
}
vec3 groundAlbedo(){
  vec2 wp=vTW.xz; float h=vTW.y;
  vec2 cp=wp/cellSize, c=floor(cp), lp=(cp-c)*cellSize;
  vec4 d=plan(c);
  float code=floor(d.r*255.0+0.5);
  float kind=floor(code/64.0);
  int vi=int(mod(code,64.0));
  float bits=floor(d.b*255.0+0.5);
  float gate=floor(bits/4.0)/63.0;
  float ang=d.a*3.1415927;
  vec2 rd=vec2(cos(ang),sin(ang));
  float along=dot(wp,rd), across=dot(wp,vec2(-rd.y,rd.x));
  float fwA=fwidth(across), fwL=fwidth(along), fwP=fwidth(wp.x)+fwidth(wp.y);

  vec3 D1=texture2D(detailMap,wp*0.0019).rgb;
  vec3 D2=texture2D(detailMap,wp*0.021).rgb;
  vec3 D3=texture2D(detailMap,wp*0.19).rgb;
  float mottle=D1.r, clumps=D2.g, grain=D3.b;

  vec3 col;
  float edge=min(min(lp.x,cellSize-lp.x),min(lp.y,cellSize-lp.y));
  if(kind>0.5&&kind<1.5){                                      // arable
    col=cropCol[vi];
    bool plough=vi==2;
    col*=1.0+(plough?0.20:0.08)*bands(across,plough?1.5:0.9,fwA);
    // tramlines: paired wheel tracks every 24 m, darker in standing crops
    float dt=abs(fract(across/24.0+0.5)-0.5)*24.0;
    float tram=(1.0-smoothstep(0.25,0.25+fwA*1.5+0.2,abs(dt-0.9)))*(1.0-smoothstep(0.6,1.6,fwA));
    col*=1.0-(plough?0.0:0.16)*tram;
    col*=0.90+0.22*clumps*(plough?0.6:1.0);
    // an uncultivated grass headland round the field
    col=mix(marginCol*(0.85+0.3*clumps),col,smoothstep(3.2,4.6+fwP,edge));
  }else{                                                       // pasture
    col=grassCol[vi];
    col*=1.0+0.055*clamp(bands(along,15.0,fwL)*3.0,-1.0,1.0);  // mowing stripes
    col*=0.82+0.34*clumps;
  }
  col*=0.90+0.20*d.g;                                          // each field its own shade
  col*=0.80+0.40*mottle;

  // hedges on this cell's own north and west edges, and on the neighbours'
  // edges that bound it to the south and east
  vec4 dE=plan(c+vec2(1.0,0.0)), dS=plan(c+vec2(0.0,1.0));
  float bE=floor(dE.b*255.0+0.5), bS=floor(dS.b*255.0+0.5);
  float wob=D2.r;
  float hedge=0.0;
  if(mod(bits,2.0)>0.5)        hedge=max(hedge,hedgeLine(lp.y,lp.x,gate,wob,fwP));
  if(mod(floor(bits/2.0),2.0)>0.5) hedge=max(hedge,hedgeLine(lp.x,lp.y,gate,wob,fwP));
  if(mod(bS,2.0)>0.5)          hedge=max(hedge,hedgeLine(cellSize-lp.y,lp.x,floor(bS/4.0)/63.0,wob,fwP));
  if(mod(floor(bE/2.0),2.0)>0.5)   hedge=max(hedge,hedgeLine(cellSize-lp.x,lp.y,floor(bE/4.0)/63.0,wob,fwP));
  col=mix(col,hedgeCol*(0.75+0.5*D3.g),hedge);

  // woodland follows the land-use field itself, so its edge is organic
  float lu=vLand.x+(clumps-0.5)*0.035;
  float fwU=fwidth(lu);
  float wood=smoothstep(woodTh-fwU-0.003,woodTh+fwU+0.003,lu);
  col=mix(col,woodCol*(0.70+0.6*D2.b)*(0.85+0.3*grain),wood);

  // high ground goes to heath, steep ground to bare rock
  float heath=smoothstep(amp*0.56,amp*0.72,h+(mottle-0.5)*26.0)*(1.0-wood);
  col=mix(col,heathCol*(0.8+0.4*clumps),heath);
  float rock=smoothstep(0.90,0.76,vUp);
  col=mix(col,rockCol*(0.75+0.5*grain),rock);

  // shoreline sand, darker where it is wet
  float sand=1.0-smoothstep(waterLevel+1.2,waterLevel+3.6,h+(clumps-0.5)*1.6);
  col=mix(col,sandCol*(0.88+0.24*grain),sand);
  col*=1.0-0.38*(1.0-smoothstep(waterLevel+0.1,waterLevel+1.0,h));

  // snow on the tops
  float snow=smoothstep(amp*1.00,amp*1.10,h+(mottle-0.5)*16.0)*smoothstep(0.62,0.82,vUp);
  col=mix(col,snowCol,snow);

  // the airfield: mown, striped, and clear of hedges
  if(afRect.z>0.0){
    vec2 q=abs(wp-afRect.xy)-afRect.zw;
    float inside=1.0-smoothstep(-2.0,2.0+fwP,max(q.x,q.y));
    vec3 mown=mownCol*(1.0+0.06*clamp(bands(wp.x,18.0,fwidth(wp.x))*3.0,-1.0,1.0))*(0.9+0.2*clumps);
    col=mix(col,mown,inside);
  }

  // grain close in: this is what carries the sense of speed at hedge height
  float near=1.0-smoothstep(40.0,340.0,length(vTW-cameraPosition));
  col*=mix(1.0,0.78+0.44*grain,near);
  return col*vLand.y;
}
`;

const groundMat=new THREE.MeshLambertMaterial({color:0xffffff});
groundMat.onBeforeCompile=shader=>{
  Atmosphere.inject(shader);
  Object.assign(shader.uniforms,groundUniforms);
  shader.vertexShader=shader.vertexShader
    .replace("#include <common>","#include <common>\n"+GROUND_VERT_PARS)
    .replace("#include <begin_vertex>","#include <begin_vertex>\n"+GROUND_VERT);
  shader.fragmentShader=shader.fragmentShader
    .replace("#include <common>","#include <common>\n"+GROUND_FRAG_PARS)
    .replace("#include <color_fragment>","#include <color_fragment>\n diffuseColor.rgb=groundAlbedo();");
};
groundMat.customProgramCacheKey=()=>"skylark-ground";

// ---------- terrain tiles (pooled, recycled around the aircraft) ----------
const TILE=420, TSEG=24, GX=7, GZ=10;
export const Terrain={
  tiles:[], cx:1e9, cz:1e9, mat:groundMat,
  build(){
    for(let i=0;i<GX*GZ;i++){
      const geo=new THREE.PlaneGeometry(TILE,TILE,TSEG,TSEG);
      geo.rotateX(-Math.PI/2);
      const n=geo.attributes.position.count;
      geo.setAttribute("land",new THREE.BufferAttribute(new Float32Array(n*2),2));
      const mesh=new THREE.Mesh(geo,groundMat);
      mesh.matrixAutoUpdate=false;
      mesh.visible=false;
      mesh.receiveShadow=true;
      scene.add(mesh);
      this.tiles.push({mesh,key:null});
    }
  },
  fill(t,ix,iz){
    const ox=ix*TILE, oz=iz*TILE;
    const geo=t.mesh.geometry;
    const arr=geo.attributes.position.array;
    const na=geo.attributes.normal.array;
    const la=geo.attributes.land.array;
    const n=geo.attributes.position.count;
    const E=14, R=40;
    for(let i=0;i<n;i++){
      const wx=ox+arr[i*3], wz=oz+arr[i*3+2];
      const h=groundH(wx,wz);
      arr[i*3+1]=h;
      // analytic normals keep the lighting continuous across tile seams
      const nx=-(groundH(wx+E,wz)-groundH(wx-E,wz)), ny=2*E,
            nz=-(groundH(wx,wz+E)-groundH(wx,wz-E));
      const inv=1/Math.hypot(nx,ny,nz);
      na[i*3]=nx*inv; na[i*3+1]=ny*inv; na[i*3+2]=nz*inv;
      // hollows sit in their own shade: how far below its surroundings this is
      const around=(groundH(wx+R,wz)+groundH(wx-R,wz)+groundH(wx,wz+R)+groundH(wx,wz-R))*0.25;
      la[i*2]=landuse(wx,wz);
      la[i*2+1]=clamp(1+(h-around)*0.014,0.70,1.06);
    }
    geo.attributes.position.needsUpdate=true;
    geo.attributes.normal.needsUpdate=true;
    geo.attributes.land.needsUpdate=true;
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
  /** The shader's view of the theme and the airfield; call when either changes. */
  sync(){
    const u=groundUniforms;
    u.waterLevel.value=TH.water; u.amp.value=TH.amp; u.woodTh.value=TH.wood;
    if(af.active) u.afRect.value.set(af.x,af.z,af.wid*0.5+55,af.len*0.5+140);
    else u.afRect.value.set(0,0,0,0);
  },
  update(){
    this.refresh(false);
    FieldMap.refresh(false);
    Water.follow(P.x,P.z,TH.water,performance.now());
  },
  // re-cut only the tiles around a point: moving the airfield re-grades the
  // ground under it, and a full refill would show as a hitch
  regrade(zc,rad){
    this.sync();
    for(const t of this.tiles){
      if(!t.key) continue;
      const p=t.key.split("|");
      const iz=+p[1];
      if(Math.abs(iz*TILE-zc)>rad+TILE) continue;
      this.fill(t,+p[0],iz);
    }
  },
  reset(){ this.sync(); FieldMap.refresh(true); this.refresh(true); this.update(); }
};
Terrain.build();

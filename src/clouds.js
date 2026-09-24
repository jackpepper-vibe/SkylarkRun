// Skylark Run — the cloud field.
//
// Billboards rather than a volumetric pass: it costs almost nothing and reads
// as weather from a cockpit, provided the billboards are lit. Each one samples
// an atlas of eight cumulus shapes whose texels carry a surface normal as well
// as coverage — every shape is a union of spheres, so the normal is exact — and
// the shader lights that normal from the real sun: bright crowns, grey flat
// bases, and a silver edge when you look toward the sun through them. Clouds
// are grouped into clusters of overlapping puffs, which gives them depth as
// you fly past, and are sorted back to front every frame.
//
// Two layers: cumulus above the cloud base, and a thin scud at flying height
// that you can pass through; every puff fades as the camera nears it, so
// flying into one never shows its edge.
//
// How solid the sky is comes from the weather on Game, which is why this module
// needs nothing from weather.js.
import * as THREE from 'three';
import { Game, P } from './state.js';
import { mulberry32, tileableNoise } from './util.js';
import { scene } from './view.js';
import { Atmosphere } from './atmosphere.js';
import { MAX_Y, VIEW } from './plane/config.js';

// ---------- the atlas: 4 x 2 cumulus shapes, normal + height + coverage ----------
const TILE=256, COLS=4, ROWS=2;
function makeAtlas(){
  const W=TILE*COLS, H=TILE*ROWS;
  const img=new Uint8Array(W*H*4);
  for(let t=0;t<COLS*ROWS;t++){
    const rng=mulberry32(1013+t*7919);
    const ox=(t%COLS)*TILE, oy=Math.floor(t/COLS)*TILE;
    // blobs: a broad body sitting on a flat base, towers rising out of it,
    // and a few smaller heads bulging from the upper surfaces; y runs up
    // from the tile's foot, in texels
    const base=TILE*0.16, blobs=[];
    const wide=0.50+rng()*0.30, tall=0.55+rng()*0.45;
    const nb=5+((rng()*3)|0);
    for(let i=0;i<nb;i++){
      const u=(i/(nb-1)-0.5)*wide;
      const r=TILE*(0.13+rng()*0.07)*(1-Math.abs(u)*0.9);
      blobs.push([TILE*(0.5+u*0.95), base+r*0.55, r]);
    }
    const nt=2+((rng()*3)|0);
    for(let i=0;i<nt;i++){
      const u=(rng()-0.5)*wide*0.6;
      const r=TILE*(0.11+rng()*0.08);
      blobs.push([TILE*(0.5+u), base+TILE*(0.16+rng()*0.26*tall), r]);
    }
    const parents=blobs.length;
    for(let i=0;i<12;i++){
      const b=blobs[(rng()*parents)|0], a=0.25+rng()*(Math.PI-0.5);
      const r=b[2]*(0.38+rng()*0.20);
      blobs.push([b[0]+Math.cos(a)*b[2]*0.78, b[1]+Math.sin(a)*b[2]*0.78, r]);
    }
    // a little value noise to fray the edges
    const fray=tileableNoise(16,t*31+7);
    for(let py=0;py<TILE;py++){
      const y=TILE-1-py;                                  // texel row -> height above the tile foot
      for(let px=0;px<TILE;px++){
        // the union of spheres: the tallest surface over this texel wins
        let best=0, nx=0, ny=0, rmax=1;
        for(const [cx,cy,r] of blobs){
          const dx=px-cx, dy=y-cy, q=r*r-dx*dx-dy*dy;
          if(q<=0) continue;
          const z=Math.sqrt(q);
          if(z>best){ best=z; nx=dx/r; ny=dy/r; rmax=r; }
        }
        const o=((oy+py)*W+ox+px)*4;
        if(best<=0){ img[o]=128; img[o+1]=128; img[o+2]=0; img[o+3]=0; continue; }
        const nz=best/rmax;
        // soft, frayed edge, and the flat base cut clean where the air condenses
        const f=fray(px/TILE*16,y/TILE*16);
        let a=Math.min(1,Math.max(0,nz*2.1+(f-0.5)*0.55));
        a*=Math.min(1,Math.max(0,(y-base+TILE*0.02)/(TILE*0.11)));
        img[o]  =Math.round((nx*0.5+0.5)*255);
        img[o+1]=Math.round((ny*0.5+0.5)*255);
        img[o+2]=Math.round(Math.min(1,(y-base)/(TILE*0.60))*255);
        img[o+3]=Math.round(a*255);
      }
    }
  }
  const tex=new THREE.DataTexture(img,W,H,THREE.RGBAFormat,THREE.UnsignedByteType);
  tex.flipY=false;
  tex.magFilter=THREE.LinearFilter; tex.minFilter=THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps=true;
  tex.needsUpdate=true;
  return tex;
}

// ---------- the material ----------
const uniforms=Object.assign({
  atlas:{value:makeAtlas()},
  sunCol:{value:new THREE.Color(1,0.96,0.9)},
  skyTop:{value:new THREE.Color(0.55,0.68,0.85)},
  skyLow:{value:new THREE.Color(0.62,0.66,0.70)},
  gloom:{value:0},
}, Atmosphere.uniforms);

const material=new THREE.ShaderMaterial({
  uniforms,
  vertexShader:`
    attribute vec3 offset;
    attribute vec4 params;            // width, height, tile, opacity
    varying vec2 vUv;
    varying vec3 vWorld, vRight, vUp, vToCam;
    varying float vTile, vOpacity, vDist;
    void main(){
      vec3 toCam=normalize(cameraPosition-offset);
      // turn to face the camera about the vertical, then tip toward it — never
      // roll with the aircraft, so a cloud's base stays level in a bank
      vec3 right=normalize(cross(vec3(0.0,1.0,0.0),toCam));
      vec3 up=normalize(cross(toCam,right));
      vec3 world=offset+right*position.x*params.x+up*(position.y+0.5)*params.y;
      vUv=uv; vTile=params.z; vOpacity=params.w;
      vWorld=world; vRight=right; vUp=up; vToCam=toCam;
      vDist=length(cameraPosition-offset);
      gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
    }`,
  fragmentShader:`
    uniform sampler2D atlas;
    uniform vec3 sunCol, skyTop, skyLow;
    uniform float gloom;
    varying vec2 vUv;
    varying vec3 vWorld, vRight, vUp, vToCam;
    varying float vTile, vOpacity, vDist;
    ${Atmosphere.glsl}
    void main(){
      vec2 cell=vec2(mod(vTile,${COLS}.0),floor(vTile/${COLS}.0));
      vec4 s=texture2D(atlas,(cell+vec2(vUv.x,1.0-vUv.y)*0.98+0.01)/vec2(${COLS}.0,${ROWS}.0));
      float a=s.a*vOpacity*smoothstep(35.0,190.0,vDist);
      if(a<0.004) discard;
      vec2 nxy=s.rg*2.0-1.0;
      float nz=sqrt(max(0.0,1.0-dot(nxy,nxy)));
      vec3 n=normalize(vRight*nxy.x+vUp*nxy.y+vToCam*nz);
      float h=s.b;
      // wrapped sun, sky from above, bounce from below, and the grey base
      float sun=clamp((dot(n,hazeSunDir)+0.35)/1.35,0.0,1.0)*(1.0-gloom*0.65);
      vec3 amb=mix(skyLow,skyTop,n.y*0.5+0.5);
      vec3 col=sunCol*sun*0.95+amb*(0.55+0.25*h);
      col*=mix(0.70,1.0,smoothstep(0.0,0.35,h));
      // silver lining: thin edges lit from behind when looking toward the sun
      float back=pow(max(dot(-vToCam,hazeSunDir),0.0),5.0);
      col+=sunCol*back*pow(1.0-s.a,2.0)*2.2*(1.0-gloom);
      col=mix(col,col*vec3(0.78,0.80,0.84),gloom);
      col=hazeApply(col,vWorld);
      gl_FragColor=vec4(col,a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent:true, depthWrite:false, depthTest:true, fog:false,
});

// ---------- the field ----------
const HIGH_CLUSTERS=20, PUFFS=4, SCUD=14;
const MAX=HIGH_CLUSTERS*PUFFS+SCUD;
function weatherCloudAlpha(){ return Game.weather===2?1.0:(Game.weather===3?0.85:0.72); }

const geo=new THREE.InstancedBufferGeometry();
{
  const q=new THREE.PlaneGeometry(1,1);
  geo.index=q.index;
  geo.setAttribute("position",q.attributes.position);
  geo.setAttribute("uv",q.attributes.uv);
}
const aOffset=new THREE.InstancedBufferAttribute(new Float32Array(MAX*3),3);
const aParams=new THREE.InstancedBufferAttribute(new Float32Array(MAX*4),4);
aOffset.setUsage(THREE.DynamicDrawUsage); aParams.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute("offset",aOffset);
geo.setAttribute("params",aParams);
geo.instanceCount=MAX;
const mesh=new THREE.Mesh(geo,material);
mesh.frustumCulled=false;
mesh.renderOrder=-1;
scene.add(mesh);

const Clouds={
  puffs:[],                        // {x,y,z,w,h,tile,op,cluster}
  clusters:[],                     // {z, puffs:[...], scud}
  order:new Array(MAX),
  dist:new Float32Array(MAX),
  build(){
    for(let c=0;c<HIGH_CLUSTERS;c++){
      const cl={z:0,scud:false,puffs:[]};
      for(let i=0;i<PUFFS;i++){ const p={x:0,y:0,z:0,w:1,h:1,tile:0,op:1}; cl.puffs.push(p); this.puffs.push(p); }
      this.clusters.push(cl);
    }
    for(let s=0;s<SCUD;s++){
      const p={x:0,y:0,z:0,w:1,h:1,tile:0,op:1};
      this.clusters.push({z:0,scud:true,puffs:[p]}); this.puffs.push(p);
    }
    for(let i=0;i<MAX;i++) this.order[i]=i;
  },
  place(cl,ahead){
    const z=P.z-(ahead?VIEW*(0.55+Math.random()*0.75):Math.random()*VIEW*1.3);
    cl.z=z;
    const k=weatherCloudAlpha();
    if(cl.scud){
      const p=cl.puffs[0];
      p.x=P.x+(Math.random()-0.5)*1400; p.z=z;
      p.y=150+Math.random()*(MAX_Y-170);
      p.w=90+Math.random()*120; p.h=p.w*0.7;
      p.tile=(Math.random()*8)|0; p.op=(0.35+Math.random()*0.30)*k;
      return;
    }
    const cx=P.x+(Math.random()-0.5)*3600, cy=MAX_Y+70+Math.random()*260;
    const size=260+Math.random()*360;
    cl.puffs.forEach((p,i)=>{
      const u=(i/(PUFFS-1)-0.5);
      p.x=cx+u*size*0.62+(Math.random()-0.5)*size*0.2;
      p.z=z+(Math.random()-0.5)*size*0.6;
      p.y=cy+(Math.random()-0.5)*size*0.035;          // one condensation level
      p.w=size*(0.65+Math.random()*0.45)*(1-Math.abs(u)*0.35);
      p.h=p.w*(0.85+Math.random()*0.2);
      p.tile=(Math.random()*8)|0;
      p.op=(0.80+Math.random()*0.2)*k;
    });
  },
  reset(){ for(const cl of this.clusters) this.place(cl,false); },
  /** Showers bring the whole sky down to grey. */
  setWeather(){
    uniforms.gloom.value=Game.weather===2?0.75:(Game.weather===3?0.2:0);
    for(const cl of this.clusters) this.place(cl,false);
  },
  /** Light the field for a time of day. Colours are linear. */
  setLight(sun,top,low){
    uniforms.sunCol.value.copy(sun); uniforms.skyTop.value.copy(top); uniforms.skyLow.value.copy(low);
  },
  farFirst:(a,b)=>Clouds.dist[b]-Clouds.dist[a],
  update(){
    for(const cl of this.clusters) if(cl.z>P.z+500) this.place(cl,true);
    // back to front, so overlapping puffs blend in the right order
    const ps=this.puffs, dist=this.dist;
    for(let i=0;i<MAX;i++){
      const p=ps[i], dx=p.x-P.x, dy=p.y-P.y, dz=p.z-P.z;
      dist[i]=dx*dx+dy*dy+dz*dz;
    }
    this.order.sort(this.farFirst);
    const o=aOffset.array, q=aParams.array;
    for(let k=0;k<MAX;k++){
      const p=ps[this.order[k]];
      o[k*3]=p.x; o[k*3+1]=p.y; o[k*3+2]=p.z;
      q[k*4]=p.w; q[k*4+1]=p.h; q[k*4+2]=p.tile; q[k*4+3]=p.op;
    }
    aOffset.needsUpdate=true; aParams.needsUpdate=true;
  }
};
Clouds.build();

export { Clouds, weatherCloudAlpha };

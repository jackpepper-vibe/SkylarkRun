// Skylark Run — the cloud field.
//
// Billboards recycled ahead of the aircraft rather than a volumetric pass: it
// costs almost nothing and reads as weather from a cockpit. How solid they
// look comes from the weather on Game, which is why this module needs nothing
// from weather.js.
/* global THREE */
import { Game, P } from './state.js';
import { hash } from './util.js';
import { scene } from './view.js';
import { MAX_Y, VIEW } from './plane/config.js';

// ---------- volumetric-ish cloud field (billboards, recycled ahead) ----------
// How opaque the cloud billboards are drawn: overcast and rain thicken them.
function weatherCloudAlpha(){ return Game.weather===2?1.0:(Game.weather===3?0.8:0.62); }
const cloudTex=(()=>{
  const c=document.createElement("canvas"); c.width=256; c.height=160;
  const x=c.getContext("2d");
  for(let p=0;p<10;p++){
    const px=40+hash(p*3.1)*176, py=95-hash(p*7.7)*46;
    const r=26+hash(p*11.3)*40;
    const g=x.createRadialGradient(px,py-r*0.3,r*0.1,px,py,r);
    g.addColorStop(0,"rgba(255,255,255,1)");
    g.addColorStop(0.5,"rgba(250,252,255,0.82)");
    g.addColorStop(1,"rgba(210,224,240,0)");
    x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  // shaded underside
  const sg=x.createLinearGradient(0,60,0,160);
  sg.addColorStop(0,"rgba(255,255,255,0)");
  sg.addColorStop(1,"rgba(150,170,195,0.40)");
  x.globalCompositeOperation="source-atop";
  x.fillStyle=sg; x.fillRect(0,0,256,160);
  x.globalCompositeOperation="source-over";
  const t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; return t;
})();
const Clouds={
  N:56, list:[],
  build(){
    for(let i=0;i<this.N;i++){
      const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:cloudTex,transparent:true,
        opacity:0.9,depthWrite:false,fog:true}));
      sp.renderOrder=-1;
      scene.add(sp);
      this.list.push({sp,z:0});
    }
  },
  place(c,ahead){
    const spread=1500;
    c.z=P.z-(ahead?VIEW*(0.5+Math.random()*0.75):Math.random()*VIEW*1.2);
    const s=200+Math.random()*420;
    c.sp.position.set((Math.random()-0.5)*spread*2, MAX_Y+40+Math.random()*260, c.z);
    c.sp.scale.set(s,s*0.62,1);
    c.sp.material.opacity=(0.55+Math.random()*0.4)*weatherCloudAlpha();
  },
  reset(){ for(const c of this.list) this.place(c,false); },
  update(){
    for(const c of this.list) if(c.z>P.z+400) this.place(c,true);
  }
};
Clouds.build();

export { Clouds, weatherCloudAlpha };

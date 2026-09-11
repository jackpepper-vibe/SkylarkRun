// Skylark — lights, the sky dome and the time of day.
//
// The plane's sky, loaded only with the plane. It adds daylight to the shared
// scene, so the city must never pull it in.
//
// Every sector shifts the sun, so the whole palette — light colour, fog, the
// dome gradient and the glow around the disc — is driven from one table of
// times of day rather than set per scene.
/* global THREE */
import { SUNDIR } from '../sun.js';
import { scene } from '../view.js';
import { hash } from '../util.js';

// ---------- lights ----------
const hemiLight=new THREE.HemisphereLight(0xbcd8ee,0x4a5a34,0.95);
scene.add(hemiLight);
const sunLight=new THREE.DirectionalLight(0xfff2d0,1.35);
sunLight.position.set(700,900,-900);
scene.add(sunLight);
const fillLight=new THREE.DirectionalLight(0x88a8d8,0.30);
fillLight.position.set(-600,300,700);
scene.add(fillLight);

// ---------- time of day: every sector shifts the sun ----------
const TODS=[
 {name:"MORNING",  sky:["#3f79c4","#7db2e4","#c3dcf0","#f2e6cc"], fog:0xc6dcf0, sunC:0xfff0cc, sunI:1.30,
  hemiS:0xbcd8ee, hemiG:0x4a5a34, hemiI:0.95, exp:1.02, dir:[0.55,0.42,-0.72], glowO:0.55, ray:0.85, grass:0.98},
 {name:"MIDDAY",   sky:["#2b6fc6","#69a9e2","#b6d6ef","#e6f0f8"], fog:0xd2e6f4, sunC:0xffffff, sunI:1.45,
  hemiS:0xcfe4f4, hemiG:0x5a6a3c, hemiI:1.05, exp:1.00, dir:[0.20,0.86,-0.47], glowO:0.42, ray:0.55, grass:1.06},
 {name:"AFTERNOON",sky:["#3a72b8","#79aada","#c9d6e4","#f0dcbc"], fog:0xd8dcdc, sunC:0xffe9c0, sunI:1.30,
  hemiS:0xc4d4e4, hemiG:0x54603a, hemiI:0.92, exp:1.03, dir:[-0.52,0.50,-0.69], glowO:0.60, ray:0.90, grass:1.00},
 {name:"GOLDEN",   sky:["#2f5f9e","#6f92c4","#dfae82","#ffd8a2"], fog:0xe0c49a, sunC:0xffc884, sunI:1.20,
  hemiS:0xd8bc98, hemiG:0x4a4028, hemiI:0.85, exp:1.06, dir:[-0.72,0.18,-0.67], glowO:0.75, ray:1.10, grass:0.94},
];
// ---------- sky dome ----------
function makeSkyTexture(tod){
  const td=TODS[tod];
  const c=document.createElement("canvas"); c.width=1024; c.height=512;
  const x=c.getContext("2d");
  const g=x.createLinearGradient(0,0,0,512);
  g.addColorStop(0,td.sky[0]); g.addColorStop(0.34,td.sky[1]);
  g.addColorStop(0.62,td.sky[2]); g.addColorStop(1,td.sky[3]);
  x.fillStyle=g; x.fillRect(0,0,1024,512);
  // high cirrus streaks
  x.globalAlpha=0.30;
  x.fillStyle="#ffffff";
  for(let i=0;i<70;i++){
    const cy=hash(i*3.7+tod)*190, cx=hash(i*5.1+tod)*1024;
    const w=60+hash(i*7.3)*230, h=2+hash(i*9.1)*5;
    x.beginPath(); x.ellipse(cx,cy,w,h,0,0,7); x.fill();
  }
  // cumulus band sitting on the horizon
  x.globalAlpha=1;
  for(let i=0;i<46;i++){
    const cx=hash(i*11.3+tod*3)*1024, cy=250+hash(i*13.7+tod)*140;
    const sc=0.5+hash(i*17.1)*1.4;
    for(let p=0;p<7;p++){
      const px=cx+(hash(i*19+p)-0.5)*130*sc, py=cy+(hash(i*23+p)-0.5)*26*sc;
      const r=(14+hash(i*29+p)*26)*sc;
      const grd=x.createRadialGradient(px,py-r*0.25,r*0.15,px,py,r);
      grd.addColorStop(0,"rgba(255,255,255,0.95)");
      grd.addColorStop(0.55,"rgba(246,248,252,0.7)");
      grd.addColorStop(1,"rgba(214,226,240,0)");
      x.fillStyle=grd; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    }
  }
  const t=new THREE.CanvasTexture(c);
  t.encoding=THREE.sRGBEncoding;
  return t;
}
const skyTexs=[0,1,2,3].map(makeSkyTexture);
const sky=new THREE.Mesh(
  new THREE.SphereGeometry(5200,32,20),
  new THREE.MeshBasicMaterial({map:skyTexs[0],side:THREE.BackSide,fog:false,depthWrite:false})
);
sky.rotation.y=Math.PI*0.15;
sky.renderOrder=-2;
scene.add(sky);

// ---------- sun disc + haze ----------
const sunGlow=(()=>{
  const c=document.createElement("canvas"); c.width=128; c.height=128;
  const x=c.getContext("2d");
  const g=x.createRadialGradient(64,64,2,64,64,64);
  g.addColorStop(0,"rgba(255,255,244,1)");
  g.addColorStop(0.12,"rgba(255,246,214,0.85)");
  g.addColorStop(0.42,"rgba(255,226,164,0.28)");
  g.addColorStop(1,"rgba(255,220,160,0)");
  x.fillStyle=g; x.fillRect(0,0,128,128);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),
    blending:THREE.AdditiveBlending,depthWrite:false,fog:false,opacity:0.55}));
  sp.scale.set(1500,1500,1);
  scene.add(sp); return sp;
})();

export { TODS, hemiLight, sky, skyTexs, sunGlow, sunLight };

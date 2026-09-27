// Skylark Run — the airfields: every field a sector can start or end at.
//
// A layout is the whole character of a field: how long and wide the strip is,
// what it is made of (mown grass, gravel, wartime concrete, asphalt), which
// side the buildings stand on, whether it is lit, and what is parked on it.
// world.js's Airfield assembles a layout into one group — the painted strip,
// the lights and landing aids, the windsock — and calls the layout's `dress`
// to put up its buildings.
//
// Everything here is built once per layout, in metres, as merged geometry with
// its colours baked into vertex colours (the same scheme as models.js), so a
// whole field is a handful of draw calls. The runway is drawn in metres too:
// the canvas is scaled so that a piano key is 1.8 m wide on any strip, however
// long or narrow.
import * as THREE from 'three';
import { mulberry32 } from '../util.js';
import { renderer } from '../view.js';
import { Models, makeHangar, makeTower, makeParkedPlane,
         box, gableRoof, gables, merge, paint, prep } from './models.js';

// ---------- small geometry helpers ----------
const _up=new THREE.Vector3(0,1,0), _d=new THREE.Vector3(), _q=new THREE.Quaternion();
/** A cylinder standing on the origin (y from 0 to h), painted. */
function cyl(r0,r1,h,seg,hex,shade){
  const g=prep(new THREE.CylinderGeometry(r1,r0,h,seg));
  g.translate(0,h/2,0);
  return paint(g,hex,shade);
}
/** A round rod between two points. */
function rod(a,b,r,hex){
  _d.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  const len=_d.length();
  const g=prep(new THREE.CylinderGeometry(r,r,len,6));
  paint(g,hex);
  g.applyQuaternion(_q.setFromUnitVectors(_up,_d.normalize()));
  g.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
  return g;
}
/** A wheel on an axle along x, centred at (x, r, z). */
function wheel(r,w,x,z,hex){
  const g=prep(new THREE.CylinderGeometry(r,r,w,12));
  g.rotateZ(Math.PI/2); g.translate(x,r,z);
  return paint(g,hex||"#222020");
}
/**
 * A barrel roof: a half-cylinder of radius r along x, length l, springing at
 * y0; `rise` flattens it into a segmental arch. The sheets are shaded
 * alternately round the arch, which is what reads as corrugation from the air.
 */
function barrelRoof(r,l,y0,hex,rise){
  const SEG=24, pos=[], col=[], c=new THREE.Color(hex);
  const k=(rise||r)/r;
  for(let i=0;i<SEG;i++){
    const a0=i/SEG*Math.PI, a1=(i+1)/SEG*Math.PI;
    const z0=Math.cos(a0)*r, y0a=y0+Math.sin(a0)*r*k, z1=Math.cos(a1)*r, y1a=y0+Math.sin(a1)*r*k;
    // ridge along x: the section is in the y-z plane
    pos.push(-l/2,y0a,z0, l/2,y0a,z0, l/2,y1a,z1,  -l/2,y0a,z0, l/2,y1a,z1, -l/2,y1a,z1);
    const s=i%2?0.86:1.0;
    for(let j=0;j<6;j++) col.push(c.r*s,c.g*s,c.b*s);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
  g.computeVertexNormals();
  return g;
}
/** A filled semicircular (or segmental) end wall in the y-z plane at x. */
function archEnd(r,x,y0,hex,rise,facing){
  const SEG=16, pos=[], k=(rise||r)/r;
  for(let i=0;i<SEG;i++){
    const a0=i/SEG*Math.PI, a1=(i+1)/SEG*Math.PI;
    const p0=[Math.cos(a0)*r,y0+Math.sin(a0)*r*k], p1=[Math.cos(a1)*r,y0+Math.sin(a1)*r*k];
    if(facing>0) pos.push(x,y0,0, x,p1[1],p1[0], x,p0[1],p0[0]);
    else         pos.push(x,y0,0, x,p0[1],p0[0], x,p1[1],p1[0]);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.computeVertexNormals();
  g.setAttribute("color",new THREE.BufferAttribute(new Float32Array(pos.length),3));
  return paint(g,hex);
}

// ---------- aircraft on the ground ----------
/** A high-wing cabin monoplane on a tricycle undercarriage. */
function highWing(body,trim){
  const p=[
    box(1.10,1.25,4.4,0,0.75,-0.4,body),                      // cabin and forward fuselage
    box(0.62,0.80,3.4,0,1.05,3.4,body),                       // tail cone
    box(1.00,0.95,1.0,0,0.80,-3.0,trim),                      // cowling
    box(1.14,0.55,1.7,0,1.35,-0.9,"#2a3440"),                 // side windows
    box(0.96,0.50,0.12,0,1.50,-1.82,"#2a3440"),               // windscreen
    box(10.6,0.16,1.55,0,2.02,-0.8,body),                     // the wing on the cabin roof
    box(1.2,0.18,1.55,4.6,2.03,-0.8,trim), box(1.2,0.18,1.55,-4.6,2.03,-0.8,trim),
    box(3.6,0.10,1.0,0,1.45,4.7,body),                        // tailplane
    box(0.10,1.35,1.2,0,1.45,4.7,trim),                       // fin
    box(0.10,1.9,0.14,0,0.35,-3.56,"#3a3632"),                // propeller, stopped
    wheel(0.30,0.16,1.15,-0.5), wheel(0.30,0.16,-1.15,-0.5), wheel(0.24,0.12,0,-2.7),
  ];
  for(const s of [-1,1]){
    p.push(rod([s*0.55,0.95,-0.5],[s*2.5,2.0,-0.8],0.05,"#d8d8d4"));
    p.push(rod([s*0.5,0.8,-0.5],[s*1.15,0.3,-0.5],0.05,"#8a8a88"));   // main gear leg
  }
  return merge(p);
}
/** A low-wing two-seater with a bubble canopy. */
function lowWing(body,trim){
  const p=[
    box(1.0,1.0,4.2,0,0.55,-0.3,body),
    box(0.56,0.65,3.2,0,0.80,3.4,body),
    box(0.92,0.85,1.0,0,0.55,-2.8,trim),
    box(0.95,0.55,1.6,0,1.50,-0.6,"#26303a"),                 // canopy
    box(9.4,0.18,1.55,0,0.62,-0.5,body),
    box(1.0,0.2,1.55,4.2,0.63,-0.5,trim), box(1.0,0.2,1.55,-4.2,0.63,-0.5,trim),
    box(3.2,0.10,0.9,0,1.10,4.6,body),
    box(0.10,1.2,1.1,0,1.10,4.6,trim),
    box(0.10,1.8,0.14,0,0.1,-3.35,"#3a3632"),
    wheel(0.28,0.14,1.4,-0.4), wheel(0.28,0.14,-1.4,-0.4), wheel(0.22,0.1,0,-2.5),
  ];
  return merge(p);
}
/** A sailplane at rest on its mainwheel, one wingtip down on the grass. */
function glider(body,trim){
  const p=[];
  // the fuselage: a slim pod tapering into a boom
  const pod=prep(new THREE.CylinderGeometry(0.12,0.38,7.2,10));
  pod.rotateX(Math.PI/2); pod.translate(0,0.75,0.6);           // thin end aft
  p.push(paint(pod,body,(v,n)=>0.8+0.2*Math.max(0,n.y)));
  const nose=prep(new THREE.SphereGeometry(0.38,10,8));
  nose.scale(1,1,1.8); nose.translate(0,0.75,-3.0);
  p.push(paint(nose,body));
  p.push(box(0.5,0.34,1.5,0,0.95,-1.8,"#2a3440"));            // canopy
  p.push(box(15.0,0.10,0.95,0,1.02,-0.9,body));              // the long wing
  p.push(box(0.5,0.10,0.95,7.25,1.02,-0.9,trim), box(0.5,0.10,0.95,-7.25,1.02,-0.9,trim));
  p.push(box(0.08,1.25,0.9,0,0.8,3.9,body));                  // fin
  p.push(box(2.6,0.06,0.55,0,2.05,3.9,trim));                 // T-tail
  p.push(wheel(0.18,0.1,0,-0.6));
  const g=merge(p);
  g.rotateZ(-0.125); g.translate(0,0.08,0);                    // resting on the right tip
  return g;
}
/** A twin-turboprop regional airliner in a white and blue livery. */
function airliner(){
  const W="#eef0f2", B="#244a8a", p=[];
  const fus=prep(new THREE.CylinderGeometry(1.35,1.35,20,16));
  fus.rotateX(Math.PI/2); fus.translate(0,2.4,0);
  p.push(paint(fus,W,(v,n)=>n.y<-0.55?0.78:(n.y<-0.2?0.9:1.0)));
  const nose=prep(new THREE.SphereGeometry(1.35,16,10,0,Math.PI*2,0,Math.PI/2));
  nose.rotateX(-Math.PI/2); nose.scale(1,1,1.9); nose.translate(0,2.4,-10);
  p.push(paint(nose,W));
  const tail=prep(new THREE.CylinderGeometry(0.35,1.35,6,16));    // narrowing aft
  tail.rotateX(Math.PI/2); tail.translate(0,2.75,13); p.push(paint(tail,W));
  p.push(box(2.74,0.35,20.2,0,1.6,0,B));                      // the belly cheatline
  for(const s of [-1,1]){                                      // cabin windows
    for(let i=0;i<14;i++) p.push(box(0.05,0.34,0.3,s*1.34,2.7,-7+i*1.2,"#1a2230"));
  }
  p.push(box(2.2,0.55,0.8,0,3.1,-11.6,"#1a2230"));            // flight deck glazing
  p.push(box(27.0,0.40,2.5,0,3.8,-0.8,W));                    // the high wing
  for(const s of [-1,1]){
    const nac=prep(new THREE.CylinderGeometry(0.62,0.5,4.4,12));
    nac.rotateX(Math.PI/2); nac.translate(s*4.4,3.35,-1.6);
    p.push(paint(nac,W));
    p.push(box(0.14,3.6,0.18,s*4.4,1.55,-3.9,"#2a2a2a"));     // stopped propeller
    p.push(box(3.6,0.14,0.18,s*4.4,3.35,-3.9,"#2a2a2a"));
    p.push(wheel(0.5,0.3,s*1.6,0.8));
  }
  p.push(box(0.35,5.0,3.4,0,3.8,14.0,B));                     // fin
  p.push(box(8.5,0.22,1.9,0,8.6,14.6,W));                     // T-tail
  p.push(wheel(0.36,0.2,0,-8.6));
  return merge(p);
}

// ---------- buildings ----------
/** A row of T-hangars: a long, low shed with a door for every aeroplane. */
function tHangars(n,cladding,doors){
  const w=n*13, d=14, eave=5.2;
  const p=[box(w,eave,d,0,0,0,cladding), gables(w,d,eave,1.6,cladding),
           gableRoof(w,d,eave,1.6,"#8a8e8c",0.4)];
  for(let i=0;i<n;i++) p.push(box(11.8,4.6,0.24,-w/2+6.5+i*13,0,d/2+0.08,i%2?doors[0]:doors[1]));
  return merge(p);
}
/** A modern portal-frame hangar: profiled cladding, a shallow roof, sliding doors. */
function boxHangar(w,d,eave,cladding,roof,door){
  const p=[box(w,eave,d,0,0,0,cladding), gables(w,d,eave,1.8,cladding), gableRoof(w,d,eave,1.8,roof,0.3)];
  for(let x=-w/2+0.6;x<w/2;x+=1.2) p.push(box(0.12,eave-0.2,0.1,x,0.1,-d/2-0.05,cladding,()=>0.86));
  const dw=w*0.84;
  for(let i=0;i<4;i++) p.push(box(dw/4-0.2,eave*0.86,0.26,-dw/2+dw/8+i*dw/4,0,d/2+0.1,door,()=>i%2?0.92:1.0));
  p.push(box(dw+0.6,0.5,0.4,0,eave*0.86,d/2+0.16,"#3a3e42"));
  return merge(p);
}
/** A small timber hangar with a corrugated roof. */
function smallHangar(wall,roof){
  const w=18, d=15, eave=4.6;
  return merge([box(w,eave,d,0,0,0,wall), gables(w,d,eave,3.2,wall), gableRoof(w,d,eave,3.2,roof,0.5),
    box(w*0.8,4.0,0.2,0,0,d/2+0.06,"#4a3a2a"), box(0.18,4.0,0.26,0,0,d/2+0.1,"#2a2018")]);
}
/** A Dutch barn: a curved roof on steel stanchions, open-sided, half full of hay. */
function dutchBarn(){
  const w=30, d=12, h=6.5, p=[];
  for(let i=0;i<=5;i++) for(const s of [-1,1]) p.push(box(0.35,h,0.35,-w/2+i*w/5,0,s*d/2,"#7a3a26"));
  p.push(barrelRoof(d/2+0.4,w+0.8,h,"#6e7872",d*0.18));
  p.push(archEnd(d/2+0.4,w/2+0.4,h,"#6e7872",d*0.18,1));
  p.push(archEnd(d/2+0.4,-w/2-0.4,h,"#6e7872",d*0.18,-1));
  const rng=mulberry32(9);
  for(let x=-w/2+2;x<w*0.15;x+=2.4) for(let z=-d/2+1.5;z<d/2-1;z+=2.4){
    const hh=2.4+Math.floor(rng()*3)*1.0;
    p.push(box(2.3,hh,2.3,x,0,z,"#cdb06a",(v,n)=>n.y>0.5?1.0:0.8));
  }
  return merge(p);
}
/** A Nissen hut: corrugated half-drum, brick ends, a door and two windows. */
function nissen(){
  const r=4.6, l=14, p=[];
  p.push(barrelRoof(r,l,0,"#3e4638",r));
  for(const s of [-1,1]){
    p.push(archEnd(r,s*l/2,0,"#8a4a36",r,s));
    p.push(box(0.14,2.2,1.4,s*(l/2+0.05),0,0,"#3a2e24"));
    p.push(box(0.14,1.0,1.0,s*(l/2+0.05),1.4,2.4,"#2a3440"), box(0.14,1.0,1.0,s*(l/2+0.05),1.4,-2.4,"#2a3440"));
  }
  return merge(p);
}
/** A timber clubhouse with a veranda along the airfield side. */
function clubhouse(wall,roof){
  const w=20, d=9, eave=3.4, p=[];
  p.push(box(w,eave,d,0,0,0,wall), gables(w,d,eave,2.4,wall), gableRoof(w,d,eave,2.4,roof,0.5));
  for(let i=0;i<6;i++) p.push(box(2.0,1.4,0.12,-w/2+2.2+i*3.1,1.1,d/2+0.04,"#2a3440"));
  p.push(box(w,0.3,3.2,0,0,d/2+1.6,"#8a6a48"));              // the deck
  for(let i=0;i<=5;i++) p.push(box(0.18,2.9,0.18,-w/2+0.2+i*(w-0.4)/5,0.3,d/2+3.05,"#e8e2d4"));
  p.push(box(w+0.4,0.18,3.6,0,3.2,d/2+1.7,roof));           // veranda roof
  p.push(box(w,0.8,0.08,0,0.3,d/2+3.15,"#e8e2d4"));         // rail
  return merge(p);
}
/** A site cabin. */
function portakabin(hex){
  const p=[box(10,2.8,3.2,0,0.25,0,hex), box(10.2,0.2,3.4,0,3.05,0,"#8a8e90")];
  for(let i=0;i<4;i++) p.push(box(1.3,0.9,0.1,-3.6+i*2.4,1.3,1.62,"#2a3440"));
  p.push(box(0.95,2.0,0.1,4.2,0.25,1.62,"#6a6e70"));
  for(const x of [-4.2,0,4.2]) p.push(box(0.4,0.25,3.0,x,0,0,"#5a5a58"));
  return merge(p);
}
/** The launch-point caravan, in black and white chequers so the tug pilot can see it. */
function launchCaravan(){
  const p=[];
  for(let i=0;i<5;i++) for(let j=0;j<2;j++)
    p.push(box(1.0,1.1,2.2,-2+i,0.4+j*1.1,0,(i+j)%2?"#f2f2ee":"#1c1c1c"));
  p.push(box(5.1,0.14,2.3,0,2.6,0,"#e8e8e4"), box(0.8,0.8,0.1,2.4,1.6,1.12,"#2a3440"));
  p.push(wheel(0.32,0.2,1.1,0), wheel(0.32,0.2,-1.1,0));
  return merge(p);
}
/** A glass-fronted terminal: the glazing is returned separately, so it can light up. */
function terminal(){
  const w=96, d=22, h=9, p=[];
  p.push(box(w,h,d,0,0,0,"#d8d6d0"), box(w+1,1.0,d+1,0,h,0,"#b8b6b0"));
  p.push(box(w-8,1.2,6,0,h-1.2,d/2+3,"#c8c6c0"));          // entrance canopy
  for(let i=0;i<=8;i++) p.push(box(0.4,h-1.4,0.4,-w/2+4+i*(w-8)/8,0,d/2+5.6,"#9a9894"));
  const glass=merge([box(w-6,h-2.2,0.3,0,0.8,d/2+0.1,"#ffffff"),
                     box(w-6,2.0,0.3,0,0.8,-d/2-0.1,"#ffffff")]);
  return {body:merge(p),glass};
}
/** A modern control tower: a shaft, a glazed cab, a roof and an aerial. */
function controlTower(){
  const p=[cyl(2.4,2.1,24,12,"#e2e0da"), cyl(4.2,4.2,1.0,8,"#b8b6b0").translate(0,24,0),
           cyl(4.6,4.8,0.8,8,"#b8b6b0").translate(0,28.6,0), cyl(0.12,0.12,6,6,"#8a8a88").translate(0,29.4,0),
           box(8,5,8,0,0,5,"#d8d6d0")];
  const glass=cyl(4.1,4.4,3.6,8,"#ffffff").translate(0,25,0);
  return {body:merge(p),glass};
}
/** A fuel bowser: a tank on a truck. */
function fuelTruck(cab){
  const tank=prep(new THREE.CylinderGeometry(1.1,1.1,6.4,12));
  tank.rotateX(Math.PI/2); tank.translate(0,2.0,1.4);
  return merge([paint(tank,"#e8e6e0"), box(2.3,2.4,2.2,0,0.6,-3.2,cab), box(2.1,0.8,0.1,0,1.8,-4.32,"#2a3440"),
    box(2.4,0.6,8.4,0,0.5,0,"#3a3a3a"), box(2.26,0.3,6.4,0,2.0,1.4,"#c83a2a"),
    wheel(0.5,0.4,1.1,-3.0), wheel(0.5,0.4,-1.1,-3.0), wheel(0.5,0.4,1.1,2.8), wheel(0.5,0.4,-1.1,2.8)]);
}
/** Two pumps under a canopy. */
function fuelPumps(){
  return merge([box(7,0.4,5,0,4.2,0,"#e8e4d8"), box(7.1,0.5,5.1,0,3.8,0,"#2a8a4a"),
    box(0.4,3.8,0.4,-3,0,0,"#b8b6b0"), box(0.4,3.8,0.4,3,0,0,"#b8b6b0"),
    box(0.8,1.6,0.6,-1.2,0,0,"#2a8a4a"), box(0.8,1.6,0.6,1.2,0,0,"#2a8a4a"), box(6,0.2,3,0,0,0,"#9a9892")]);
}
function car(hex){
  return merge([box(1.8,0.8,4.2,0,0.3,0,hex), box(1.6,0.6,2.2,0,1.1,0.2,"#2a3440"),
    wheel(0.32,0.2,0.85,-1.3), wheel(0.32,0.2,-0.85,-1.3), wheel(0.32,0.2,0.85,1.3), wheel(0.32,0.2,-0.85,1.3)]);
}
function landRover(){
  return merge([box(1.8,1.2,4.0,0,0.45,0,"#4a5a3a"), box(1.76,0.9,2.4,0,1.6,0.6,"#e8e4d8"),
    box(1.6,0.6,0.1,0,1.75,-0.62,"#2a3440"),
    wheel(0.4,0.26,0.86,-1.3), wheel(0.4,0.26,-0.86,-1.3), wheel(0.4,0.26,0.86,1.3), wheel(0.4,0.26,-0.86,1.3)]);
}
function tractor(){
  return merge([box(1.2,1.1,3.0,0,0.8,-0.4,"#c8342a"), box(1.5,1.9,1.4,0,1.2,0.8,"#c8342a"),
    box(1.3,1.1,1.3,0,2.0,0.8,"#2a3440"), box(1.6,0.12,1.6,0,3.15,0.8,"#1c1c1c"),
    wheel(0.85,0.5,0.95,0.9), wheel(0.85,0.5,-0.95,0.9), wheel(0.5,0.3,0.8,-1.6), wheel(0.5,0.3,-0.8,-1.6)]);
}
/** A winch truck at the upwind end of a gliding field. */
function winch(){
  const drum=prep(new THREE.CylinderGeometry(0.6,0.6,2.0,12));
  drum.rotateZ(Math.PI/2); drum.translate(0,2.2,1.2);
  return merge([box(2.4,1.0,7.5,0,0.6,0,"#2e5a8a"), box(2.3,2.2,2.0,0,1.2,-2.6,"#2e5a8a"),
    paint(drum,"#8a8a88"), box(2.2,1.4,1.2,0,1.6,2.8,"#f2c14e"),
    wheel(0.5,0.4,1.1,-2.4), wheel(0.5,0.4,-1.1,-2.4), wheel(0.5,0.4,1.1,2.4), wheel(0.5,0.4,-1.1,2.4)]);
}
/** Round bales, two rows stacked in a pyramid. */
function baleStack(n){
  const p=[];
  for(let i=0;i<n;i++){
    const b=prep(new THREE.CylinderGeometry(0.75,0.75,1.2,14));
    b.rotateX(Math.PI/2);
    b.translate(i*1.55,0.75,0);
    p.push(paint(b,"#c8a860",(v,n)=>Math.abs(n.z)>0.8?0.8:1.0));
  }
  for(let i=0;i<n-1;i++){
    const b=prep(new THREE.CylinderGeometry(0.75,0.75,1.2,14));
    b.rotateX(Math.PI/2);
    b.translate(0.78+i*1.55,2.05,0);
    p.push(paint(b,"#d0b068",(v,n)=>Math.abs(n.z)>0.8?0.8:1.0));
  }
  return merge(p);
}
function drums(n){
  const p=[], rng=mulberry32(5);
  for(let i=0;i<n;i++) p.push(cyl(0.3,0.3,0.9,10,i%3?"#2a6a3a":"#b83a2a").translate((i%4)*0.7+rng()*0.1,0,Math.floor(i/4)*0.7));
  return merge(p);
}
/** A white marker board on its edge, for a grass strip's edges and threshold. */
const markerBoard=()=>merge([box(3.0,0.55,0.16,0,0.05,0,"#f4f2ea")]);
// ---------- landmarks: one tall thing per field, to know it by ----------
/** A pair of galvanised grain silos with their conical caps and a gantry. */
function grainSilos(){
  const p=[];
  for(const x of [-3.6,3.6]){
    p.push(cyl(3.2,3.2,15,16,"#c4c8ca",(v,n)=>0.86+0.14*Math.max(0,n.x)).translate(x,0,0));
    const cap=prep(new THREE.ConeGeometry(3.3,2.4,16)); cap.translate(x,16.2,0); p.push(paint(cap,"#aeb2b4"));
  }
  p.push(box(9.6,0.5,1.2,0,17.4,0,"#7a7e80"), box(0.4,17.4,0.4,0,0,3.4,"#7a7e80"));
  return merge(p);
}
/** A wartime water tower: a square tank on a braced steel frame. */
function waterTower(){
  const p=[box(6,4.5,6,0,14,0,"#5c6258"), box(6.4,0.4,6.4,0,18.5,0,"#4a4e48")];
  for(const x of [-2.6,2.6]) for(const z of [-2.6,2.6]) p.push(box(0.5,14,0.5,x,0,z,"#3e423c"));
  for(const y of [4.5,9.5]){ p.push(box(5.7,0.3,0.3,0,y,2.6,"#3e423c"), box(5.7,0.3,0.3,0,y,-2.6,"#3e423c"),
                                    box(0.3,0.3,5.7,2.6,y,0,"#3e423c"), box(0.3,0.3,5.7,-2.6,y,0,"#3e423c")); }
  return merge(p);
}
/** A ruined tower house on a knoll: rough stone, a broken top, empty windows. */
function ruinedTower(){
  const p=[], rng=mulberry32(12);
  p.push(box(8,11,8,0,0,0,"#8a847a",(v,n)=>0.8+0.2*Math.max(0,n.y)));
  for(let i=0;i<7;i++) p.push(box(1.4+rng()*1.6,1.2+rng()*2.4,1.4,-3.3+i*1.1,11,3.3,"#8a847a"));
  for(let i=0;i<5;i++) p.push(box(1.4,1.0+rng()*3,1.4+rng()*1.4,3.3,11,-3+i*1.4,"#827c72"));
  for(const y of [3,7]) for(const x of [-1.8,1.8]) p.push(box(0.9,1.4,0.2,x,y,4.02,"#2a2622"));
  p.push(box(0.9,1.4,0.2,0,7.5,-4.02,"#2a2622"));
  p.push(box(4,1.6,5,-6,0,1,"#8a847a"), box(2.4,2.4,1.2,-6.5,1.6,3,"#827c72"));   // a fallen range
  return merge(p);
}

/** An orange cone with a white band, for a gravel strip's edges. */
function cone(){
  const c=prep(new THREE.ConeGeometry(0.45,1.1,10));
  c.translate(0,0.55,0);
  return merge([paint(c,"#ef6a1e",v=>v.y>0.45&&v.y<0.7?1.9:1.0), box(0.9,0.06,0.9,0,0,0,"#1c1c1c")]);
}

// ---------- the runway surface ----------
/**
 * Paint a runway, in metres: the canvas is scaled so that 1 unit is 1 m across
 * and 1 m along, whatever the strip's length and width. u runs across the
 * strip, v from the far end (0) to the approach threshold (len).
 */
export function paintRunway(surface,len,wid,rwy){
  const c=document.createElement("canvas"); c.width=512; c.height=2048;
  const x=c.getContext("2d");
  x.scale(512/wid,2048/len);
  const rng=mulberry32(len*7+wid);
  const recip=String(((+rwy+18-1)%36)+1).padStart(2,"0");
  const numbers=(col,alpha)=>{
    x.save(); x.globalAlpha=alpha; x.fillStyle=col;
    x.font="800 18px ui-monospace,Menlo,monospace";
    x.textAlign="center"; x.textBaseline="middle";
    // the approach end's designator, readable from the approach; the far
    // end's turned round to read from the other way
    x.save(); x.translate(wid/2,len-62); x.scale(Math.min(1,wid/40),1.6); x.fillText(rwy,0,0); x.restore();
    x.save(); x.translate(wid/2,62); x.rotate(Math.PI); x.scale(Math.min(1,wid/40),1.6); x.fillText(recip,0,0); x.restore();
    x.restore();
  };
  const speckle=(n,cols,a)=>{
    for(let i=0;i<n;i++){
      x.fillStyle=cols[(rng()*cols.length)|0]; x.globalAlpha=a*(0.5+rng());
      x.fillRect(rng()*wid,rng()*len,0.25+rng()*0.4,0.6+rng()*1.2);
    }
    x.globalAlpha=1;
  };
  if(surface==="grass"){
    x.fillStyle="#628c3e"; x.fillRect(0,0,wid,len);
    for(let v=0;v<len;v+=14){ x.fillStyle=(v/14)%2?"rgba(255,255,230,0.07)":"rgba(0,20,0,0.07)"; x.fillRect(0,v,wid,14); }
    speckle(9000,["#4e7a30","#7aa04c","#6a9444"],0.35);
    // the worn line down the middle, where every wheel goes
    for(const o of [-1.4,1.4]){ x.fillStyle="rgba(110,96,60,0.22)"; x.fillRect(wid/2+o-0.7,40,1.4,len-80); }
  }else if(surface==="gravel"){
    x.fillStyle="#a39a86"; x.fillRect(0,0,wid,len);
    speckle(16000,["#8a8270","#bdb4a0","#6e6858","#c8c0aa"],0.45);
    for(const o of [-1.5,1.5]){ x.fillStyle="rgba(80,72,58,0.30)"; x.fillRect(wid/2+o-0.8,20,1.6,len-40); }
    // grass creeping in at the edges
    x.fillStyle="rgba(98,130,60,0.55)"; x.fillRect(0,0,1.2,len); x.fillRect(wid-1.2,0,1.2,len);
    speckle(3000,["#6a8a44"],0.4);
  }else if(surface==="concrete"){
    x.fillStyle="#a8a69e"; x.fillRect(0,0,wid,len);
    // slabs, each its own shade, with tarred joints between them
    const sw=wid/6, sl=6;
    for(let v=0;v<len;v+=sl) for(let u=0;u<wid;u+=sw){
      const k=rng(); x.fillStyle=`rgba(${k<0.5?"70,68,62":"200,198,190"},${0.05+rng()*0.10})`; x.fillRect(u,v,sw,sl);
    }
    x.fillStyle="rgba(40,38,34,0.55)";
    for(let v=0;v<len;v+=sl) x.fillRect(0,v,wid,0.18);
    for(let u=0;u<=wid;u+=sw) x.fillRect(u-0.09,0,0.18,len);
    for(let i=0;i<260;i++){                                    // tar-sealed cracks
      x.strokeStyle="rgba(30,28,26,0.5)"; x.lineWidth=0.14;
      const u=rng()*wid, v=rng()*len;
      x.beginPath(); x.moveTo(u,v); x.lineTo(u+(rng()-0.5)*4,v+(rng()-0.5)*8); x.stroke();
    }
    speckle(6000,["#8a887e","#c0beb4"],0.3);
    x.fillStyle="rgba(236,232,220,0.62)";                      // faded markings
    for(let v=90;v<len-90;v+=50) x.fillRect(wid/2-0.45,v,0.9,24);
    for(let i=0;i<6;i++){ x.fillRect(wid/2-15+i*6,8,2.2,28); x.fillRect(wid/2-15+i*6,len-36,2.2,28); }
    numbers("#ece8dc",0.62);
  }else{                                                        // asphalt
    x.fillStyle="#4a4a4c"; x.fillRect(0,0,wid,len);
    speckle(14000,["#5a5a5c","#3c3c3e","#6a6a68"],0.35);
    x.globalAlpha=0.10;
    for(let i=0;i<40;i++){ x.fillStyle=rng()<0.5?"#3a3a3c":"#5a5a58"; x.fillRect(rng()*wid,rng()*len,2+rng()*8,10+rng()*40); }
    x.globalAlpha=0.5; x.fillStyle="#3a3a3c";                 // rubber in the touchdown zones
    x.fillRect(wid*0.15,len-240,wid*0.7,120); x.fillRect(wid*0.15,120,wid*0.7,120);
    x.globalAlpha=1; x.fillStyle="#e8e4d8";
    const keys=Math.max(4,Math.floor(wid/3.6));               // threshold piano keys
    for(let i=0;i<keys;i++){
      const u=(wid-4)*(i+0.5)/keys+2-0.9;
      x.fillRect(u,6,1.8,30); x.fillRect(u,len-36,1.8,30);
    }
    for(let v=62+22;v<len-62-22;v+=50) x.fillRect(wid/2-0.45,v+10,0.9,30);   // centreline
    x.fillRect(0.8,0,0.9,len); x.fillRect(wid-1.7,0,0.9,len);                // edge lines
    for(const v of [160,220,len-220,len-160]){                                // touchdown zone bars
      x.fillRect(wid/2-10,v,1.8,22); x.fillRect(wid/2+8.2,v,1.8,22);
    }
    x.fillRect(wid/2-8,300,3.6,45); x.fillRect(wid/2+4.4,300,3.6,45);        // aiming points
    x.fillRect(wid/2-8,len-345,3.6,45); x.fillRect(wid/2+4.4,len-345,3.6,45);
    numbers("#e8e4d8",1);
  }
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  return t;
}

// ---------- the layouts ----------
// dress(put, L) puts the buildings up. put.add(geo, x, z, ry) places a baked
// mesh on the field (x across, z along, runway centre at the origin, the
// approach from +z); put.glow(geo, x, z, ry) places glazing that lights up at
// dusk; put.apron(x, z, w, l, surface) lays hard standing with a taxiway on to
// the strip; put.windsock(x, z).
//
// Everything that gives a field its character stands along the first 500 m
// from the approach end — `N` below is that threshold's z — because that is
// the stretch the pilot rolls past on take-off and after landing. `E` is the
// runway's half-width, `s` the side the buildings are on. Each field has one
// tall landmark, to be known by from the approach.
const PAINT={ yellow:["#f2c14e","#c33a28"], cream:["#fbf4e2","#2b4f86"], sage:["#b8cfa0","#5a3a24"],
              red:["#c8342a","#f4f0e6"], white:["#f0f0ec","#2b6a4a"], blue:["#2e5f9a","#f2f0ea"] };
const edgeMarkers=(put,L,geo,every)=>{
  for(let z=-L.len/2+every/2;z<L.len/2;z+=every){ put.add(geo,-L.wid/2-1.5,z,Math.PI/2); put.add(geo,L.wid/2+1.5,z,Math.PI/2); }
};

export const LAYOUTS={
  farm:{ name:"Home Farm Strip", side:1, rwy:"18", surface:"grass", len:900, wid:30, margin:125,
    lights:false, approachLights:false,
    dress(put,L){
      const E=L.wid/2, s=L.side, N=L.len/2;
      put.add(grainSilos(), s*(E+92), N-235, 0);
      put.add(dutchBarn(), s*(E+58), N-170, Math.PI/2);
      put.add(Models.farmhouse.near, s*(E+104), N-300, Math.PI/2);
      put.add(Models.barn.near, s*(E+92), N-110, 0);
      put.add(smallHangar("#6e5238","#5a6468"), s*(E+44), N-360, -s*Math.PI/2);
      put.add(highWing(...PAINT.yellow), s*(E+22), N-60, -s*Math.PI/2+0.3);
      put.add(makeParkedPlane(...PAINT.sage), s*(E+24), N-92, -s*Math.PI/2+0.2);
      put.add(tractor(), s*(E+40), N-205, 0.4);
      put.add(fuelTruck("#2a6a3a"), s*(E+28), N-300, 0.1);
      put.add(baleStack(5), s*(E+34), N-140, 0.3);
      edgeMarkers(put,L,markerBoard(),60);
      put.windsock(-s*(E+26), N-80);
    }},
  gliding:{ name:"Downs Gliding Club", side:-1, rwy:"24", surface:"grass", len:1050, wid:58, margin:150,
    lights:false, approachLights:false,
    dress(put,L){
      const E=L.wid/2, s=L.side, N=L.len/2;
      put.add(tHangars(8,"#7c8a6e",["#5a6450","#66705a"]), s*(E+78), N-330, -s*Math.PI/2);
      put.add(clubhouse("#c8b494","#5c6068"), s*(E+62), N-210, -s*Math.PI/2);
      put.add(portakabin("#e8e2cc"), s*(E+44), N-150, -s*Math.PI/2);
      put.add(portakabin("#d8dcd0"), s*(E+44), N-166, -s*Math.PI/2);
      put.add(launchCaravan(), s*(E+10), N-40, 0);
      put.add(glider("#f4f4f0","#d2452f"), s*(E+20), N-80, 0.08);
      put.add(glider("#f4f4f0","#2b6a9a"), s*(E+24), N-112, -0.05);
      put.add(glider("#f6f2e4","#f2c14e"), s*(E+22), N-144, 0.12);
      put.add(glider("#f4f4f0","#3a3a3a"), s*(E+26), N-176, -0.1);
      put.add(lowWing(...PAINT.red), s*(E+32), N-410, -s*Math.PI/2-0.2);
      put.add(winch(), -12, -N-50, 0.3);
      ["#c8342a","#2e5f9a","#e8e4d8","#3a3a3a","#6a8a4a"].forEach((c,i)=>put.add(car(c), s*(E+86), N-190-i*6, -s*Math.PI/2));
      edgeMarkers(put,L,markerBoard(),90);
      put.windsock(-s*(E+30), N-120);
    }},
  wartime:{ name:"Old Sarum Aerodrome", side:-1, rwy:"22", surface:"concrete", len:1100, wid:46, margin:170,
    lights:false, approachLights:false,
    dress(put,L){
      const E=L.wid/2, s=L.side, N=L.len/2, hg=makeHangar();
      put.apron(s*(E+42), N-250, 34, 440, "concrete");
      put.add(waterTower(), s*(E+150), N-70, 0.2);
      for(let i=0;i<3;i++) put.add(hg, s*(E+96), N-130-i*84, Math.PI/2);
      put.add(makeTower(), s*(E+66), N-410, Math.PI/2);
      for(let i=0;i<4;i++) put.add(nissen(), s*(E+84), N-470-i*20, 0);
      put.add(fuelTruck("#4a5a3a"), s*(E+40), N-330, Math.PI/2);
      [PAINT.yellow,PAINT.cream,PAINT.sage].forEach((c,i)=>
        put.add(makeParkedPlane(...c), s*(E+44), N-110-i*84, Math.PI/2+(i-1)*0.25));
      put.windsock(-s*(E+34), N-60);
    }},
  lakeside:{ name:"Lakeside Flying Club", side:1, rwy:"09", surface:"asphalt", len:950, wid:30, margin:140,
    lights:true, approachLights:false,
    dress(put,L){
      const E=L.wid/2, s=L.side, N=L.len/2;
      put.apron(s*(E+36), N-210, 44, 300, "asphalt");
      put.add(boxHangar(34,26,7,"#c8ccd0","#6a7078","#e8eaec"), s*(E+82), N-300, -s*Math.PI/2);
      put.add(boxHangar(30,24,6.5,"#9aa8b4","#5a626a","#dfe4e8"), s*(E+80), N-210, -s*Math.PI/2);
      put.add(clubhouse("#8a6a4a","#4a4e52"), s*(E+74), N-110, -s*Math.PI/2);
      put.add(controlTower().body, s*(E+118), N-160, 0);            // the club's lookout, their landmark
      put.add(fuelPumps(), s*(E+36), N-80, 0);
      put.add(highWing(...PAINT.white), s*(E+30), N-290, -s*Math.PI/2+0.4);
      put.add(highWing(...PAINT.blue), s*(E+34), N-250, -s*Math.PI/2+0.2);
      put.add(lowWing(...PAINT.yellow), s*(E+30), N-200, -s*Math.PI/2+0.3);
      ["#2e5f9a","#e8e4d8","#c8342a"].forEach((c,i)=>put.add(car(c), s*(E+104), N-120-i*6, -s*Math.PI/2));
      put.windsock(-s*(E+24), N-70);
    }},
  highland:{ name:"Glen Strip", side:-1, rwy:"31", surface:"gravel", len:820, wid:24, margin:110,
    lights:false, approachLights:false,
    dress(put,L){
      const E=L.wid/2, s=L.side, N=L.len/2;
      put.add(ruinedTower(), s*(E+96), N-300, 0.4);
      put.add(nissen(), s*(E+44), N-200, Math.PI/2);
      put.add(Models.farmhouse.near, s*(E+72), N-120, Math.PI/2);
      put.add(smallHangar("#4a5a44","#3a4038"), s*(E+48), N-270, -s*Math.PI/2);
      put.add(landRover(), s*(E+26), N-150, 0.6);
      put.add(highWing(...PAINT.red), s*(E+24), N-90, -s*Math.PI/2-0.3);
      put.add(drums(8), s*(E+22), N-175, 0);
      edgeMarkers(put,L,cone(),50);
      put.windsock(-s*(E+22), N-60);
    }},
  regional:{ name:"Vale Regional Airport", side:1, rwy:"27", surface:"asphalt", len:1200, wid:45, margin:200,
    lights:true, approachLights:true,
    dress(put,L){
      const E=L.wid/2, s=L.side, N=L.len/2;
      put.apron(s*(E+88), N-270, 132, 420, "asphalt");
      const t=terminal(); put.add(t.body, s*(E+176), N-270, -s*Math.PI/2); put.glow(t.glass, s*(E+176), N-270, -s*Math.PI/2);
      const ct=controlTower(); put.add(ct.body, s*(E+168), N-80, 0); put.glow(ct.glass, s*(E+168), N-80, 0);
      put.add(boxHangar(60,44,12,"#d0d4d8","#6a7078","#e8eaec"), s*(E+150), N-480, -s*Math.PI/2);
      put.add(airliner(), s*(E+92), N-300, Math.PI/2+0.25);
      put.add(lowWing(...PAINT.blue), s*(E+60), N-150, -s*Math.PI/2+0.4);
      put.add(highWing(...PAINT.white), s*(E+62), N-122, -s*Math.PI/2+0.3);
      put.add(fuelTruck("#c8342a"), s*(E+70), N-200, 0.3);
      ["#3a3a3a","#e8e4d8","#2e5f9a","#8a8a88","#c8342a","#e8e4d8"].forEach((c,i)=>
        put.add(car(c), s*(E+200), N-140-i*5, -s*Math.PI/2));
      put.windsock(-s*(E+30), N-80);
    }},
};


/** Every layout's key, for building them all up front in tests and tools. */
export const LAYOUT_IDS=Object.keys(LAYOUTS);

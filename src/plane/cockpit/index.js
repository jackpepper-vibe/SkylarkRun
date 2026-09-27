// Skylark — the cockpit manager.
//
// The cockpit is real geometry in metres round the pilot's eye (the origin,
// looking down -z), drawn in its own pass straight after the world into the
// same HDR target, over a cleared depth buffer: the nearest strut never fights
// the far hills for depth precision, and the cockpit goes through the same
// bloom and tone mapping as everything else.
//
// Which cockpit is drawn follows the aircraft chosen in the hangar. Each type
// is a module with one export, build(), returning its root group and a
// per-frame update; this manager owns what they share — the scene and its
// camera, the pilot's head, and the world's sun and sky turned into the
// aircraft's frame every frame, so paint flashes and shadows slide across the
// nose as she rolls. A cockpit is built the first time it is chosen and kept,
// so going back to one in the hangar is instant.
import * as THREE from 'three';
import { renderer, camera } from '../../view.js';
import { clamp } from '../../util.js';
import { Game, P } from '../../state.js';
import { SUNDIR } from '../../sun.js';
import { Quality } from '../../quality.js';
import { sunLight, hemiLight } from '../sky.js';
import { Aircraft } from '../aircraft.js';
import * as modern from './modern.js';
import * as vintage from './vintage.js';
import * as biplane from './biplane.js';
import * as cabin from './cabin.js';
import * as trike from './trike.js';

const BUILDERS={ modern, vintage, biplane, cabin, trike };

const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(camera.fov,camera.aspect,0.02,60);
cam.rotation.order="YXZ";

// ---------- light, in the aircraft's frame ----------
const sun=new THREE.DirectionalLight(0xffffff,1);
sun.shadow.mapSize.set(1024,1024);
sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.012; sun.shadow.radius=1;
scene.add(sun,sun.target);
const hemi=new THREE.HemisphereLight(0xffffff,0x444444,1);
scene.add(hemi);
Quality.onChange(spec=>{ sun.castShadow=spec.shadows; });
/** Fit the sun's shadow box to a cockpit: centre and half-size, in metres. */
function fitShadow(center,half){
  sun.target.position.set(center[0],center[1],center[2]);
  const c=sun.shadow.camera;
  c.left=-half; c.right=half; c.top=half; c.bottom=-half; c.near=0.1; c.far=half*8;
  c.updateProjectionMatrix();
}

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
  geo.dispose();
}

// ---------- the cockpits ----------
const built={};
let active=null;
function ensure(kind){
  if(!built[kind]){
    const c=BUILDERS[kind].build();
    c.root.visible=false;
    scene.add(c.root);
    built[kind]=c;
  }
  return built[kind];
}
function select(spec){
  const c=ensure(spec.cockpit);
  if(active&&active!==c) active.root.visible=false;
  active=c;
  active.root.visible=true;
  fitShadow(active.shadow?.center||[0,-0.3,-1.2],active.shadow?.half||2.6);
  scene.environmentIntensity=active.envIntensity??0.9;
}

const _qInv=new THREE.Quaternion(), _sunL=new THREE.Vector3(), _up=new THREE.Vector3();
const frame={sunL:_sunL,up:_up,sunCol:new THREE.Color(),speedFrac:0,dt:0};
let lastT=0;

export const Cockpit={
  scene, camera:cam,
  /** Rebuild the reflections for a time of day, and let each cockpit reset its sector state. */
  setSky(td){
    buildEnvironment(td);
    for(const k in built) built[k].setSky?.(td);
  },
  /** Build a cockpit type ahead of time (the tools build them all). */
  prepare(kind){ ensure(kind); },
  /** Pose, light and animate the cockpit for this frame; returns the pass to render. */
  update(t){
    const dt=Math.min(0.1,Math.max(0,(t-lastT)/1000)); lastT=t;
    if(cam.fov!==camera.fov||cam.aspect!==camera.aspect){
      cam.fov=camera.fov; cam.aspect=camera.aspect; cam.updateProjectionMatrix();
    }
    // the pilot's head: lags the aircraft in a turn or a pull, and the airframe
    // buzzes with the engine and rumbles on the strip
    const hx=-clamp(P.vx*0.26,-26,26)*0.0006, hy=clamp(-P.vy*0.20,-18,18)*0.0006;
    const rumble=(active.rumble??0.00035)+Game.shake*0.004;
    cam.position.set(hx+Math.sin(t*0.093)*rumble,hy+Math.sin(t*0.131+1.3)*rumble,Math.sin(t*0.071)*rumble*0.5);
    cam.rotation.set(Math.sin(t*0.05)*Game.shake*0.004,0,Math.sin(t*0.063)*Game.shake*0.004);

    // the world's sun and sky, turned into the aircraft's frame
    _qInv.copy(camera.quaternion).invert();
    _sunL.copy(SUNDIR).applyQuaternion(_qInv);
    _up.set(0,1,0).applyQuaternion(_qInv);
    sun.color.copy(sunLight.color); sun.intensity=sunLight.intensity;
    sun.position.copy(sun.target.position).addScaledVector(_sunL,8);
    hemi.color.copy(hemiLight.color); hemi.groundColor.copy(hemiLight.groundColor);
    hemi.intensity=hemiLight.intensity*(active.skyLight??1); hemi.position.copy(_up);
    scene.environmentRotation.setFromQuaternion(_qInv);

    frame.dt=dt;
    frame.sunCol.copy(sunLight.color);
    frame.speedFrac=clamp(P.speed/Aircraft.spec.speedMax,0,1);
    active.update(t,dt,frame);
    return this.pass;
  },
  pass:{scene,camera:cam}
};
Aircraft.onChange(select);

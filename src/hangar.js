// Skylark Run — the hangar screen.
//
// Choosing an aeroplane happens sitting in it: the overlay is clear down the
// middle, so the live cockpit of whichever type is selected shows behind the
// choice, engine running, while the countryside flies past in attract mode.
// The panel along the bottom carries the type, a line about how she flies,
// four ratings and the score multiplier, and one button per aircraft.
import { Aircraft } from './plane/aircraft.js';
import { Game } from './state.js';
import { show } from './overlays.js';
import { esc } from './util.js';

/** Side-on silhouettes, 64 x 30, nose to the left. */
const SILHOUETTES={
  skylark:  '<path d="M6 19 Q8 15 14 15 L50 16 L58 11 L60 11 L59 18 L52 20 L14 21 Q8 21 6 19Z"/><rect x="12" y="6" width="26" height="2.4" rx="1"/><path d="M20 8 L18 15 M30 8 L32 15" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="12" width="1.6" height="10" rx=".8"/>',
  linnet:   '<path d="M6 18 Q8 15 14 15 L50 16 L58 11 L60 11 L59 18 L52 19 L14 20 Q8 20 6 18Z"/><rect x="10" y="7" width="28" height="2.2" rx="1"/><rect x="12" y="20" width="26" height="2.2" rx="1"/><path d="M16 9 L16 20 M32 9 L32 20 M16 9 L32 20" stroke="currentColor" stroke-width="1.1"/><rect x="3" y="11" width="1.6" height="10" rx=".8"/>',
  wayfarer: '<path d="M5 20 Q6 15 12 14 L18 10 L34 10 L38 15 L54 16 L60 9 L62 9 L61 18 L54 20 L12 22 Q6 22 5 20Z"/><rect x="14" y="8" width="26" height="2.4" rx="1"/><path d="M24 12 L20 20" stroke="currentColor" stroke-width="1.3"/><circle cx="16" cy="25" r="2"/><circle cx="30" cy="25" r="2"/><rect x="2" y="13" width="1.6" height="10" rx=".8"/>',
  dragonfly:'<path d="M4 8 L60 5 L62 7 L10 10Z"/><path d="M32 7 L30 20 M32 7 L22 19" stroke="currentColor" stroke-width="1.4"/><path d="M14 22 Q16 17 24 17 L36 18 L40 22 L36 24 L18 24 Q14 24 14 22Z"/><circle cx="18" cy="27" r="1.8"/><circle cx="36" cy="27" r="1.8"/><rect x="42" y="16" width="1.4" height="9" rx=".7"/>',
  sunburst: '<path d="M4 17 Q6 13 14 13 L22 11 L28 11 L32 14 L50 15 L58 7 L61 7 L60 17 L50 19 L14 20 Q6 20 4 17Z"/><rect x="16" y="17" width="24" height="2.2" rx="1"/><rect x="1.5" y="11" width="1.6" height="10" rx=".8"/>',
};
const STAT_LABELS=[["speed","Speed"],["agility","Agility"],["toughness","Toughness"],["range","Range"]];

let flyHandler=null, backHandler=null;
const $=id=>document.getElementById(id);

function render(){
  const a=Aircraft.spec;
  $("acKind").textContent=a.kind;
  $("acName").textContent=a.name;
  $("acBlurb").textContent=a.blurb;
  $("acStats").innerHTML=STAT_LABELS.map(([k,label])=>
    "<span>"+label+"</span><span class=\"pips\">"+
    [1,2,3,4,5].map(i=>"<i"+(i<=a.stats[k]?' class="on"':"")+"></i>").join("")+"</span>").join("")+
    "<span class=\"acMul\">Airframe "+a.lives+" hits &middot; score &times;"+a.scoreMul.toFixed(1)+"</span>";
  for(const b of $("acList").children){
    const on=b.dataset.id===a.id;
    b.classList.toggle("sel",on);
    b.setAttribute("aria-selected",on?"true":"false");
  }
}

function build(){
  const list=$("acList");
  list.innerHTML=Aircraft.list.map(a=>
    '<button type="button" role="option" data-id="'+esc(a.id)+'" title="'+esc(a.name)+'">'+
    '<svg viewBox="0 0 64 30" fill="currentColor" aria-hidden="true">'+SILHOUETTES[a.id]+'</svg>'+
    esc(a.name)+'</button>').join("");
  list.addEventListener("click",e=>{
    const b=e.target.closest("button[data-id]");
    if(b){ Aircraft.select(b.dataset.id); render(); }
  });
  $("flyBtn").addEventListener("click",()=>{ if(flyHandler) flyHandler(); });
  $("hangarBack").addEventListener("click",()=>{ if(backHandler) backHandler(); });
  window.addEventListener("keydown",e=>{
    if(!Game.hangar) return;
    if(e.key==="ArrowLeft"||e.key==="a"){ Aircraft.cycle(-1); render(); e.preventDefault(); }
    else if(e.key==="ArrowRight"||e.key==="d"){ Aircraft.cycle(1); render(); e.preventDefault(); }
    else if(e.key==="Enter"&&flyHandler){ flyHandler(); e.preventDefault(); }
    else if(e.key==="Escape"&&backHandler){ backHandler(); e.preventDefault(); }
  });
}
build();

export const Hangar={
  /** Open the hangar. `onFly` starts the flight; `onBack` leaves without flying. */
  open(onFly,onBack){
    flyHandler=onFly; backHandler=onBack;
    Game.hangar=true;
    render();
    show("hangarOverlay");
  },
  /** Close it: the engine preview stops with it. */
  close(){ Game.hangar=false; },
  /** The label on the Fly button: devices that tilt ask for permission first. */
  setFlyLabel(html){ $("flyBtn").innerHTML=html; },
};

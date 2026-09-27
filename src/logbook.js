// Skylark Run — the logbook and the world board.
//
// Two stores, deliberately separate. The logbook is this device's own history
// in localStorage and always works; the world board is the shared one behind
// /api/scores and is allowed to be absent — opened straight off disk, or with
// no database configured, the game carries on without it. Nothing in the
// flight loop ever waits on the network.
import { esc, ordinal } from './util.js';
import { AIRCRAFT } from './plane/aircraft.js';

/** Both boards show ten: the world's best ten pilots, or this device's ten best runs. */
const BOARD_SIZE=10;

// ---------- the logbook: scores that survive a reload ----------
// Storage can throw (private mode, quota, file:// in some browsers), so every
// access is guarded and the game carries on with an in-memory logbook.
const Save={
  KEY:"skylarkRun.v1",
  data:{board:[],bestScore:0,bestSector:1,bestChain:0,bestLanding:"",pilot:"",stars:{}},
  ok:true,
  load(){
    try{
      const raw=window.localStorage.getItem(this.KEY);
      if(raw){
        const d=JSON.parse(raw);
        if(d&&Array.isArray(d.board)) Object.assign(this.data,d);
      }
    }catch(e){ this.ok=false; }
    return this.data;
  },
  flush(){
    if(!this.ok) return;
    try{ window.localStorage.setItem(this.KEY,JSON.stringify(this.data)); }
    catch(e){ this.ok=false; }
  },
  // records that stand on their own, whether or not the score makes the board
  noteRun(g,p){
    const d=this.data;
    d.bestScore=Math.max(d.bestScore,Math.floor(g.score));
    d.bestSector=Math.max(d.bestSector,g.lvl);
    d.bestChain=Math.max(d.bestChain,g.bestCombo);
    this.flush();
  },
  /** The best stars won on a sector of the tour, by its key. */
  noteStars(key,n){
    const s=this.data.stars||(this.data.stars={});
    if(!(s[key]>=n)){ s[key]=n; this.flush(); }
  },
  qualifies(score){
    const b=this.data.board;
    return score>0&&(b.length<BOARD_SIZE||score>b[b.length-1].score);
  },
  submit(entry){
    const b=this.data.board;
    b.push(entry);
    b.sort((x,y)=>y.score-x.score);
    b.length=Math.min(b.length,BOARD_SIZE);
    this.data.pilot=entry.name;
    this.flush();
    return b.indexOf(entry);
  }
};
const board=Save.load().board;

// ---------- the global logbook ----------
// Backed by /api/scores. Everything here is best-effort: if the endpoint is
// missing, unprovisioned or unreachable, the game shows the local logbook and
// carries on. Nothing in the flight loop ever waits on the network.
const Net={
  online:false, checked:false, board:[], sending:false, note:"",
  // opened straight off disk there is no API to talk to
  usable(){ return typeof location!=="undefined"&&location.protocol!=="file:"; },
  async load(){
    if(!this.usable()){ this.checked=true; this.online=false; renderBoard(); return false; }
    try{
      const res=await fetch("api/scores",{cache:"no-store"});
      const d=await res.json();
      this.online=!!(d&&d.ok&&d.configured);
      this.board=(d&&d.board)||[];
    }catch(e){
      this.online=false; this.board=[];
    }
    this.checked=true;
    renderBoard();
    return this.online;
  },
  async submit(entry){
    if(!this.online||this.sending) return null;
    this.sending=true;
    try{
      const res=await fetch("api/scores",{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(entry)});
      const d=await res.json();
      if(d&&Array.isArray(d.board)) this.board=d.board;
      return d;
    }catch(e){ return null; }
    finally{ this.sending=false; }
  }
};
// Names go into the board through innerHTML. World-board names are sanitised
// server-side, but a name typed here reaches the local logbook first, so escape
// on render and clean on entry — the same rules the endpoint applies.

const NAME_MAX=16;
function cleanName(raw){
  return String(raw==null?"":raw)
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} '._-]/gu,"")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,NAME_MAX);
}


const MEDALS=["gold","silver","bronze"];
const aircraftName=id=>{ const a=AIRCRAFT.find(x=>x.id===id); return a?a.name:""; };
/** One board into one table body: rank, pilot, score, sector, aircraft. */
function fillBoard(tbody,rows,highlight,empty){
  if(!tbody) return;
  if(!rows.length){ tbody.innerHTML='<tr><td class="empty" colspan="5">'+empty+'</td></tr>'; return; }
  tbody.innerHTML=rows.slice(0,BOARD_SIZE).map((e,i)=>{
    const cls=[MEDALS[i]||"",highlight&&e.name===highlight?"you":""].join(" ").trim();
    // names come from other players: escaped, always
    return '<tr'+(cls?' class="'+cls+'"':'')+'><td>'+(i+1)+'</td><td>'+esc(e.name)+'</td><td>'+
      Math.floor(e.score).toLocaleString()+'</td><td>S'+(e.lvl||1)+'</td><td>'+esc(aircraftName(e.aircraft))+'</td></tr>';
  }).join("");
}
/**
 * Draw the top ten wherever it is shown — the start card and the flight
 * report — from the world board when it is reachable and has runs on it, and
 * from this device's logbook otherwise. `highlight` is a pilot name to pick
 * out; by default, whoever last saved a score here.
 */
function renderBoard(highlight){
  const global=Net.online&&Net.board.length>0;
  const rows=global?Net.board:board;
  const me=highlight||Save.data.pilot;
  const empty=!Net.checked?"loading the board…":(Net.online?"no pilots on the board yet — be the first":"no runs in your logbook yet");
  fillBoard(document.getElementById("startBoard"),rows,me,empty);
  fillBoard(document.getElementById("boardList"),rows,me,empty);
  const where=global?"world · top "+BOARD_SIZE:(Net.checked?"your logbook · world board offline":"your logbook");
  const st=document.getElementById("startBoardStatus");
  if(st) st.textContent=where;
  // the flight report also carries what just happened to a submitted score
  const rt=document.getElementById("boardStatus");
  if(rt) rt.innerHTML=Net.note||esc(where);
  const bl=document.getElementById("bestLine");
  if(bl){
    const d=Save.data;
    bl.innerHTML=d.bestScore?"Your best <b>"+d.bestScore.toLocaleString()+"</b> &middot; sector <b>"+
      d.bestSector+"</b> &middot; chain <b>x"+d.bestChain+"</b>":"";
    bl.style.display=d.bestScore?"block":"none";
  }
}

export { BOARD_SIZE, Save, Net, renderBoard, cleanName, NAME_MAX };

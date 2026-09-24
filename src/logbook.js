// Skylark Run — the logbook and the world board.
//
// Two stores, deliberately separate. The logbook is this device's own history
// in localStorage and always works; the world board is the shared one behind
// /api/scores and is allowed to be absent — opened straight off disk, or with
// no database configured, the game carries on without it. Nothing in the
// flight loop ever waits on the network.
import { esc, ordinal } from './util.js';

// ---------- the logbook: scores that survive a reload ----------
// Storage can throw (private mode, quota, file:// in some browsers), so every
// access is guarded and the game carries on with an in-memory logbook.
const Save={
  KEY:"skylarkRun.v1",
  data:{board:[],bestScore:0,bestSector:1,bestChain:0,bestLanding:"",pilot:"AAA"},
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
  qualifies(score){
    const b=this.data.board;
    return score>0&&(b.length<5||score>b[b.length-1].score);
  },
  submit(entry){
    const b=this.data.board;
    b.push(entry);
    b.sort((x,y)=>y.score-x.score);
    b.length=Math.min(b.length,5);
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


function renderBoard(highlight){
  const ol=document.getElementById("boardList");
  const global=Net.online&&Net.board.length>0;
  const rows=global?Net.board:board;
  ol.innerHTML=rows.length
    ? rows.map((e,i)=>{
        const me=highlight&&e.name===highlight;
        return "<li"+(me?' style="color:#c9ffd0"':"")+">"+esc(e.name)+" &mdash; "+
          e.score.toLocaleString()+" &middot; S"+(e.lvl||1)+"</li>";
      }).join("")
    : '<li style="opacity:.6;list-style:none">'+
      (Net.online?"no pilots on the board yet":"no logbook entries yet")+"</li>";
  const st=document.getElementById("boardStatus");
  if(st){
    st.innerHTML=Net.note ? Net.note
      : (global?"world logbook"
              :(Net.checked?"your logbook &middot; world board unavailable":"your logbook"));
  }
  const bl=document.getElementById("bestLine");
  if(bl){
    const d=Save.data;
    const parts=[];
    if(d.bestScore) parts.push("Best <b>"+d.bestScore.toLocaleString()+"</b> &middot; sector <b>"+
      d.bestSector+"</b> &middot; chain <b>x"+d.bestChain+"</b>");
    if(Net.online&&Net.board.length)
      parts.push("World leader <b>"+esc(Net.board[0].name)+"</b> &middot; <b>"+
        Net.board[0].score.toLocaleString()+"</b>");
    bl.innerHTML=parts.join("<br>");
    bl.style.display=parts.length?"block":"none";
  }
}

export { Save, Net, renderBoard, cleanName, NAME_MAX };

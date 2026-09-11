// Skylark Run — sound.
//
// A radial engine, the slipstream past an open cockpit, and a small score,
// all synthesised through the Web Audio API rather than loaded as files.
// Everything hangs off one master gain so muting is a single switch.
/* global THREE */
import { clamp, midiF } from './util.js';
// The engine note rides airspeed as a fraction of the envelope. Both craft
// define SPEED_MAX; the plane's is the reference the mix was tuned against.
import { SPEED_MAX } from './plane/config.js';
import { S, Game, P, G } from './state.js';

// ---------- audio: radial engine, slipstream, and a bright little score ----------
let AC=null,master=null,muted=false,noiseBuf=null;
let engSaw=null,engLfo=null,engGain=null,windGain=null,windFilter=null,rainGain=null,musicGain=null;
const MUSIC={next:0,step:0};

function initAudio(){
  if(AC)return;
  try{
    AC=new(window.AudioContext||window.webkitAudioContext)();
    master=AC.createGain();master.gain.value=0.5;master.connect(AC.destination);
    const len=AC.sampleRate*2,buf=AC.createBuffer(1,len,AC.sampleRate),ch=buf.getChannelData(0);
    for(let i=0;i<len;i++)ch[i]=Math.random()*2-1;
    noiseBuf=buf;
    // engine: sawtooth core chopped by the cylinder firing order
    engSaw=AC.createOscillator();engSaw.type="sawtooth";engSaw.frequency.value=105;
    const chop=AC.createGain();chop.gain.value=0.35;
    engLfo=AC.createOscillator();engLfo.type="square";engLfo.frequency.value=38;
    const lfoG=AC.createGain();lfoG.gain.value=0.30;
    engLfo.connect(lfoG);lfoG.connect(chop.gain);
    const engLp=AC.createBiquadFilter();engLp.type="lowpass";engLp.frequency.value=900;
    engGain=AC.createGain();engGain.gain.value=0.10;
    engSaw.connect(chop);chop.connect(engLp);engLp.connect(engGain);engGain.connect(master);
    // slipstream past an open cockpit
    const windSrc=AC.createBufferSource();windSrc.buffer=buf;windSrc.loop=true;
    windFilter=AC.createBiquadFilter();windFilter.type="bandpass";
    windFilter.frequency.value=700;windFilter.Q.value=0.6;
    windGain=AC.createGain();windGain.gain.value=0.05;
    windSrc.connect(windFilter);windFilter.connect(windGain);windGain.connect(master);
    // rain
    const rainSrc=AC.createBufferSource();rainSrc.buffer=buf;rainSrc.loop=true;
    const hp=AC.createBiquadFilter();hp.type="highpass";hp.frequency.value=3600;
    rainGain=AC.createGain();rainGain.gain.value=0;
    rainSrc.connect(hp);hp.connect(rainGain);rainGain.connect(master);
    musicGain=AC.createGain();musicGain.gain.value=0.15;musicGain.connect(master);
    engSaw.start();engLfo.start();windSrc.start();rainSrc.start();
    MUSIC.next=AC.currentTime+0.1;MUSIC.step=0;
  }catch(e){}
}

function audioTick(){
  if(!AC||!engSaw)return;
  const t=AC.currentTime;
  const thr=Game.state===S.ROLLOUT?0.35:1;
  engSaw.frequency.setTargetAtTime(72+P.speed*0.62,t,0.20);
  engLfo.frequency.setTargetAtTime(26+P.speed*0.26,t,0.25);
  engGain.gain.setTargetAtTime(0.10*thr,t,0.3);
  windFilter.frequency.setTargetAtTime(420+P.speed*5.5,t,0.3);
  windGain.gain.setTargetAtTime(0.018+P.speed/SPEED_MAX*0.055,t,0.3);
  // generative score: I - V - vi - IV in D major, plucked
  const spb=60/104, s16=spb/4;
  const CH=[[38,50,54,57],[45,57,61,64],[42,54,57,61],[43,55,59,62]];
  if(MUSIC.next<t-0.5)MUSIC.next=t+0.05;
  while(MUSIC.next<t+0.25){
    const st=MUSIC.step, when=MUSIC.next, ch2=CH[Math.floor(st/16)%4];
    if(st%4===0){                                     // bass on the beat
      const o=AC.createOscillator(),g=AC.createGain();
      o.type="triangle";o.frequency.value=midiF(ch2[0]);
      g.gain.setValueAtTime(0.06,when);
      g.gain.exponentialRampToValueAtTime(0.001,when+0.30);
      o.connect(g);g.connect(musicGain);o.start(when);o.stop(when+0.32);
    }
    if(st%2===1){                                     // arpeggio pluck
      const note=ch2[1+((st>>1)%3)];
      const o=AC.createOscillator(),g=AC.createGain(),f=AC.createBiquadFilter();
      o.type="triangle";o.frequency.value=midiF(note+12);
      f.type="lowpass";f.frequency.setValueAtTime(3200,when);
      f.frequency.exponentialRampToValueAtTime(700,when+0.22);
      g.gain.setValueAtTime(0.035,when);
      g.gain.exponentialRampToValueAtTime(0.001,when+0.26);
      o.connect(f);f.connect(g);g.connect(musicGain);o.start(when);o.stop(when+0.28);
    }
    if(st%8===4){
      const b=AC.createBufferSource();b.buffer=hatBuf();
      const g=AC.createGain();g.gain.value=0.035;
      b.connect(g);g.connect(musicGain);b.start(when);
    }
    if(st%32===0){                                    // warm pad underneath
      for(const m of ch2.slice(1)){
        const o=AC.createOscillator(),g=AC.createGain(),f=AC.createBiquadFilter();
        o.type="sawtooth";o.frequency.value=midiF(m);o.detune.value=(Math.random()-0.5)*12;
        f.type="lowpass";f.frequency.value=1100;
        g.gain.setValueAtTime(0.0001,when);
        g.gain.linearRampToValueAtTime(0.016,when+0.6);
        g.gain.setValueAtTime(0.016,when+spb*7);
        g.gain.linearRampToValueAtTime(0.0001,when+spb*8);
        o.connect(f);f.connect(g);g.connect(musicGain);
        o.start(when);o.stop(when+spb*8.1);
      }
    }
    MUSIC.next+=s16;MUSIC.step++;
  }
}
function chime(freq){
  if(!AC||muted)return;
  const o=AC.createOscillator(),g=AC.createGain();
  o.type="sine";o.frequency.setValueAtTime(freq,AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(freq*1.5,AC.currentTime+0.09);
  g.gain.setValueAtTime(0.24,AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+0.32);
  o.connect(g);g.connect(master);o.start();o.stop(AC.currentTime+0.34);
}
function thud(){
  if(!AC||muted)return;
  const o=AC.createOscillator(),g=AC.createGain();
  o.type="sine";o.frequency.setValueAtTime(190,AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(70,AC.currentTime+0.18);
  g.gain.setValueAtTime(0.16,AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+0.22);
  o.connect(g);g.connect(master);o.start();o.stop(AC.currentTime+0.24);
}
function whoosh(){
  if(!AC||muted)return;
  const s=AC.createBufferSource();s.buffer=noiseBuf;
  const f=AC.createBiquadFilter();f.type="bandpass";f.Q.value=2;
  f.frequency.setValueAtTime(320,AC.currentTime);
  f.frequency.exponentialRampToValueAtTime(1500,AC.currentTime+0.22);
  const g=AC.createGain();
  g.gain.setValueAtTime(0.14,AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+0.3);
  s.connect(f);f.connect(g);g.connect(master);s.start();s.stop(AC.currentTime+0.32);
}
function crashSound(){
  if(!AC||muted)return;
  const len=AC.sampleRate*0.45,buf=AC.createBuffer(1,len,AC.sampleRate),ch=buf.getChannelData(0);
  for(let i=0;i<len;i++)ch[i]=(Math.random()*2-1)*(1-i/len);
  const s=AC.createBufferSource();s.buffer=buf;
  const f=AC.createBiquadFilter();f.type="lowpass";f.frequency.value=1400;
  const g=AC.createGain();g.gain.value=0.85;
  s.connect(f);f.connect(g);g.connect(master);s.start();
}
function radioCall(){                                  // squelch blip on the approach call
  if(!AC||muted)return;
  const s=AC.createBufferSource();s.buffer=noiseBuf;
  const f=AC.createBiquadFilter();f.type="bandpass";f.frequency.value=1800;f.Q.value=6;
  const g=AC.createGain();
  g.gain.setValueAtTime(0.10,AC.currentTime);
  g.gain.setValueAtTime(0.10,AC.currentTime+0.10);
  g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+0.18);
  s.connect(f);f.connect(g);g.connect(master);s.start();s.stop(AC.currentTime+0.2);
}
function setMuted(m){
  muted=m;if(master)master.gain.value=m?0:0.5;
  document.getElementById("muteBtn").innerHTML=m?"&#128263;":"&#128266;";
}

// --- sounds the flight code asks for by name, rather than by reaching in ---

/** Rain bed: on while flying a wet sector, silent otherwise. */
function setRain(on){ if(rainGain) rainGain.gain.value = on ? 0.09 : 0; }

/** The long descending wail as she goes in, and the engine winding down. */
function deathSpiral(){
  if(AC && !muted){
    const o=AC.createOscillator(), g=AC.createGain();
    o.type="sawtooth";
    o.frequency.setValueAtTime(760,AC.currentTime);
    o.frequency.exponentialRampToValueAtTime(120,AC.currentTime+2.4);
    g.gain.value=0.07;
    o.connect(g); g.connect(master); o.start(); o.stop(AC.currentTime+2.5);
  }
  if(engGain) engGain.gain.setTargetAtTime(0.02, AC?AC.currentTime:0, 0.6);
}

/** Low-fuel warning pip. Returns false when muted or unavailable. */
function fuelBeep(){
  if(!(AC && !muted)) return false;
  const o=AC.createOscillator(), g=AC.createGain();
  o.type="square"; o.frequency.value=680;
  g.gain.setValueAtTime(0.05,AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+0.15);
  o.connect(g); g.connect(master); o.start(); o.stop(AC.currentTime+0.16);
  return true;
}

/** Obstacle proximity pip. Returns false when muted or unavailable. */
function obstacleBeep(){
  if(!(AC && !muted)) return false;
  const o=AC.createOscillator(), g=AC.createGain();
  o.type="square"; o.frequency.value=300;
  g.gain.setValueAtTime(0.06,AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+0.09);
  o.connect(g); g.connect(master); o.start(); o.stop(AC.currentTime+0.1);
  return true;
}

/** Lifecycle: the context is suspended when the flight is not running, so a
 *  paused or exited game stops drawing power. */
function resumeAudio(){ try{ if(AC && AC.state==="suspended") AC.resume(); }catch(e){} }
async function suspendAudio(){ try{ if(AC && AC.state==="running") await AC.suspend(); }catch(e){} }

/** A long low rumble for a lightning strike over the city. */
function thunder(){
  if(!AC || muted || !noiseBuf) return;
  const src=AC.createBufferSource(); src.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="lowpass"; f.frequency.value=140;
  const g=AC.createGain();
  g.gain.setValueAtTime(0.001,AC.currentTime);
  g.gain.linearRampToValueAtTime(0.30,AC.currentTime+0.05);
  g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+1.8);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(); src.stop(AC.currentTime+2);
}

// One-shot cache for the hi-hat noise buffer.
let _hatBuf=null;
function hatBuf(){
  if(_hatBuf)return _hatBuf;
  const len=Math.floor(AC.sampleRate*0.05),b=AC.createBuffer(1,len,AC.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len)*(1-i/len);
  _hatBuf=b;return b;
}

export { thunder, obstacleBeep, resumeAudio, suspendAudio, setRain, deathSpiral, fuelBeep, initAudio, audioTick, chime, whoosh, crashSound, setMuted, thud, radioCall, muted };

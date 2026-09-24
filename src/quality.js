// Skylark Run — graphics quality.
//
// Three tiers, from what an integrated laptop GPU runs at a hundred frames a
// second down to what a software rasteriser can survive:
//
//   HIGH    sun shadows at 2048, 4x MSAA in the HDR target, up to 2x pixels
//   MEDIUM  sun shadows at 1024, no MSAA, up to 1.5x pixels
//   LOW     no sun shadows, no MSAA, 1x pixels
//
// The starting tier comes from the renderer: a software rasteriser (a browser
// with its GPU blocklisted, a VM) starts LOW, because the shadow pass alone can
// stall it long enough for the browser to kill the WebGL context. After that
// the tier only ever steps down, and only when frames have run long for a
// sustained stretch of flying — a single hitch on a cell rebuild never counts.
// Stepping back up is left alone: a tier that oscillates is worse than one that
// is slightly conservative.
//
// Systems that depend on the tier subscribe with onChange and are told once
// immediately, so the order modules load in does not matter.
export const TIER={ LOW:0, MEDIUM:1, HIGH:2 };
const NAMES=["LOW","MEDIUM","HIGH"];

/** What each tier means, for the systems that read it. */
export const TIER_SPEC=[
  { shadows:false, shadowRes:0,    msaa:0, maxDpr:1.0 },
  { shadows:true,  shadowRes:1024, msaa:0, maxDpr:1.5 },
  { shadows:true,  shadowRes:2048, msaa:4, maxDpr:2.0 },
];

const WINDOW=90;              // frames per judgement
const SLOW_MS=24;             // a window averaging slower than this counts against the tier
const STRIKES=2;              // consecutive slow windows before stepping down

export const Quality={
  tier:TIER.HIGH,
  software:false,
  listeners:[],
  sum:0, n:0, strikes:0,
  get spec(){ return TIER_SPEC[this.tier]; },
  get name(){ return NAMES[this.tier]; },

  /** Choose the starting tier from what the renderer is running on. */
  detect(gl){
    let desc="";
    try{
      const ext=gl.getExtension("WEBGL_debug_renderer_info");
      desc=ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):"";
    }catch(e){ desc=""; }
    this.software=/swiftshader|llvmpipe|software|basic render/i.test(desc);
    this.tier=this.software?TIER.LOW:TIER.HIGH;
  },
  onChange(fn){ this.listeners.push(fn); fn(this.spec,this.tier); },
  set(tier){
    tier=Math.max(TIER.LOW,Math.min(TIER.HIGH,tier));
    if(tier===this.tier) return;
    this.tier=tier;
    this.sum=0; this.n=0; this.strikes=0;
    for(const fn of this.listeners) fn(this.spec,tier);
  },
  /**
   * Feed one frame's wall time while the aircraft is flying. Frames longer
   * than a quarter second are a tab switch or a stall, not a verdict on the
   * GPU, and are ignored.
   */
  sample(ms){
    if(this.tier===TIER.LOW||ms>250) return;
    this.sum+=ms; this.n++;
    if(this.n<WINDOW) return;
    const avg=this.sum/this.n;
    this.sum=0; this.n=0;
    this.strikes=avg>SLOW_MS?this.strikes+1:0;
    if(this.strikes>=STRIKES) this.set(this.tier-1);
  },
  /** Forget the running average, e.g. after a pause or a sector change. */
  settle(){ this.sum=0; this.n=0; this.strikes=0; }
};

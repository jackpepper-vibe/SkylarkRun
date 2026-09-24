/*
 * Posed captures on the real GPU, for judging the look of the game.
 *
 *   node tools/look.mjs [outDir] [pose ...]
 *   node tools/look.mjs --perf        frame time in the cruise pose, vsync off
 *   PROBE="<js>" node tools/look.mjs --perf
 *                                     ...after running <js> in the page, to price
 *                                     a feature by switching it off (see SKY.gfx)
 *
 * The shared shot tool renders WebGL on SwiftShader, which is slow and not what
 * a player sees. This launches Chromium on the machine's GPU through ANGLE and
 * drives the game through window.SKY into a fixed set of poses, so a change can
 * be compared frame for frame against the previous build. Pass pose names to
 * capture only those.
 */
import path from 'path';
import http from 'http';
import fs from 'fs';
const PLAYWRIGHT = 'file:///C:/Claude/Tools/shot/node_modules/playwright/index.mjs';
const { chromium } = await import(PLAYWRIGHT);

const ROOT = process.cwd();
const PERF = process.argv.includes('--perf');
const args = process.argv.slice(2).filter(a => a !== '--perf');
const OUT = path.resolve(args[0] || 'shots/look');
const ONLY = new Set(PERF ? ['__none__'] : args.slice(1));
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.json':'application/json', '.png':'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/api/scores') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, configured: false, board: [] }));
  }
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/index.html';

const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
         ...(PERF ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text()); });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(url);
await page.waitForTimeout(3000);
console.log('renderer:', await page.evaluate(() => {
  const g = document.createElement('canvas').getContext('webgl2');
  const e = g.getExtension('WEBGL_debug_renderer_info');
  return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));
console.log('graphics tier:', (await page.evaluate(() => window.SKY.quality())).name);

// Advance to the next sector the way the Continue button does, then fly it.
const nextSector = async () => {
  await page.evaluate(() => document.getElementById('contBtn').click());
  await page.waitForTimeout(2200);
};
const flyOn = n => page.evaluate(n => {
  for (let i = 0; i < 60 && window.SKY.state() !== 1; i++) window.SKY.step(30);
  window.SKY.step(n);
}, n);
// Hold a height above the ground under the aircraft.
const holdAgl = agl => page.evaluate(agl => {
  const P = window.SKY.P;
  window.SKY.aimAt(P.x, window.SKY.groundAt(P.x, P.z) + agl);
}, agl);

const POSES = [
  ['menu',     async () => {}],
  ['roll',     async () => page.evaluate(() => { window.SKY.takeoff(); window.SKY.step(60); })],
  ['climb',    async () => page.evaluate(() => { window.SKY.play(); window.SKY.step(90); })],
  ['cruise',   async () => page.evaluate(() => window.SKY.step(300))],
  ['nofx',     async () => page.evaluate(() => window.SKY.fx(false))],
  ['low',      async () => { await page.evaluate(() => { window.SKY.fx(true); window.SKY.step(60); }); await holdAgl(28); }],
  ['approach', async () => page.evaluate(() => { window.SKY.approach(); window.SKY.step(700); })],
  ['s2',       async () => { await nextSector(); await flyOn(250); }],
  ['s3',       async () => { await nextSector(); await flyOn(250); }],
  ['s4',       async () => { await nextSector(); await flyOn(250); }],
  ['s5',       async () => { await nextSector(); await flyOn(250); }],
];

if (PERF) {
  // Fly the cruise pose, then count frames the page actually presents; the
  // simulation is held so every frame renders the same kind of scene.
  await POSES[1][1](); await POSES[2][1](); await POSES[3][1]();
  await page.evaluate(() => window.SKY.hold(true));
  if (process.env.PROBE) await page.evaluate(process.env.PROBE);
  await page.waitForTimeout(1500);
  const ms = await page.evaluate(() => new Promise(done => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
                         else done((performance.now() - t0) / n); };
    requestAnimationFrame(tick);
  }));
  console.log(`cruise: ${ms.toFixed(2)} ms/frame (${(1000 / ms).toFixed(0)} fps) at 1280x720`);
  await browser.close(); server.close(); process.exit(0);
}

for (const [name, pose] of POSES) {
  await pose();
  if (ONLY.size && !ONLY.has(name)) continue;
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot', name);
}
await browser.close();
server.close();

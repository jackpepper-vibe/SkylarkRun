/*
 * Posed captures on the real GPU, for judging the look of the game.
 *
 *   node tools/look.mjs [outDir] [pose ...]
 *   node tools/look.mjs --perf        frame time in the cruise pose, vsync off
 *   PROBE="<js>" node tools/look.mjs --perf
 *                                     ...after running <js> in the page, to price
 *                                     a feature by switching it off (see SKY.gfx)
 *   node tools/look.mjs --aircraft    every aircraft's cockpit: cruising, and
 *                                     on the take-off roll
 *   node tools/look.mjs --sectors     every sector of the tour: at the holding
 *                                     point, cruising, and the destination field
 *                                     from the approach
 *   node tools/look.mjs --perf --aircraft   frame time for every aircraft, in
 *                                     one session, interleaved over two rounds —
 *                                     separate launches drift by several ms as
 *                                     the GPU warms and throttles
 *   AIRCRAFT=<id> node tools/look.mjs ...   fly that aircraft for any of the above
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
const SET_AIRCRAFT = process.argv.includes('--aircraft');
const SET_SECTORS = process.argv.includes('--sectors');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
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
if (process.env.AIRCRAFT) console.log('aircraft:', await page.evaluate(id => window.SKY.setAircraft(id), process.env.AIRCRAFT));

const snap = async name => {
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot', name);
};
// Fly sector n from its holding point until the sector proper is running.
const sectorAirborne = n => page.evaluate(n => {
  const S = window.SKY;
  S.toSector(n);
  for (let i = 0; i < 1500 && S.state() !== 1; i++) S.step(1);
}, n);
// Bring the destination field up, then sit 520 m short of its threshold on a
// steep approach, frozen, so the whole field is in the frame.
const onApproach = () => page.evaluate(() => {
  const S = window.SKY, w = S.world();
  S.G.levelEnd = S.P.dist + 1600;
  for (let i = 0; i < 2000 && !(w.af.active && w.af.phase === 1); i++) S.step(2);
  S.P.x = w.af.x; S.P.z = w.af.z + w.af.len / 2 + 520; S.P.y = w.af.y + 95;
  S.P.vx = 0; S.P.vy = -14; S.P.roll = 0;
  S.step(1); S.hold(true);
});

if (SET_AIRCRAFT && !PERF) {
  const ids = await page.evaluate(() => window.SKY.world().Aircraft.list.map(a => a.id));
  for (const id of ids) {
    await page.evaluate(id => { window.SKY.hold(false); window.SKY.setAircraft(id); window.SKY.takeoff(); window.SKY.step(70); }, id);
    await snap('ac-' + id + '-roll');
    await page.evaluate(() => { window.SKY.play(); window.SKY.step(240); });
    await snap('ac-' + id);
  }
  await page.evaluate(() => window.SKY.hangar());
  await snap('hangar');
  await browser.close(); server.close(); process.exit(0);
}
// Stand off the field's building side, a little above the flight line,
// looking down the length of it: the view that tells one field from another.
const flightLine = () => page.evaluate(() => {
  const S = window.SKY, af = S.world().af, L = S.world().Airfield.built[af.layout].layout;
  S.P.x = af.x + L.side * (af.wid / 2 + 70); S.P.z = af.z + af.len / 2 + 60; S.P.y = af.y + 38;
  S.P.vx = -L.side * 60; S.P.vy = -30; S.P.roll = 0;
  S.hold(true);
});
if (SET_SECTORS && !PERF) {
  for (let n = 1; n <= 5; n++) {
    await page.evaluate(n => { window.SKY.hold(false); window.SKY.toSector(n); window.SKY.hold(true); }, n);
    await snap('s' + n + '-hold');
    await flightLine();
    await snap('s' + n + '-depart');
    await page.evaluate(() => window.SKY.hold(false));
    await sectorAirborne(n);
    await page.evaluate(() => window.SKY.step(260));
    await snap('s' + n + '-cruise');
    await onApproach();
    await snap('s' + n + '-field');
    await flightLine();
    await snap('s' + n + '-arrive');
  }
  await browser.close(); server.close(); process.exit(0);
}

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

const frameTime = secs => page.evaluate(secs => new Promise(done => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
                       else done((performance.now() - t0) / n); };
  requestAnimationFrame(tick);
}), secs);
if (PERF && SET_AIRCRAFT) {
  // Every aircraft in one session, interleaved over two rounds, so a GPU
  // warming up or throttling shows as spread rather than as a difference.
  const ids = await page.evaluate(() => window.SKY.world().Aircraft.list.map(a => a.id));
  const res = Object.fromEntries(ids.map(id => [id, []]));
  for (let round = 0; round < 2; round++) for (const id of ids) {
    await page.evaluate(id => { const S = window.SKY; S.hold(false); S.setAircraft(id); S.play(); S.step(300); S.hold(true); }, id);
    await page.waitForTimeout(1200);
    res[id].push(await frameTime(3));
  }
  for (const id of ids) console.log(`${id.padEnd(10)} ${res[id].map(v => v.toFixed(2)).join('  ')} ms/frame`);
  await browser.close(); server.close(); process.exit(0);
}
if (PERF) {
  // Fly the cruise pose, then count frames the page actually presents; the
  // simulation is held so every frame renders the same kind of scene.
  await POSES[1][1](); await POSES[2][1](); await POSES[3][1]();
  await page.evaluate(() => window.SKY.hold(true));
  if (process.env.PROBE) await page.evaluate(process.env.PROBE);
  await page.waitForTimeout(1500);
  const ms = await frameTime(4);
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

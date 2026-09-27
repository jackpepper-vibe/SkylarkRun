/*
 * Headless smoke test for Skylark Run.
 *
 *   node tools/headless-test.mjs
 *
 * Drives the game through window.SKY without waiting on frames, so the result
 * is deterministic and does not depend on the (software) GPU in headless mode.
 * Checks: no console errors, the ring course scores, and every exit from the
 * approach — greased landing, missed approach, heavy arrival.
 *
 * Playwright lives with the shared screenshot tool rather than in this repo,
 * so it is imported by absolute path.
 */
const PLAYWRIGHT = 'file:///C:/Claude/Tools/shot/node_modules/playwright/index.mjs';
const { chromium } = await import(PLAYWRIGHT);
import path from 'path';
import http from 'http';
import fs from 'fs';

// The game is served over http rather than opened from a file:// path: ES
// modules are blocked by CORS on file://, so once the engine is split into
// modules the page would not load at all. A throwaway static server costs
// nothing and exercises the game the way it is actually served.
const ROOT = process.cwd();
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.css':'text/css', '.json':'application/json', '.png':'image/png',
               '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  // Stand in for the scores endpoint. Answering exactly as a deployment with no
  // DATABASE_URL does keeps Net on its offline path without a failed request in
  // the console, so a real error stays visible among the noise.
  if (rel === '/api/scores') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, configured: false, board: [] }));
    return;
  }
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/index.html';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto(url);
await page.waitForTimeout(2500);

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) failed++;
};

// --- cost of a frame, GPU aside ---
const cpu = await page.evaluate(() => {
  const S = window.SKY;
  S.play(); S.step(30);
  let t0 = performance.now();
  S.step(600, 0.016);
  const upd = (performance.now() - t0) / 600;
  t0 = performance.now();
  for (let i = 0; i < 120; i++) S.drawHUD(performance.now());
  return { update: +upd.toFixed(3), hud: +((performance.now() - t0) / 120).toFixed(3) };
});
check('frame cost under 4 ms', cpu.update + cpu.hud < 4,
  'update ' + cpu.update + ' ms, cockpit ' + cpu.hud + ' ms');

// --- the take-off is a roll, and the clock only starts in the air ---
const takeoff = await page.evaluate(() => {
  const S = window.SKY;
  S.takeoff();
  const z0 = S.P.z;
  let t = 0;
  while (S.state() === 7 && t < 40) { S.step(1, 0.033); t += 0.033; }
  return { s: +t.toFixed(1), roll: Math.round(z0 - S.P.z), fuel: +S.G.fuel.toFixed(1),
           score: Math.floor(S.G.score), dist: Math.round(S.P.dist), state: S.state() };
});
check('take-off is a ground roll, not a jump', takeoff.state === 1 && takeoff.roll > 180 && takeoff.s > 5,
  takeoff.roll + ' m over ' + takeoff.s + ' s');
check('fuel, score and distance only start in the air',
  takeoff.fuel === 100 && takeoff.score === 0 && takeoff.dist === 0,
  'fuel ' + takeoff.fuel + ', score ' + takeoff.score + ', dist ' + takeoff.dist);

// --- the ring course scores ---
const course = await page.evaluate(() => {
  const S = window.SKY;
  S.play();
  for (let i = 0; i < 300; i++) {
    const g = S.world().Rings.nextGate();
    if (g) { S.P.x += (g.x - S.P.x) * 0.35; S.P.y += (g.g.position.y - S.P.y) * 0.35; }
    const r = S.step(6);
    if (r.state !== 1) return r;
  }
  return S.step(0);
});
check('gates register and score', course.score > 2000 && course.rings.split('/')[0] > 5, JSON.stringify(course));

// --- flown onto the numbers ---
const fly = (mode) => page.evaluate((mode) => {
  const S = window.SKY;
  S.approach();
  let touchZ = null, touchT = 0;
  for (let i = 0; i < 4000; i++) {
    const af = S.world().af;
    if (af.active && af.phase === 1) {
      if (mode === 'high') { S.P.y = Math.max(S.P.y, af.y + 160); }
      else {
        S.P.x += (af.x - S.P.x) * 0.3;
        if (mode === 'heavy' && S.P.z - af.z < af.len * 0.5) { S.P.vy = -30; S.P.y -= 3; }
        else if (mode === 'good') {
          const aim = af.z + af.len * 0.5 - 200;
          const want = af.y + Math.max(1, S.P.z - aim) * Math.tan(5 * Math.PI / 180);
          S.P.vy = (want - S.P.y) * 0.9 - 3;
          S.P.y += (want - S.P.y) * 0.3;
        }
      }
    }
    const r = S.step(2);
    if (r.state === 6) {
      if (touchZ === null) { touchZ = S.P.z; touchT = 0; }
      touchT += 0.066;
    }
    if (r.state === 4 || r.state === 3) {
      if (touchZ !== null) r.rollout = { m: Math.round(touchZ - S.P.z), s: +touchT.toFixed(1) };
      return r;
    }
  }
  return { state: -1 };
}, mode);

const good = await fly('good');
check('a flown approach lands and clears', good.state === 4 && /GREASED|GOOD/.test(good.label), JSON.stringify(good));
check('the landing rolls out rather than stopping dead',
  good.rollout && good.rollout.m > 150 && good.rollout.s > 5,
  good.rollout ? good.rollout.m + ' m over ' + good.rollout.s + ' s' : 'no rollout recorded');
const high = await fly('high');
check('staying high forces a go-around', high.state === 4 && /MISSED/.test(high.label), JSON.stringify(high));
const heavy = await fly('heavy');
check('an arrival rather than a landing costs the airframe', heavy.state === 3, JSON.stringify(heavy));

// --- gold gates exist, are worth treble, and sit off the easy line ---
const gold = await page.evaluate(() => {
  const S = window.SKY;
  S.play();
  const seen = [];
  for (let i = 0; i < 3000 && seen.length < 6; i++) {
    for (const r of S.world().Rings.list) {
      if (r.active && r.gold && !seen.some(g => g.n === r.n)) {
        seen.push({ n: r.n, offLine: Math.round(Math.abs(r.x - S.courseX(r.z))),
                    agl: Math.round(r.y - S.groundAt(r.x, r.z)) });
      }
    }
    S.P.y = Math.max(S.P.y, 140);
    S.step(3);
  }
  return seen;
});
check('gold gates appear, low and off the line', gold.length > 0 &&
  gold.every(g => g.agl < 70) && gold.some(g => g.offLine > 60),
  gold.length + ' seen, e.g. ' + JSON.stringify(gold[0] || {}));

// --- every aircraft in the hangar gets off the ground, each in its own way ---
const fleet = await page.evaluate(() => {
  const S = window.SKY, out = {};
  for (const a of S.world().Aircraft.list) {
    S.setAircraft(a.id);
    S.takeoff();
    const z0 = S.P.z;
    let t = 0;
    while (S.state() === 7 && t < 40) { S.step(1, 0.033); t += 0.033; }
    out[a.id] = { airborne: S.state() === 1, roll: Math.round(z0 - S.P.z), lives: S.P.lives,
                  vr: Math.round(S.world().Aircraft.spec.vr) };
  }
  S.setAircraft('sunburst');
  return out;
});
check('every aircraft takes off', Object.values(fleet).every(f => f.airborne), JSON.stringify(fleet));
check('the types really differ: the microlight rolls shortest, the cabin takes a fourth hit',
  fleet.dragonfly.roll < fleet.sunburst.roll && fleet.wayfarer.lives === 4 && fleet.dragonfly.lives === 2,
  'rolls ' + Object.entries(fleet).map(([k, f]) => k + ' ' + f.roll).join(', '));

// --- the tour: every sector its own land, light, hazards and fields ---
const tour = await page.evaluate(() => {
  const S = window.SKY, w = S.world(), out = [];
  for (let n = 1; n <= 6; n++) {
    S.toSector(n);
    const depart = w.af.layout;
    for (let i = 0; i < 1500 && S.state() !== 1; i++) S.step(1);
    S.step(200);
    const kinds = new Set();
    for (const k of ['lines', 'masts', 'turbines', 'balloons', 'flocks'])
      if (w.Haz[k].some(h => h.active)) kinds.add(k);
    out.push({ n, name: w.Tour.cur.name, depart, dest: w.Tour.cur.dest, hazards: [...kinds],
               allowed: w.Tour.cur.hazards, mult: +S.G.mult.toFixed(2), state: S.state() });
  }
  return out;
});
check('each sector flies from the last one\'s field',
  tour.every((s, i) => i === 0 ? s.depart === 'farm' : s.depart === tour[i - 1].dest),
  tour.map(s => s.depart + '→' + s.dest).join('  '));
check('sector 1 is hazard-free, later sectors bring only their own hazards',
  tour[0].hazards.length === 0 && tour.slice(1).every(s => s.hazards.every(h => s.allowed.includes(h))) &&
  tour.slice(1).some(s => s.hazards.length > 0),
  tour.map(s => s.n + ':' + s.hazards.join('/')).join('  '));
check('every point is worth more the further the tour goes', tour.every((s, i) => i === 0 || s.mult > tour[i - 1].mult),
  tour.map(s => s.mult).join(' < '));
check('the tour goes round again, harder', tour[5].name.endsWith(' II') && tour[5].allowed.length === 5, tour[5].name);

// --- flying under the wires counts for the chalk downs' objective ---
const under = await page.evaluate(() => {
  const S = window.SKY, w = S.world();
  S.toSector(2);
  for (let i = 0; i < 1500 && S.state() !== 1; i++) S.step(1);
  for (let i = 0; i < 400 && !w.Haz.lines.some(h => h.active && h.z < S.P.z - 60); i++) S.step(3);
  const line = w.Haz.lines.filter(h => h.active && h.z < S.P.z).sort((a, b) => b.z - a.z)[0];
  if (!line) return { error: 'no power line spawned' };
  // line up mid-span, well under the sag and clear of the ground, and fly through
  S.P.invuln = 0;
  S.P.x = line.x; S.P.z = line.z + 30;
  const g = S.groundAt(line.x, line.z), low = w.Haz.cableY(line, line.x);
  // just under the lowest cable: clear of it, and clear of any woodland canopy below
  const y = low - 9;
  S.P.y = y; S.P.vy = 0; S.P.pz = S.P.z;
  const before = S.G.under, lives = S.P.lives;
  for (let i = 0; i < 60 && S.P.z > line.z - 10; i++) { S.P.y = y; S.P.vy = 0; S.P.x = line.x; S.step(1); }
  return { under: S.G.under - before, lives: S.P.lives - lives, gap: Math.round(low - g) };
});
check('a pass under the power lines is counted', under.under === 1 && under.lives === 0, JSON.stringify(under));

// --- the narrow gravel strip lands too, and the card briefs the next sector ---
const glen = await page.evaluate(() => {
  const S = window.SKY, w = S.world();
  S.toSector(4);
  for (let i = 0; i < 1500 && S.state() !== 1; i++) S.step(1);
  S.G.levelEnd = S.P.dist + 1400;
  for (let i = 0; i < 4000; i++) {
    const af = w.af;
    if (af.active && af.phase === 1) {
      S.P.x += (af.x - S.P.x) * 0.3; S.P.vx = 0; S.P.roll = 0;
      const aim = af.z + af.len * 0.5 - 200;
      const want = af.y + Math.max(1, S.P.z - aim) * Math.tan(5 * Math.PI / 180);
      S.P.vy = (want - S.P.y) * 0.9 - 3;
      S.P.y += (want - S.P.y) * 0.3;
    }
    const r = S.step(2);
    if (r.state === 4 || r.state === 3) break;
  }
  return { state: S.state(), field: w.af.layout, label: S.G.landLabel,
           next: document.getElementById('nextName').textContent,
           stars: document.getElementById('clearStars').textContent,
           button: document.getElementById('contBtn').textContent };
});
check('the glen strip lands and the card briefs sector 5',
  glen.state === 4 && glen.field === 'highland' && /Sector 5/.test(glen.next) && /Evening Vale/.test(glen.button) &&
  glen.stars.length === 3, JSON.stringify(glen));

// --- the logbook survives a reload ---
const storage = await page.evaluate(() => {
  try { window.localStorage.setItem('__t', '1'); window.localStorage.removeItem('__t'); return true; }
  catch (e) { return false; }
});
if (!storage) {
  check('logbook persistence — localStorage reachable', false, 'storage unavailable over http');
} else {
  await page.evaluate(() => {
    window.SKY.Save.submit({ name: 'ZZZ', score: 424242, lvl: 7, rings: 9, chain: 6 });
  });
  await page.reload();
  await page.waitForTimeout(2000);
  const kept = await page.evaluate(() => {
    const b = window.SKY.Save.data.board;
    return { top: b[0] && b[0].name, score: b[0] && b[0].score,
             best: window.SKY.Save.data.bestScore,
             shown: document.getElementById('boardList').textContent.includes('ZZZ') };
  });
  check('the logbook survives a reload', kept.top === 'ZZZ' && kept.score === 424242 && kept.shown,
    JSON.stringify(kept));
  await page.evaluate(() => { try { window.localStorage.removeItem('skylarkRun.v1'); } catch (e) {} });
}

// --- the button a player actually presses ---
// Everything above drives the game through window.SKY, which skips the menu
// entirely. That is how a broken Fly button once shipped: startFlow() assigned
// to an imported binding and threw, and nothing in the suite ever called it.
{
  await page.goto(url);
  await page.waitForTimeout(2000);
  const before = errors.length;
  // the start card leads into the hangar; its Fly button is the one that flies
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => !document.getElementById('hangarOverlay').classList.contains('hidden'),
    null, { timeout: 10000 }).catch(() => {});
  await page.locator('#acList button[data-id="dragonfly"]').click();
  const chosen = await page.evaluate(() => window.SKY.aircraft());
  check('the hangar selects an aircraft', chosen === 'dragonfly', chosen);
  await page.locator('#flyBtn').click();
  // Wait for the sector to start rather than for a fixed time: the software
  // renderer draws a couple of frames a second here, and the start runs on a
  // timer that queues behind them. A broken button never gets there at all.
  await page.waitForFunction(() => window.SKY.state() !== 0, null, { timeout: 20000 }).catch(() => {});
  const flying = await page.evaluate(() => window.SKY.state());
  check('clicking Fly starts a sector', flying !== 0 && errors.length === before,
    'state ' + flying +
    (errors.length > before ? ', errors: ' + errors.slice(before, before + 2).join(' | ') : ''));
}

// --- graphics tier ---
// This suite runs on a software rasteriser, which is exactly the case the
// quality system exists for: the sun's shadow pass alone can stall it until
// shader programs fail. It must start on the lightest tier.
{
  const q = await page.evaluate(() => window.SKY.quality());
  check('a software renderer starts on the LOW graphics tier', q.software && q.tier === 0, JSON.stringify(q));
}

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
await new Promise(r => server.close(r));
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);

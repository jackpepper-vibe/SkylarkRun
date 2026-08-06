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

const url = 'file:///' + path.resolve(process.cwd(), 'index.html').replace(/\\/g, '/');
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
    const g = S.Rings.nextGate();
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
    const af = S.af;
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
    for (const r of S.Rings.list) {
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

// --- the logbook survives a reload ---
const storage = await page.evaluate(() => {
  try { window.localStorage.setItem('__t', '1'); window.localStorage.removeItem('__t'); return true; }
  catch (e) { return false; }
});
if (!storage) {
  console.log('SKIP  logbook persistence   (localStorage unavailable on file://)');
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

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);

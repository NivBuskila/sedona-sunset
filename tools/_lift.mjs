/**
 * The arrival lift, verified by walking rather than by reasoning.
 *
 * Two questions, one boot.
 *
 * 1. Does holding W into the head of the wash actually raise the view, and does
 *    it land near the twelve degrees `head_up` proved reads as an arrival? This
 *    presses a real key through CDP so the lift is driven the only way a player
 *    can drive it. Screenshots at the end are the answer to "how does it feel".
 *
 * 2. Are the capture framings unmoved? The strong form of that question is not
 *    "do they match another build" — it is "can walking move them at all". So
 *    the thirteen framings are read out through walkTo/lookAt *before* any
 *    walking, then again *after* a walk that spends the lift's whole budget,
 *    and the camera matrices must be bit-identical. If they are, the record is
 *    unreachable from the player's controls, which is the actual constraint.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = process.cwd();
const W = 2560, H = 1440;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

const server = createServer((req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

/* The same table shoot.mjs and the number keys use. Kept here literally rather
   than imported because main.js is a module that boots a whole scene. */
const SPOTS = [
  [8, 0, -4], [46, 0, 0], [62, 34, 3], [92, -22, 2], [120, 0, 6],
  [170, 0, 2], [220, 0, 2], [270, 0, 4], [320, 0, 4], [0, 0, 0],
  [200, 62, 10], [330, 0, 14], [330, 176, -2],
];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`${base}/#high`, { waitUntil: 'commit' });
await page.waitForFunction('!!window.__game', null, { timeout: 420000, polling: 500 });
await page.waitForTimeout(2500);

/* The camera's world matrix is the whole framing in sixteen numbers — position,
   orientation and nothing else. Comparing those exactly is a stronger statement
   than comparing pixels, because it cannot be satisfied by a coincidence of
   tone mapping. */
const readSpots = () => page.evaluate(spots => {
  const g = window.__game, out = [];
  for (const [d, yaw, pitch] of spots) {
    g.walkTo(d); g.lookAt(yaw, pitch);
    g._camera.updateMatrixWorld(true);
    out.push(Array.from(g._camera.matrixWorld.elements));
  }
  return out;
}, SPOTS);

const before = await readSpots();

/* ── the walk ─────────────────────────────────────────────────────────── */

await page.evaluate(() => { window.__game.walkTo(280); window.__game.lookAt(0, 0); });
await page.waitForTimeout(300);

const trace = [];
const sample = async () => trace.push(await page.evaluate(() => {
  const g = window.__game, c = g._camera;
  return { s: g._path.atZ(c.position.z, {}).s, pitch: c.rotation.x };
}));
await sample();

/* Hold W. Shift so fifty metres is walked in the time a probe can afford; the
   lift is rate-limited at 5 deg/s and a jog is 4.2 m/s, so the ramp is not
   clipped by the ceiling and the reading is the ramp's, not the limiter's. */
await page.keyboard.down('Shift');
await page.keyboard.down('w');
for (let i = 0; i < 16; i++) { await page.waitForTimeout(900); await sample(); }
await page.keyboard.up('w');
await page.keyboard.up('Shift');
await page.waitForTimeout(600);
await sample();

console.log('\n  holding W from d=280 into the head:');
for (const t of trace) {
  const s = t.s == null ? '   ?' : t.s.toFixed(1).padStart(6);
  const p = t.pitch == null ? '  ?' : (t.pitch * 180 / Math.PI).toFixed(2).padStart(7);
  console.log(`    s=${s} m   pitch ${p}°`);
}

await page.screenshot({ path: 'shots/lift_arrive.png' });
console.log('  → shots/lift_arrive.png  (walked in, view as the lift left it)');

/* And the same place with the lift forced off, for the before/after. */
await page.evaluate(() => { window.__game.walkTo(330); window.__game.lookAt(0, 0); });
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/lift_flat.png' });
console.log('  → shots/lift_flat.png    (same spot at pitch 0, what it used to be)');

/* ── the framings, after the budget has been spent ─────────────────────── */

const after = await readSpots();
let moved = 0;
for (let i = 0; i < before.length; i++) {
  const a = JSON.stringify(before[i]), b = JSON.stringify(after[i]);
  if (a !== b) { moved++; console.log(`  MOVED  spot ${i + 1}\n    ${a}\n    ${b}`); }
}
console.log(`\n  ${before.length} framings re-read after the walk: `
  + `${moved ? `${moved} MOVED` : 'all bit-identical (camera world matrix)'}`);
console.log(`  page errors: ${errs.length}`);

await browser.close();
server.close();
process.exit(moved || errs.length ? 1 : 0);

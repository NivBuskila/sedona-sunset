/**
 * Jump, played rather than reasoned about.
 *
 * The walker simulation already proves the corridor and the landings over the
 * whole route in seven seconds. What it cannot tell me is how it feels, and the
 * two things that decide that are the numbers a body notices: how long you are
 * off the ground, and whether the landing arrives where your eye expects it.
 * So this presses a real Space through CDP at five places chosen because they
 * are the ones a player will actually try — flat wash, off a cut bank, up the
 * talus, at the head where the ground is steepest, and at a sprint — and samples
 * the camera height at frame rate through each arc.
 *
 * It also re-reads the thirteen capture framings before and after, exactly as
 * tools/_lift.mjs does for the pitch budget, because jump adds a branch to the
 * integrator and the record has to be provably unreachable from the keyboard.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = process.cwd();
const W = 2560, H = 1440;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

const server = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = join(ROOT, u === '/' ? 'index.html' : u);
  if (!existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const SPOTS = [
  [8, 0, -4], [46, 0, 0], [62, 34, 3], [92, -22, 2], [120, 0, 6],
  [170, 0, 2], [220, 0, 2], [270, 0, 4], [320, 0, 4], [0, 0, 0],
  [200, 62, 10], [330, 0, 14], [330, 176, -2],
];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`${base}/#high`, { waitUntil: 'commit' });

/* Race the boot against the error list rather than waiting it out. The gate
   learned this the hard way — a page that throws in a module still leaves
   `__game` undefined, so a bare waitForFunction sits for its whole timeout and
   then reports a timeout instead of the exception that caused it. Seven minutes
   of silence to be told the wrong thing. The newer tool did not inherit the fix
   until it wasted four minutes the same way. */
await Promise.race([
  page.waitForFunction('!!window.__game', null, { timeout: 420000, polling: 500 }),
  (async () => {
    while (!errs.length) await page.waitForTimeout(250);
    throw new Error(`page failed during boot:\n    ${errs.join('\n    ')}`);
  })(),
]);
await page.waitForTimeout(2500);

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

/* Sampling the camera rather than the player, because the camera is what the eye
   is attached to and it carries the head bob as well as the arc — but sampling
   its height *above the ground beneath it*, not above where the jump started.
 *
 * The first version of this tool recorded absolute height and called the walker
 * airborne whenever it was above its starting height. That measures the terrain:
 * walk uphill and you stay "in the air" indefinitely, which is how it reported
 * 1.9 s airtimes at the talus and the wash head against a design value of 0.61,
 * and a 34 m/s fall speed that was one long frame across a step in the ground.
 * Absolute height was the wrong window for a question about clearance — the same
 * shape of error as the banded means recorded in CONTRACT.md, made by the same
 * person a few hours later. */
const startTrace = () => page.evaluate(() => {
  window.__jt = [];
  const t0 = performance.now();
  const tick = () => {
    const g = window.__game, p = g._player;
    const q = g._path.atZ(p.z, {});
    const gnd = g._terrain.heightAtQ(p.x, p.z, q);
    window.__jt.push([performance.now() - t0, p.y - gnd, p.air ? 1 : 0, p.vy]);
    if (window.__jtOn) requestAnimationFrame(tick);
  };
  window.__jtOn = true; requestAnimationFrame(tick);
});
const stopTrace = () => page.evaluate(() => { window.__jtOn = false; return window.__jt; });

const STATIONS = [
  { name: 'flat wash',        d: 46,  yaw: 0,  hold: null,    walk: false },
  { name: 'walking, flat',    d: 46,  yaw: 0,  hold: null,    walk: true  },
  { name: 'off the cut bank', d: 140, yaw: 62, hold: null,    walk: true  },
  { name: 'up the talus',     d: 300, yaw: 40, hold: null,    walk: true  },
  { name: 'at the wash head', d: 329, yaw: 0,  hold: null,    walk: true  },
  { name: 'sprinting',        d: 120, yaw: 0,  hold: 'Shift', walk: true  },
  /* Turbo is the 12 m/s cheat, so a 0.6 s arc carries seven metres. The walker
     simulation proves the corridor holds at this speed; this is here for how far
     it throws you and whether the landing survives arriving that fast. */
  { name: 'turbo',            d: 170, yaw: 0,  hold: 'Turbo', walk: true  },
];

console.log(`\n  jump: g 9.81, apex 0.45 m by construction — measured at ${W}x${H}\n`);
console.log('  station            ground→apex   airtime   land Δ    peak fall speed');

const rows = [];
for (const st of STATIONS) {
  await page.evaluate(([d, yaw]) => { window.__game.walkTo(d); window.__game.lookAt(yaw, 0); },
    [st.d, st.yaw]);
  await page.waitForTimeout(400);
  const y0 = await page.evaluate(() => window.__game._camera.position.y);

  await startTrace();
  const holds = st.hold === 'Turbo' ? ['Shift', 'Control'] : st.hold ? [st.hold] : [];
  for (const h of holds) await page.keyboard.down(h);
  if (st.walk) { await page.keyboard.down('w'); await page.waitForTimeout(500); }
  await page.keyboard.down('Space');
  await page.waitForTimeout(90);
  await page.keyboard.up('Space');
  await page.waitForTimeout(1400);
  if (st.walk) await page.keyboard.up('w');
  for (const h of holds) await page.keyboard.up(h);
  const tr = await stopTrace();

  /* Airborne is read off the player's own flag, and the apex and the fall speed
     are measured only over the frames it is set. Nothing here infers state from
     a height, which is what went wrong twice. */
  const air = tr.filter(s => s[2] === 1);
  const apex = air.length ? Math.max(...air.map(s => s[1])) : 0;
  const rise = apex;
  let up = null, down = null;
  for (const s of tr) if (s[2] === 1) { if (up === null) up = s[0]; down = s[0]; }
  const airtime = (up !== null) ? (down - up) / 1000 : 0;
  const vmax = air.length ? -Math.min(...air.map(s => s[3])) : 0;
  const landed = await page.evaluate(() => {
    const g = window.__game, p = g._player;
    const q = g._path.atZ(p.z, {});
    return p.y - g._terrain.heightAtQ(p.x, p.z, q);
  });
  rows.push({ st, rise, airtime, landed, vmax });
  console.log(`  ${st.name.padEnd(18)} ${rise.toFixed(3).padStart(8)} m ${airtime.toFixed(2).padStart(8)} s`
    + ` ${landed.toFixed(4).padStart(9)} ${vmax.toFixed(2).padStart(12)} m/s`);
}

/* One frame at the top of a jump, and one just after landing, to look at. */
await page.evaluate(() => { window.__game.walkTo(300); window.__game.lookAt(40, 0); });
await page.waitForTimeout(400);
await page.keyboard.down('w'); await page.waitForTimeout(400);
await page.keyboard.down('Space'); await page.waitForTimeout(80); await page.keyboard.up('Space');
await page.waitForTimeout(290);
await page.screenshot({ path: 'shots/jump_apex.png' });
await page.keyboard.up('w');
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/jump_land.png' });
console.log('\n  → shots/jump_apex.png, shots/jump_land.png');

/* Held Space must give exactly one jump, not a pogo stick. */
await page.evaluate(() => { window.__game.walkTo(46); window.__game.lookAt(0, 0); });
await page.waitForTimeout(400);
await startTrace();
await page.keyboard.down('Space');
await page.waitForTimeout(3000);
await page.keyboard.up('Space');
await page.waitForTimeout(400);
const held = await stopTrace();
{
  let peaks = 0, upNow = false;
  for (const s of held) {
    if (!upNow && s[2] === 1) { upNow = true; peaks++; }
    if (upNow && s[2] === 0) upNow = false;
  }
  console.log(`  holding Space for three seconds: ${peaks} jump${peaks === 1 ? '' : 's'}`
    + (peaks === 1 ? '' : '   ← should be 1'));
  if (peaks !== 1) errs.push(`held Space produced ${peaks} jumps`);
}

const after = await readSpots();
let moved = 0;
for (let i = 0; i < before.length; i++) {
  if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) {
    moved++; console.log(`  MOVED  spot ${i + 1}`);
  }
}
console.log(`\n  ${before.length} framings re-read after jumping: `
  + `${moved ? `${moved} MOVED` : 'all bit-identical (camera world matrix)'}`);
console.log(`  page errors: ${errs.length}${errs.length ? '\n    ' + errs.join('\n    ') : ''}`);

await browser.close();
server.close();
process.exit(moved || errs.length ? 1 : 0);

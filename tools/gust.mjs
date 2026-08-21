/* Photograph the blowing sand, on purpose.
 *
 *   node tools/gust.mjs <tag> [--w 1600] [--h 900]
 *
 * The desert stillness is the feature, so the eight standard viewpoints land on
 * a deterministic weather window in which the bed is mostly static — and a
 * critic reviewing eight stills correctly said saltation had shipped with no
 * evidence, because by construction there was nothing in them to see. This
 * parks the atmosphere on the hardest-blowing moment of that same window and
 * captures it, as an extra frame beside the set rather than by loosening the
 * threshold that keeps the set still.
 *
 * It also measures the result rather than asserting it. The reference for a
 * blowing-sand layer is a translucent carpet: flux peaking two to five
 * centimetres up, ninety percent of grains below sixty-four, thinning
 * imperceptibly upward, and no resolvable individual grains. So the sand is
 * captured twice, visible and hidden, and the difference is profiled by height
 * above the wash floor in centimetres — using the frame's own geometry, not a
 * screen-row proxy — and by how large a single grain's footprint is.
 */
import { run, capture } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const tag = process.argv[2] || 'gust';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : Number(process.argv[i + 1]); };
const W = arg('--w', 1600), H = arg('--h', 900);

/* Low and close, looking down the wash into the wind, which is where a carpet
   of grains is legible at all. The second is the standard sun_gap so the gust
   can be seen backlit. */
const VIEWS = [
  ['gust', 14, 8, -7],
  ['gust_sun', 120, 0, 2],
];

await run({ width: W, height: H, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 600_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  for (const [name, d, yaw, pitch] of VIEWS) {
    const st = await page.evaluate(([dd, y, p]) => {
      const g = window.__game;
      g.walkTo(dd); g.lookAt(y, p);
      const s = g._atmo.setGustPeak();
      const cam = g._camera;
      return {
        ...s,
        cam: cam.position.toArray(),
        fov: cam.fov,
        h: cam.position.y,
      };
    }, [d, yaw, pitch]);
    console.log(`${name}  sal ${st.sal.toFixed(3)}  gust ${st.gust.toFixed(3)}  ` +
      `speed ${st.speed.toFixed(2)}  dir ${st.dir.map((v) => v.toFixed(2))}  t ${st.t.toFixed(2)}`);
    await capture(page, `shots/${tag}_${name}.png`);
    await page.evaluate(() => {
      const s = window.__game._scene;
      s.getObjectByName('saltation').visible = false;
      s.getObjectByName('saltation_far').visible = false;
    });
    await capture(page, `shots/_gust_${name}_off.png`);
    await page.evaluate(() => {
      const s = window.__game._scene;
      s.getObjectByName('saltation').visible = true;
      s.getObjectByName('saltation_far').visible = true;
    });
    /* Eye height above the local floor, for the row-to-metres conversion. */
    globalThis.__geom = globalThis.__geom || {};
    globalThis.__geom[name] = st;
  }
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 4).join('\n'));
});

const lum = (img, i) => 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];

for (const [name, , , pitch] of VIEWS) {
  const on = decode(readFileSync(`shots/${tag}_${name}.png`));
  const off = decode(readFileSync(`shots/_gust_${name}_off.png`));
  const geom = globalThis.__geom[name];
  const EYE = 1.65;
  /* Vertical radians per pixel, from the frame's own field of view. */
  const fy = 2 * Math.tan((geom.fov * Math.PI) / 360) / on.h;

  /* Each changed pixel is a grain sprite somewhere on the floor. Its height
     above the floor follows from where it sits relative to the horizon of the
     floor plane: a pixel `dy` above the floor's vanishing row, at ground range
     `r`, is `r * dy * fy` metres up. Range comes from the same geometry — the
     floor is flat and the eye height is known, so a pixel `db` below the
     horizon looks down at `EYE / (db * fy)` metres. */
  const horizon = on.h / 2 - (pitch * Math.PI / 180) / fy;

  /* How much of the frame the sand touched, and how wide a single grain reads.
     A run of changed pixels along a row is one grain's footprint; if that mean
     is more than a couple of pixels the grains are resolvable discs and the
     carpet has become a scatter of confetti. */
  let changed = 0, total = 0, sum = 0;
  const runs = [];
  for (let y = 0; y < on.h; y++) {
    let run = 0;
    for (let x = 0; x < on.w; x++) {
      const i = (y * on.w + x) * on.ch;
      const dd = lum(on, i) - lum(off, i);
      total++;
      if (Math.abs(dd) < 1.0) { if (run) { runs.push(run); run = 0; } continue; }
      changed++; sum += dd; run++;
    }
    if (run) runs.push(run);
  }

  /* Height profile. For each column find the lowest changed pixel — the bed —
     and measure every other changed pixel in that column as a height above it,
     converted through that column's own range. */
  const bins = new Float64Array(40);      // 0..2 m in 5 cm bins
  let measured = 0;
  for (let x = 0; x < on.w; x++) {
    let bed = -1;
    for (let y = on.h - 1; y >= 0; y--) {
      const i = (y * on.w + x) * on.ch;
      if (Math.abs(lum(on, i) - lum(off, i)) >= 1.0) { bed = y; break; }
    }
    if (bed < 0) continue;
    const db = bed - horizon;
    if (db <= 2) continue;
    const r = EYE / (db * fy);
    if (r < 1 || r > 60) continue;
    for (let y = bed; y >= 0; y--) {
      const i = (y * on.w + x) * on.ch;
      if (Math.abs(lum(on, i) - lum(off, i)) < 1.0) continue;
      const hm = (bed - y) * fy * r;
      const k = Math.floor(hm / 0.05);
      if (k >= 0 && k < bins.length) { bins[k]++; measured++; }
    }
  }

  let cum = 0; const q = {};
  for (let k = 0; k < bins.length; k++) {
    cum += bins[k];
    for (const p of [0.5, 0.75, 0.9, 0.99]) if (q[p] === undefined && cum / measured >= p) q[p] = (k + 1) * 5;
  }
  let mode = 0; for (let k = 0; k < bins.length; k++) if (bins[k] > bins[mode]) mode = k;
  const meanRun = runs.length ? runs.reduce((s, v) => s + v, 0) / runs.length : 0;

  console.log(`\n${tag}_${name}   ${on.w}x${on.h}   horizon row ${horizon.toFixed(0)}`);
  console.log(`  pixels touched      ${(100 * changed / total).toFixed(3)}%   mean signed delta ` +
    `${(sum / Math.max(1, changed)).toFixed(2)}`);
  console.log(`  grain footprint     mean horizontal run ${meanRun.toFixed(2)} px`);
  console.log(`  height above bed    mode ${(mode * 5 + 2.5).toFixed(0)} cm   p50 ${q[0.5]} cm   ` +
    `p75 ${q[0.75]} cm   p90 ${q[0.9]} cm   p99 ${q[0.99]} cm   (n=${measured})`);
  console.log('  profile, 5cm bins   ' + Array.from(bins.slice(0, 16))
    .map((v) => (100 * v / Math.max(1, measured)).toFixed(0).padStart(3)).join(''));
}

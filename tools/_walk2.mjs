/* The second walkthrough. One page load, the whole route, and a number for the
 * thing I could only describe by eye the first time.
 *
 *   node tools/_walk2.mjs [tag]
 *
 * The first walkthrough produced two complaints that no capture in this project
 * could confirm, because five of the eight canonical framings sit at 46 m or
 * nearer and none of them was walked *between*: the last forty metres, and the
 * mid distance going waxy from about 200 m while the near field stayed sharp.
 * This walks the route at twenty-metre stations, closes to six metres over the
 * last forty, and at every station records both what the frame looks like and a
 * banded local-contrast profile — so "waxy" stops being an adjective.
 *
 * ── the detail metric ─────────────────────────────────────────────────────
 *
 * Waxy means high-frequency detail is gone while the large-scale shading stays,
 * so the measure is mean |Laplacian| over a band divided by that band's mean
 * luminance. Dividing matters: haze legitimately lowers *absolute* contrast with
 * distance, and an absolute figure would call correct aerial perspective a
 * defect. A relative figure asks the sharper question — given how bright this
 * part of the picture is, how much texture is left in it.
 *
 * The bands are horizontal and referenced to the horizon, which at pitch 0 sits
 * at the vertical centre. This matters for reading the result. With an eye at
 * 1.65 m the ground at 20 m is about 85 px below the horizon in a 900-row frame
 * and the ground at 200 m is about 8: the far *floor* is a sliver at the
 * centre-line, and almost everything a viewer reads as "the mid distance" is
 * canyon wall at or above the horizon. So `nearGnd` is the floor under your
 * feet, `midGnd` the floor out to some tens of metres, `farGnd` the compressed
 * floor beyond that, and `wall` the rock faces — which is the band the
 * complaint was actually about.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, capture } from './harness.mjs';
import { settle } from './settle.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] || 'w2';
const W = 1600, H = 900;

/* Forward down the wash every twenty metres, then every six over the last
   forty, which is the stretch the first walkthrough called the worst of it and
   which no capture had ever visited. Plus the four framings I photographed
   before the light changes landed, at the same size, so there is a genuine
   before and after rather than a memory of one. */
const strip = [];
for (let d = 0; d <= 280; d += 20) strip.push({ name: `f${String(d).padStart(3, '0')}`, d, yaw: 0, pitch: 0 });
for (let d = 292; d <= 334; d += 6) strip.push({ name: `f${String(d).padStart(3, '0')}`, d, yaw: 0, pitch: 0 });
const extra = [
  /* The 200 m complaint, from three bearings, because "mid distance" depends on
     what is in the mid distance and a single forward look can be answered by
     one wall. */
  { name: 'm200_fwd',  d: 200, yaw: 0,    pitch: 2 },
  { name: 'm200_wall', d: 200, yaw: 62,   pitch: 10 },
  { name: 'm200_back', d: 200, yaw: 178,  pitch: 0 },
  /* The head of the wash, looked at rather than passed through. */
  { name: 'head_up',   d: 330, yaw: 0,    pitch: 14 },
  { name: 'head_back', d: 330, yaw: 176,  pitch: -2 },
  /* Rephotographs of the pre-change set, for the before/after. */
  { name: 'r_wash_low', d: 8,   yaw: 0,    pitch: -4 },
  { name: 'r_wash_mid', d: 46,  yaw: 0,    pitch: 0 },
  { name: 'r_bend',     d: 92,  yaw: -22,  pitch: 2 },
  { name: 'r_sun_gap',  d: 120, yaw: 0,    pitch: 6 },
];
const STATIONS = [...strip, ...extra];

const MEASURE = () => {
  const g = window.__game;
  g.setPaused(true);
  g.renderOnce();
  const gl = g.renderer.getContext();
  const cv = g.renderer.domElement;
  const w = cv.width, h = cv.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; j < w * h; i += 4, j++) {
    L[j] = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
  }
  /* readPixels is bottom-up: row 0 is the bottom of the screen, and the horizon
     at pitch 0 is row h/2. Bands are given as fractions of frame height from the
     bottom. */
  const bands = {
    nearGnd: [0.00, 0.22],
    midGnd:  [0.22, 0.42],
    farGnd:  [0.42, 0.50],
    wall:    [0.50, 0.72],
  };
  const detail = {}, lum = {};
  for (const k in bands) {
    const y0 = Math.max(1, Math.round(bands[k][0] * h));
    const y1 = Math.min(h - 1, Math.round(bands[k][1] * h));
    let lap = 0, mean = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = L[i];
        lap += Math.abs(4 * v - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]);
        mean += v; n++;
      }
    }
    lum[k] = n ? mean / n : NaN;
    detail[k] = n && mean > 0 ? (lap / n) / (mean / n) : NaN;
  }

  const probe = g.probe();
  const info = g.info();
  g.setPaused(false);
  return { w, h, detail, lum, probe, triangles: info.triangles, calls: info.calls };
};

/* ── the corridor, before the browser is touched ───────────────────────────
 *
 * Re-read rather than remembered, because an indirect-light pass and cliff work
 * have moved the height field the corridor is derived from and the limit is a
 * function of that field. This is the same import the game uses, against the
 * same terrain, so the numbers are the ones the player is held by. */
{
  const { WashPath } = await import('../src/path.js');
  const { Terrain } = await import('../src/terrain.js');
  const { buildCorridor, corridorAt } = await import('../src/corridor.js');
  const p = new WashPath(), t = new Terrain(p), c = buildCorridor(p, t);
  let minL = Infinity, minR = Infinity, atL = 0, atR = 0, sum = 0, n = 0;
  for (let s = 0; s <= c.sMax; s += 1) {
    const l = corridorAt(c, s, -1), r = corridorAt(c, s, 1);
    if (!Number.isFinite(l) || !Number.isFinite(r)) {
      console.error(`_walk2: corridor is non-finite at s=${s} — refusing to report.`);
      process.exit(2);
    }
    if (l < minL) { minL = l; atL = s; }
    if (r < minR) { minR = r; atR = s; }
    sum += l + r; n += 2;
  }
  if (!n) { console.error('_walk2: corridor table is empty.'); process.exit(2); }
  console.log(`\ncorridor, re-derived from the current height field:\n` +
    `  ${c.n} samples over s ${c.sMin} to ${c.sMax.toFixed(1)} m\n` +
    `  narrowest left  ${minL.toFixed(1)} m at s=${atL}\n` +
    `  narrowest right ${minR.toFixed(1)} m at s=${atR}\n` +
    `  mean half-width ${(sum / n).toFixed(1)} m`);
}

const rows = [];
await run({ width: W, height: H, waitReady: false, hash: 'high' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.evaluate(() => new Promise((r) => {
    let n = 0; const t = () => (++n < 180 ? requestAnimationFrame(t) : r());
    requestAnimationFrame(t);
  }));

  console.log(`\n  station     d   sky    gnd  |  detail: nearGnd  midGnd  farGnd    wall  |  lum wall  tris`);
  for (const v of STATIONS) {
    await page.evaluate(([d, y, p]) => {
      window.__game.walkTo(d); window.__game.lookAt(y, p);
    }, [v.d, v.yaw, v.pitch]);
    await settle(page, { minFrames: 60, maxMs: 9000 });
    const m = await page.evaluate(MEASURE);
    await capture(page, path.join(DIR, 'shots', `${tag}_${v.name}.png`));
    m.name = v.name; m.d = v.d; m.yaw = v.yaw; m.pitch = v.pitch;
    rows.push(m);
    const dd = m.detail;
    console.log(`  ${v.name.padEnd(11)} ${String(v.d).padStart(3)} ` +
      `${m.probe.skyAvg.toFixed(1).padStart(6)} ${m.probe.groundAvg.toFixed(1).padStart(6)}  |  ` +
      `${dd.nearGnd.toFixed(4).padStart(13)} ${dd.midGnd.toFixed(4).padStart(7)} ` +
      `${dd.farGnd.toFixed(4).padStart(7)} ${dd.wall.toFixed(4).padStart(7)}  |  ` +
      `${m.lum.wall.toFixed(1).padStart(8)} ${(m.triangles / 1000).toFixed(0).padStart(5)}k`);
  }
  fs.writeFileSync(path.join(DIR, 'shots', `${tag}.json`),
    JSON.stringify({ tag, w: W, h: H, errs: [...new Set(errs)], rows }, null, 2) + '\n');
  if (errs.length) console.log(`\n  !! ${errs.length} page error(s): ${[...new Set(errs)].slice(0, 4).join(' | ')}`);
});

if (!rows.length) { console.error('\n_walk2: no station measured — nothing to report.'); process.exit(2); }

/* The detail profile along the route, which is the whole reason for this tool.
   If the mid distance is waxy while the near field stays sharp, the `wall` band
   falls away with station while `nearGnd` holds, and the ratio between the two
   is the shape of the complaint rather than a description of it. */
console.log('\n  wall detail against near-ground detail, along the strip:');
for (const r of rows.filter((x) => /^f\d/.test(x.name))) {
  const ratio = r.detail.wall / r.detail.nearGnd;
  console.log(`  ${String(r.d).padStart(3)} m  ${ratio.toFixed(3)}  ` +
    '#'.repeat(Math.max(0, Math.round(ratio * 50))));
}

console.log(`\n  ${rows.length} stations, shots/${tag}_*.png\n`);

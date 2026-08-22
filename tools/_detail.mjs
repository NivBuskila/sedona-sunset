/* Banded local contrast off a PNG, for putting a number on "waxy".
 *
 *   node tools/_detail.mjs a.png b.png ...
 *
 * The first walkthrough's second complaint was that the mid distance goes waxy
 * from about 200 m while the near field stays sharp. Waxy means the
 * high-frequency detail is gone while the large-scale shading survives, so the
 * measure is mean |Laplacian| over a band divided by that band's mean
 * luminance.
 *
 * **The division is the whole point.** Haze legitimately lowers absolute
 * contrast with distance, so an absolute figure would report correct aerial
 * perspective as a defect and there would be no way to tell the two apart. The
 * relative figure asks the useful question instead: given how bright this part
 * of the picture is, how much texture is left in it.
 *
 * This reads PNGs rather than the framebuffer so that a capture taken before a
 * change and one taken after go through identical code — including the row
 * order, which is top-down in a PNG and bottom-up out of `readPixels`, and is
 * exactly the kind of asymmetry that makes a before-and-after mean nothing.
 */
import fs from 'node:fs';
import { decode } from './png.mjs';

/* Fractions of frame height from the *top*, for a pitch-0 framing where the
   horizon sits at 0.50. `wall` is the band the complaint is about: with an eye
   at 1.65 m the ground at 200 m lands within about ten rows of the horizon, so
   almost everything a viewer reads as "the mid distance" is canyon wall at or
   just above the centre line, not floor. */
const BANDS = {
  sky:     [0.10, 0.28],
  wall:    [0.28, 0.50],
  farGnd:  [0.50, 0.58],
  midGnd:  [0.58, 0.78],
  nearGnd: [0.78, 1.00],
};

/* Windows on the wash floor alone, for a pitch-0 forward framing.
 *
 * The horizontal bands above turned out to be the wrong shape for the actual
 * complaint, and the way they were wrong is worth keeping. At 200 m the banded
 * numbers say the mid distance is as detailed as the near field — 0.37 against
 * 0.36 — and the frame plainly shows a near field full of pebbles and flakes
 * giving way to smooth featureless mounds from about sixty metres out. The bands
 * are innocent: at pitch 0 the band that contains the mid-distance floor also
 * contains the cut banks, the stratified walls and the rim vegetation, all of
 * which are full of contrast, and they outvote the floor.
 *
 * **A band wide enough to be robust is wide enough to average away the thing you
 * are asking about.** These windows are narrow and centred so they see only
 * channel floor, at three depths, and the near-to-mid drop between them is the
 * complaint expressed as a ratio rather than as an adjective. Fractions are of
 * width and height from the top-left. */
const FLOOR_WIN = {
  nearFloor: [0.32, 0.86, 0.68, 0.99],
  midFloor:  [0.40, 0.62, 0.60, 0.72],
  farFloor:  [0.44, 0.54, 0.56, 0.60],
};

export function window_(file, win) {
  const { w, h, ch, px } = decode(fs.readFileSync(file));
  const L = new Float32Array(w * h);
  for (let j = 0; j < w * h; j++) {
    const i = j * ch;
    L[j] = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
  }
  const out = {};
  for (const k in win) {
    const [fx0, fy0, fx1, fy1] = win[k];
    const x0 = Math.max(1, Math.round(fx0 * w)), x1 = Math.min(w - 1, Math.round(fx1 * w));
    const y0 = Math.max(1, Math.round(fy0 * h)), y1 = Math.min(h - 1, Math.round(fy1 * h));
    let lap = 0, sum = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]);
        sum += L[i]; n++;
      }
    }
    if (n < 500) { console.error(`_detail: window ${k} of ${file} holds ${n} pixels.`); process.exit(2); }
    out[k] = { lum: sum / n, rel: (lap / n) / Math.max(1e-6, sum / n), n };
  }
  return out;
}

export function detail(file) {
  const { w, h, ch, px } = decode(fs.readFileSync(file));
  const L = new Float32Array(w * h);
  for (let j = 0; j < w * h; j++) {
    const i = j * ch;
    L[j] = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
  }
  const out = { w, h, bands: {} };
  for (const k in BANDS) {
    const y0 = Math.max(1, Math.round(BANDS[k][0] * h));
    const y1 = Math.min(h - 1, Math.round(BANDS[k][1] * h));
    let lap = 0, sum = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]);
        sum += L[i]; n++;
      }
    }
    if (!n) { console.error(`_detail: band ${k} of ${file} covers no rows.`); process.exit(2); }
    out.bands[k] = { lum: sum / n, rel: (lap / n) / Math.max(1e-6, sum / n), n };
  }
  return out;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1].endsWith('_detail.mjs')) {
  const argv = process.argv.slice(2);
  const FLOOR = argv.includes('--floor');
  const files = argv.filter((a) => a !== '--floor');
  if (!files.length) { console.error('usage: node tools/_detail.mjs [--floor] a.png [b.png ...]'); process.exit(2); }
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) { console.error(`_detail: no such file: ${missing.join(', ')}`); process.exit(2); }

  if (FLOOR) {
    const keys = Object.keys(FLOOR_WIN);
    console.log('\n  channel floor only — relative local contrast, and the near-to-mid drop\n');
    console.log(`  ${'file'.padEnd(30)}${keys.map((k) => k.padStart(11)).join('')}   mid/near   far/near`);
    for (const f of files) {
      const d = window_(f, FLOOR_WIN);
      console.log(`  ${f.replace(/^.*[\\/]/, '').padEnd(30)}` +
        keys.map((k) => d[k].rel.toFixed(4).padStart(11)).join('') +
        `   ${(d.midFloor.rel / d.nearFloor.rel).toFixed(3).padStart(8)}` +
        `   ${(d.farFloor.rel / d.nearFloor.rel).toFixed(3).padStart(8)}`);
    }
    console.log('');
    process.exit(0);
  }

  const keys = Object.keys(BANDS);
  console.log(`\n  relative local contrast — mean |laplacian| / mean luminance\n`);
  console.log(`  ${'file'.padEnd(34)}${keys.map((k) => k.padStart(9)).join('')}`);
  const rows = [];
  for (const f of files) {
    const d = detail(f);
    rows.push({ f, d });
    console.log(`  ${f.replace(/^.*[\\/]/, '').padEnd(34)}` +
      keys.map((k) => d.bands[k].rel.toFixed(4).padStart(9)).join(''));
  }
  console.log(`\n  band luminance\n`);
  console.log(`  ${'file'.padEnd(34)}${keys.map((k) => k.padStart(9)).join('')}`);
  for (const { f, d } of rows) {
    console.log(`  ${f.replace(/^.*[\\/]/, '').padEnd(34)}` +
      keys.map((k) => d.bands[k].lum.toFixed(1).padStart(9)).join(''));
  }
  console.log('');
}

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
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node tools/_detail.mjs a.png [b.png ...]'); process.exit(2); }
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) { console.error(`_detail: no such file: ${missing.join(', ')}`); process.exit(2); }

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

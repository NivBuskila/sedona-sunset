/* What does raising the level actually do to the three figures that fight?
 *
 *   node tools/expose.mjs shots/sys4i_np_wall_shade.png shots/sys4i_np_wall_lit.png
 *
 * Same trick as tools/_p7toe.mjs, one stage earlier in the chain: an ungraded
 * capture is inverted through the exact ACES curve back to scene-linear, the level
 * is changed there, and the frame is re-encoded. Valid because these two windows
 * are the ones System 7 established are luminance-neutral under everything in the
 * grade except the curve itself, and because tools/tone.mjs's inverse is analytic
 * rather than fitted — it round-trips to 0.000 saturation and 0.1 degrees of hue.
 *
 * Two levers, and they are not the same lever:
 *
 *   exposure   scales everything, which is renderer.toneMappingExposure
 *   sun        scales only the direct term, which is the sun's own irradiance
 *
 * The distinction is the whole point. The gate is shaded-over-sunlit, so a global
 * exposure change moves the numerator and the denominator together and only the
 * curve's changing slope decides which way the ratio goes. Raising the sun alone
 * moves the denominator only. The direct term is recovered as (sunlit - shaded)
 * per channel, which holds here because both windows are wall faces of the same
 * material at similar orientation, so the shaded one is a direct measurement of
 * what the sunlit one receives besides sun.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';
import { forward, inverse } from './tone.mjs';

const [shadeFile, litFile] = process.argv.slice(2);
if (!litFile) {
  console.error('usage: node tools/expose.mjs <wall_shade png> <wall_lit png>');
  process.exit(1);
}

const GATE = [0.30, 0.24, 0.34, 0.34];   // the flat-face window, both views
const EXPOSURE = 1.15;                    // what the capture was taken at

const crop = (file, r) => {
  const { w, h, ch, px } = decode(readFileSync(file));
  const out = [];
  for (let y = Math.round(r[1] * h); y < Math.round((r[1] + r[3]) * h); y++)
    for (let x = Math.round(r[0] * w); x < Math.round((r[0] + r[2]) * w); x++) {
      const i = (y * w + x) * ch;
      out.push(inverse([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], EXPOSURE));
    }
  return out;
};

const shade = crop(shadeFile, GATE);
const lit = crop(litFile, GATE);

const LUM = [0.2126, 0.7152, 0.0722];
const relLum = (c) => c[0] * LUM[0] + c[1] * LUM[1] + c[2] * LUM[2];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/* The direct term, per pixel rank. The two crops are different pixels, so pair
   them by sorted luminance rather than by position — what is wanted is the
   population's direct component, not a per-pixel one. */
const sortedS = shade.slice().sort((a, b) => relLum(a) - relLum(b));
const sortedL = lit.slice().sort((a, b) => relLum(a) - relLum(b));
const direct = sortedL.map((c, i) => {
  const s = sortedS[Math.min(sortedS.length - 1, Math.round(i * sortedS.length / sortedL.length))];
  return [0, 1, 2].map((k) => Math.max(0, c[k] - s[k]));
});

const encode = (lin, e) => forward(lin, e);
const V = (rgb) => Math.max(rgb[0], rgb[1], rgb[2]);
const sat = (rgb) => { const M = V(rgb); return M <= 0 ? 0 : (M - Math.min(rgb[0], rgb[1], rgb[2])) / M; };

/* grad as a nine-pixel high-pass on the encoded face, so it tracks grad.mjs in
   direction if not in absolute value. Reported as a ratio to the unchanged case. */
const gradOf = (enc) => {
  const n = Math.floor(Math.sqrt(enc.length));
  let acc = 0, cnt = 0;
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m += enc[(y + dy) * n + x + dx];
      acc += Math.abs(enc[y * n + x] - m / 9); cnt++;
    }
  return acc / cnt;
};

const report = (label, gS, gL) => {
  const encS = shade.map((c) => encode(c.map((v) => v * 1), EXPOSURE * gS));
  /* sun-only: rebuild the sunlit face as shaded + g * direct */
  const litLin = gL === null ? lit.map((c) => c) : sortedL.map((c, i) => {
    const s = sortedS[Math.min(sortedS.length - 1, Math.round(i * sortedS.length / sortedL.length))];
    return [0, 1, 2].map((k) => s[k] + gL * direct[i][k]);
  });
  const encL = litLin.map((c) => encode(c, EXPOSURE * gS));

  const lumS = mean(encS.map(relLum));
  const lumL = mean(encL.map(relLum));
  const vs = encL.map(V).slice().sort((a, b) => a - b);
  const litTop = encL.slice().sort((a, b) => V(a) - V(b)).slice(Math.floor(0.6 * encL.length));
  const faceCv = mean(encS.map(relLum)) * 255;
  const g = gradOf(encS.map(relLum));

  console.log(`  ${label.padEnd(18)} ${(lumS / lumL).toFixed(3).padStart(6)} ` +
    `${mean(litTop.map(V)).toFixed(3).padStart(8)} ${mean(litTop.map(sat)).toFixed(3).padStart(8)} ` +
    `${faceCv.toFixed(2).padStart(7)} ${(255 * g).toFixed(2).padStart(7)} ` +
    `${(g / gradOf(shade.map((c) => relLum(forward(c, EXPOSURE))))).toFixed(3).padStart(7)}`);
  void vs;
};

console.log(`shaded ${shadeFile}\nsunlit ${litFile}\n`);
console.log('  lever               gate   sunlit V  lit sat  face cv   grad   grad rel');
report('unchanged', 1, null);
console.log('  -- global exposure, numerator and denominator together --');
for (const g of [1.10, 1.20, 1.30, 1.45, 1.60]) report(`exposure x${g.toFixed(2)}`, g, null);
console.log('  -- sun only, denominator alone --');
for (const g of [1.15, 1.30, 1.50, 1.75, 2.00]) report(`sun x${g.toFixed(2)}`, 1, g);

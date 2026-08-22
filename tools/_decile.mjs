/* Chroma by luminance decile, and the controls that say whether the figure is
 * about the light or about the encoding.
 *
 *   node tools/_decile.mjs shots/x.png [--region x y w h] [--lower 0.45] [--n 10]
 *
 * The final critic failed the build on this statistic: mean hue, saturation and
 * B/R in the lower 45% of the frame, by luminance decile, showing the darkest
 * decile at hue 3 degrees and saturation 0.74 against the brightest at 27 degrees
 * and 0.51 - read as "the darker a pixel gets the more red and saturated it
 * becomes, the opposite of real skylit shadow".
 *
 * The reading may be right, but the instrument cannot tell on its own, because
 * **HSV saturation is (max-min)/max and both terms misbehave near black.** As the
 * signal falls, (max-min) shrinks with it while quantisation does not: a pixel at
 * R=20 B=1 is saturation 0.95 whatever illuminant produced it, because blue has
 * run out of code values, not because the light was red. tools/hue.mjs has
 * excluded V < 0.06 for exactly this reason since it was written. So a decile
 * sweep on encoded 8-bit PNG measures the bottom of the encoder as much as it
 * measures the bottom of the scene.
 *
 * Three columns separate those. **minCV** is the mean smallest channel in code
 * values - if it is at 1 or 2 the saturation figure is quantisation, full stop.
 * **q0** is the fraction of pixels whose smallest channel is 0 or 1, which is the
 * same test as a proportion. And the tool is meant to be run on a *sunlit* window
 * as well as a shaded one: if sunlit dirt's darkest decile also reads red and
 * saturated, then the decile sweep produces that result on any red substrate
 * regardless of the light, and the finding is about the metric. Same material both
 * sides is the only way to separate transport from pigment.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const argv = process.argv.slice(2);
let region = null, lower = null, N = 10;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--region') { region = argv.slice(i + 1, i + 5).map(Number); i += 4; continue; }
  if (argv[i] === '--lower') { lower = Number(argv[++i]); continue; }
  if (argv[i] === '--n') { N = Number(argv[++i]); continue; }
  files.push(argv[i]);
}

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; h = ((h % 360) + 360) % 360; if (h > 180) h -= 360;
  }
  return [h, mx > 1e-9 ? d / mx : 0, mx];
};

for (const f of files) {
  const img = decode(readFileSync(f));
  let x0 = 0, y0 = 0, x1 = img.w, y1 = img.h;
  if (region) {
    x0 = Math.round(img.w * region[0]); y0 = Math.round(img.h * region[1]);
    x1 = Math.min(img.w, x0 + Math.round(img.w * region[2]));
    y1 = Math.min(img.h, y0 + Math.round(img.h * region[3]));
  } else if (lower != null) {
    y0 = Math.round(img.h * (1 - lower));
  }

  const px = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.w + x) * 4;
    const R = img.px[i], G = img.px[i + 1], B = img.px[i + 2];
    const r = R / 255, g = G / 255, b = B / 255;
    px.push({ L: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b, mn: Math.min(R, G, B) });
  }
  px.sort((p, q) => p.L - q.L);

  const name = f.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
  console.log(`\n  ${name}   ${px.length} px` +
    (region ? `  region ${region.join(' ')}` : lower != null ? `  lower ${lower}` : '  whole frame'));
  console.log('  decile      hue     sat     B/R      V    minCV     q0   <10cv');
  const step = px.length / N;
  for (let k = 0; k < N; k++) {
    const s = px.slice(Math.floor(k * step), Math.floor((k + 1) * step));
    let sh = 0, ch = 0, sat = 0, br = 0, v = 0, mn = 0, q0 = 0, lo = 0;
    for (const p of s) {
      const [h, sa, mx] = hsv(p.r, p.g, p.b);
      sh += Math.sin(h * Math.PI / 180); ch += Math.cos(h * Math.PI / 180);
      sat += sa; br += p.r > 1e-9 ? p.b / p.r : 0; v += mx; mn += p.mn;
      if (p.mn <= 1) q0++;
      if (p.mn * 1 < 10) lo++;
    }
    const n = s.length;
    const hue = Math.atan2(sh / n, ch / n) * 180 / Math.PI;
    console.log(`  ${String(k * 100 / N).padStart(3)}-${String((k + 1) * 100 / N).padEnd(4)}` +
      hue.toFixed(1).padStart(7) + (sat / n).toFixed(3).padStart(8) +
      (br / n).toFixed(3).padStart(8) + (v / n).toFixed(3).padStart(7) +
      (mn / n).toFixed(1).padStart(8) +
      ((100 * q0 / n).toFixed(0) + '%').padStart(7) + ((100 * lo / n).toFixed(0) + '%').padStart(7));
  }
}

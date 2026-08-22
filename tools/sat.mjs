/* Measure HSV saturation of a render, so colour can be argued with a number
 * instead of an opinion.
 *
 *   node tools/sat.mjs shots/sys1e_*.png
 *   node tools/sat.mjs --region 0.30 0.50 0.24 0.18 shots/sys1e_wash_low.png
 *   node tools/sat.mjs --lit shots/sys4c_wall_lit.png      # rock colour targets
 *
 * **Use --lit for every rock colour target.** They are all stated "on lit rock",
 * and a rock window under a directional key holds sunlit and self-shadowed faces
 * that are two different materials to this metric. See the --lit comment below.
 *
 * Measure *region crops*, not whole frames. A whole-frame figure averages in the
 * sky, the walls and the floor together and is meaningless — three surfaces with
 * genuinely different correct answers collapsed into one number. Pass --region to
 * fence off one surface; the default regions below are a rough floor/rock split
 * kept only for a quick look.
 *
 * The distribution matters more than the mean, so p99 is reported. A real wash
 * floor gets a long saturated tail from mixed lithology — iron-stained red clasts
 * and varnished near-black pebbles beside pale quartz sand — and a narrow band at
 * the right mean still reads as procedural.
 *
 * Value is reported beside saturation because the two are not independent at the
 * top of the range and reading saturation alone gets the diagnosis wrong. HSV
 * saturation is (max-min)/max, and the tone curve's shoulder pulls the channels
 * together as they approach white, so a surface driven to V 0.90 cannot carry a
 * saturation of 0.5 whatever its albedo is. A floor measuring low on saturation
 * and high on value is over-exposed, not under-pigmented, and pushing pigment at
 * it only clips harder. See tools/tone.mjs.
 *
 * Targets, from CONTRACT.md, measured on real photographs:
 *   Sedona rock, warm low sun   mean 0.42-0.65   p95 0.59-1.00
 *   Sunlit dry wash floor       mean 0.47-0.56   p95 0.67-0.74   p99 0.88
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

function stats(vals) {
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  let sum = 0;
  for (const v of vals) sum += v;
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  return {
    n: vals.length, mean: sum / vals.length,
    p50: q(0.5), p95: q(0.95), p99: q(0.99),
  };
}

const argv = process.argv.slice(2);
let region = null;
let pop = 1;
for (;;) {
  if (argv[0] === '--region') { region = argv.slice(1, 5).map(Number); argv.splice(0, 5); continue; }
  /* `--lit` restricts every window to its brightest 40%, and `--shade` to its
     darkest. This is not cosmetic. Under a directional key a rock window holds
     sunlit and self-shadowed faces at once, and to this metric those are two
     different materials: the same `wall_lit` window on `sys4c` reads saturation
     0.538 whole and 0.626 lit. Every rock colour target in CONTRACT.md is
     stated "on lit rock", so `--lit` is the mode that compares with them, and a
     whole-window figure quoted against them will read as a regression that is
     not there — which is exactly what happened once already. Quote the mode
     with the number. */
  if (argv[0] === '--lit') { pop = 0.40; argv.shift(); continue; }
  if (argv[0] === '--shade') { pop = -0.40; argv.shift(); continue; }
  break;
}

function measure(img, [fx, fy, fw, fh]) {
  const x0 = Math.round(img.w * fx), y0 = Math.round(img.h * fy);
  const x1 = Math.min(img.w, x0 + Math.round(img.w * fw));
  const y1 = Math.min(img.h, y0 + Math.round(img.h * fh));
  const px = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * img.ch;
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 12) continue;              // crushed black carries no hue
      px.push([(mx - mn) / mx, mx / 255]);
    }
  }
  /* Select on value, then report both statistics over the selected pixels, so
     the saturation and the V it was measured at always describe one population. */
  let sel = px;
  if (pop !== 1 && px.length) {
    px.sort((a, b) => a[1] - b[1]);
    const n = Math.max(1, Math.round(px.length * Math.abs(pop)));
    sel = pop > 0 ? px.slice(-n) : px.slice(0, n);
  }
  return { s: stats(sel.map((p) => p[0])), v: stats(sel.map((p) => p[1])) };
}

/* Fixed crops, one surface each, chosen so no window contains sky or straddles a
   wall/floor boundary. Named per viewpoint; a frame gets whichever apply. */
const REGIONS = {
  ground:    [['floor near', [0.20, 0.30, 0.35, 0.30]], ['floor mid', [0.36, 0.06, 0.30, 0.18]]],
  wash_low:  [['floor near', [0.30, 0.72, 0.35, 0.22]], ['floor mid', [0.30, 0.50, 0.24, 0.14]]],
  wash_mid:  [['floor near', [0.32, 0.76, 0.34, 0.20]], ['floor mid', [0.30, 0.54, 0.26, 0.14]]],
  bend:      [['sand', [0.28, 0.66, 0.36, 0.26]]],
  juniper:   [['floor', [0.30, 0.72, 0.34, 0.20]]],
  sun_gap:   [['floor mid', [0.40, 0.72, 0.24, 0.18]]],
  wall_lit:  [['rock lit', [0.30, 0.24, 0.34, 0.34]]],
  wall_shade:[['rock', [0.30, 0.24, 0.34, 0.34]]],
  /* Two windows on the same dirt, one in sun and one in fill. This is the only
     paired window in the table and it is the point of the view: identical albedo
     either side, so every difference between the two is light transport and none
     of it is pigment. No wall window here on purpose — at 160 m looking astern
     the near wall's lower face is in its own shadow and only its top band catches
     sun, so every crop I tried straddled the terminator and read V 0.35 with a
     19-degree hue spread. A window holding both sun and shade is the population
     error this project retired tonight; the honest reading is the floor pair. */
  shade_far: [['floor shade', [0.58, 0.66, 0.34, 0.28]], ['floor lit', [0.04, 0.74, 0.22, 0.20]]],
};

const f = (x) => x == null ? '  —  ' : x.toFixed(3);
console.log('file                     region      ' +
  '  sat mean  p50    p95    p99   |  V mean   p50    p95');

for (const file of argv) {
  const img = decode(readFileSync(file));
  const base = file.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
  const key = Object.keys(REGIONS).find((k) => base.endsWith('_' + k));
  const list = region ? [['crop', region]] : (REGIONS[key] || [['whole', [0, 0, 1, 1]]]);
  let name = base.padEnd(23);
  for (const [label, r] of list) {
    const { s, v } = measure(img, r);
    console.log(`${name}  ${label.padEnd(10)}  ` +
      `${f(s && s.mean)} ${f(s && s.p50)} ${f(s && s.p95)} ${f(s && s.p99)}  | ` +
      ` ${f(v && v.mean)} ${f(v && v.p50)} ${f(v && v.p95)}`);
    name = ''.padEnd(23);
  }
}

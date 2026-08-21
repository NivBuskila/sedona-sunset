/* Predict what System 7's grade does to a measured colour, without rendering.
 *
 *   node tools/_p7grade.mjs shots/sys4d_wall_lit.png
 *   node tools/_p7grade.mjs --region 0.30 0.24 0.34 0.34 --vib 0.14 shots/x.png
 *
 * The whole risk in this system is that "warm oranges and teals" walks lit rock
 * out of a saturation and hue band that took four rounds to reach. A capture is
 * ten minutes under contention, so tuning the grade by shooting it is an
 * afternoon for three data points.
 *
 * It does not have to be. The tone curve is invertible in closed form — see
 * tools/tone.mjs, whose inverse now round-trips a measured population exactly —
 * so the linear radiance behind every pixel of an already-captured frame can be
 * recovered, put through the grade, put back through the curve, and measured.
 * That is arithmetic, and it is the same arithmetic the shader runs.
 *
 * What it does not model, all of which is small on a rock crop and none of which
 * is a colour rotation: the defocus (zero past five metres), the bloom and flare
 * (thresholded above anything rock reaches), the aberration (zero inside the
 * middle two thirds) and the grain (zero mean). The vignette *is* modelled,
 * because it is a multiplicative light loss and does move value.
 *
 * The population is the brightest 40%, matching tools/sat.mjs --lit and
 * tools/hue.mjs --lit exactly, because every rock colour target in CONTRACT.md
 * is stated on lit rock and a whole-window figure is not comparable with them.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';
import { forward, inverse } from './tone.mjs';

const EXPOSURE = 1.15;   // src/sky.js

/* Defaults mirror POST_DEFAULTS in src/post.js. Keep them in step by hand; this
   is a prediction tool, not a second source of truth. */
const D = {
  shadowTint: [0.9813, 0.9964, 1.0920],
  highTint: [1.0246, 0.9987, 0.9400],
  splitPivot: 0.12,
  vibrance: 0.10,
  contrast: 1.03,
  contrastPivot: 0.5,
  vignette: 0.20,
};

const argv = process.argv.slice(2);
let region = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--region') { region = argv.slice(i + 1, i + 5).map(Number); i += 4; }
  else if (a === '--vib') { D.vibrance = +argv[++i]; }
  else if (a === '--pivot') { D.splitPivot = +argv[++i]; }
  else if (a === '--contrast') { D.contrast = +argv[++i]; }
  else if (a === '--vig') { D.vignette = +argv[++i]; }
  else if (a === '--shadow') { D.shadowTint = argv[++i].split(',').map(Number); }
  else if (a === '--high') { D.highTint = argv[++i].split(',').map(Number); }
  else files.push(a);
}

const REGIONS = {
  wall_lit: [['rock lit', [0.30, 0.24, 0.34, 0.34]]],
  wall_shade: [['rock', [0.30, 0.24, 0.34, 0.34]]],
  wash_mid: [['floor near', [0.32, 0.76, 0.34, 0.20]], ['floor mid', [0.30, 0.54, 0.26, 0.14]]],
  sun_gap: [['floor mid', [0.40, 0.72, 0.24, 0.18]]],
  ground: [['floor near', [0.20, 0.30, 0.35, 0.30]]],
  bend: [['sand', [0.28, 0.66, 0.36, 0.26]]],
};

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The grade, term for term as src/post.js runs it. `rN` is 0 at centre, 1 at corner. */
function grade(lin, rN) {
  let c = lin.slice();
  c = c.map((x) => x * (1 - D.vignette * smoothstep(0.30, 1.06, rN)));
  const l = luma(c);
  const t = l / (l + D.splitPivot);
  c = c.map((x, i) => x * (D.shadowTint[i] + (D.highTint[i] - D.shadowTint[i]) * t));

  /* forward() returns encoded sRGB; the post-curve terms run on the
     display-referred value *before* the encode, so undo it for them. */
  const enc = forward(c, EXPOSURE);
  let o = enc.map((x) => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));

  const mx = Math.max(...o), mn = Math.min(...o);
  const sat = (mx - mn) / Math.max(mx, 1e-4);
  const g = D.vibrance * (1 - smoothstep(0.25, 0.60, sat));
  const ly = luma(o);
  o = o.map((x) => ly + (x - ly) * (1 + g));
  let e = o.map((x) => x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  /* Chroma-preserving, and after the encode. A uniform scale of all three
     channels leaves HSV saturation and hue exactly where they were; a pivoted
     contrast applied per channel does not, and at 1.025 it moved lit rock from
     0.604 to 0.690. In linear light the same term is savage in the shadows —
     it took `wall_lit` midwall from L 0.143 to 0.113 — so it runs in the
     encoded domain, where a photographer's contrast slider lives. */
  const le = luma(e);
  const te = Math.min(1, Math.max(0, (le - D.contrastPivot) * D.contrast + D.contrastPivot));
  const ke = le > 1e-4 ? te / le : 1;
  return e.map((x) => Math.min(1, Math.max(0, x * ke)));
}

function hueOf(c) {
  const mx = Math.max(...c), mn = Math.min(...c), d = mx - mn;
  if (d <= 1e-6) return null;
  let h;
  if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6;
  else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
  else h = (c[0] - c[1]) / d + 4;
  h = ((h * 60 % 360) + 360) % 360;
  return h > 180 ? h - 360 : h;
}

function stats(pop) {
  const s = [], v = [], h = [], bg = [];
  for (const c of pop) {
    const mx = Math.max(...c), mn = Math.min(...c);
    s.push(mx <= 0 ? 0 : (mx - mn) / mx);
    v.push(mx);
    const hh = hueOf(c);
    if (hh !== null) h.push(hh);
    if (c[1] > 1e-4) bg.push(c[2] / c[1]);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const p = (a, q) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
  return { sat: mean(s), satP95: p(s, 0.95), v: mean(v), hue: med(h), bg: med(bg) };
}

const fmt = (r) => `sat ${r.sat.toFixed(3)}  p95 ${r.satP95.toFixed(3)}  ` +
  `hue ${r.hue.toFixed(1).padStart(6)}  V ${r.v.toFixed(3)}  B/G ${r.bg.toFixed(3)}`;

for (const file of files) {
  const img = decode(readFileSync(file));
  const base = file.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
  const key = Object.keys(REGIONS).find((k) => base.endsWith('_' + k));
  const list = region ? [['crop', region]] : (REGIONS[key] || [['whole', [0.1, 0.1, 0.8, 0.8]]]);
  const aspect = img.w / img.h;
  const corner = Math.hypot(aspect, 1) * 0.5;

  for (const [label, [fx, fy, fw, fh]] of list) {
    const x0 = Math.round(img.w * fx), y0 = Math.round(img.h * fy);
    const x1 = Math.min(img.w, x0 + Math.round(img.w * fw));
    const y1 = Math.min(img.h, y0 + Math.round(img.h * fh));
    const px = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * img.w + x) * img.ch;
        const c = [img.px[i] / 255, img.px[i + 1] / 255, img.px[i + 2] / 255];
        if (Math.max(...c) < 12 / 255) continue;
        const u = (x + 0.5) / img.w - 0.5, v = 0.5 - (y + 0.5) / img.h;
        px.push([c, Math.hypot(u * aspect, v) / corner]);
      }
    }
    px.sort((a, b) => Math.max(...a[0]) - Math.max(...b[0]));
    const sel = px.slice(-Math.max(8, Math.round(px.length * 0.40)));

    const before = sel.map((p) => p[0]);
    const after = sel.map(([c, rN]) => grade(inverse(c, EXPOSURE), rN));
    /* Clipping is unrecoverable, so a population with much of it is a floor
       rather than a measurement — say how much of this one there is. */
    const clipped = before.filter((c) => Math.max(...c) >= 254.5 / 255).length;

    console.log(`${base}  ${label}  n=${sel.length}  clipped ${(100 * clipped / sel.length).toFixed(1)}%`);
    console.log(`  before  ${fmt(stats(before))}`);
    console.log(`  after   ${fmt(stats(after))}`);
  }
}

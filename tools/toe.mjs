/* What the bottom of the tone curve is doing to shadow structure.
 *
 *   node tools/toe.mjs shots/sys1p_wall_shade.png shots/sys1p_np_wall_shade.png
 *   node tools/toe.mjs --region 0.30 0.24 0.24 0.24 shots/sys4g_wall_shade.png
 *
 * grad.mjs reports gradient and grad/L, which is the right pair for a surface in
 * open light. It is the wrong pair for a face at L 0.039, because both figures
 * are ratios and the thing that limits legibility there is not a ratio: it is
 * that the face occupies nine code values of an 8-bit file, so a gradient of
 * 0.0075 is 1.9 of them and anything that halves it rounds it away.
 *
 * So this reports the same region in code values, plus how much of it is sitting
 * on or near zero. A tone curve with a subtractive black point — which is what a
 * pivoted gain is, whatever it is called in the shader — clips everything below
 * that point to a single value, and clipped shadow reads as a hole rather than
 * as dark.
 *
 * Given two files it diffs them, which is the useful mode: graded against its
 * --hash nopost control tells you what the chain cost rather than what the
 * lighting is doing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decode } from './png.mjs';

const REGIONS = {
  wall_shade: [0.30, 0.24, 0.24, 0.24],
  wall_lit: [0.16, 0.30, 0.20, 0.20],
  wash_mid: [0.28, 0.28, 0.18, 0.16],
  bend: [0.10, 0.06, 0.22, 0.26],
  sun_gap: [0.10, 0.30, 0.16, 0.24],
};

const a = process.argv.slice(2);
const ri = a.indexOf('--region');
const region = ri >= 0 ? a.slice(ri + 1, ri + 5).map(Number) : null;
const files = a.filter((s, i) => s.endsWith('.png') && (ri < 0 || i < ri || i > ri + 4));

/* The shadow-to-sunlit gate as CONTRACT.md pins it: a flat shaded face against a
   flat sunlit face, the same window in both views, mean relative luminance off
   the encoded PNG. Implemented here because nothing else implemented it —
   `fillprobe --ratio` used the darkest-40%-against-brightest-40% split, which is
   the estimator the contract explicitly names as the *other* one and which reads
   3x low on the same frame. Two tools reporting one gate under one name is how a
   system gets told it has moved when it has not. That one is withdrawn now and
   refuses; this and tools/_gate.mjs are the two that answer. */
const GATE = [0.30, 0.24, 0.34, 0.34];
if (a.includes('--gate')) {
  const shade = files.find(f => f.includes('wall_shade'));
  const lit = files.find(f => f.includes('wall_lit'));
  if (!shade || !lit) {
    console.error('--gate needs a wall_shade and a wall_lit capture of the same build');
    process.exit(1);
  }
  const m = f => {
    const { L } = lumaPlane(f, GATE);
    return L.reduce((s, v) => s + v, 0) / L.length;
  };
  const sh = m(shade), su = m(lit);
  const r = sh / su;
  console.log(`shaded ${(sh * 255).toFixed(1)} cv   sunlit ${(su * 255).toFixed(1)} cv`);
  console.log(`shadow-to-sunlit ${r.toFixed(3)}   target 0.15-0.25   ` +
              (r <= 0.25 ? 'in band' : `over by ${(r - 0.25).toFixed(3)}`));
  process.exit(0);
}

/* Rec.709 on the encoded values, which is what CONTRACT.md means by "mean
   relative luminance read off the sRGB-encoded PNG" — the same convention the
   shadow-to-sunlit gate is defined in, so the numbers here are comparable with
   it rather than being a second private definition. */
function lumaPlane(file, force) {
  const im = decode(readFileSync(file));
  const px = im.px || im.data, ch = im.ch || 4, w = im.w || im.width, h = im.h || im.height;
  const base = path.basename(file).replace('.png', '');
  const key = Object.keys(REGIONS).find(k => base.endsWith('_' + k));
  const r = force || region || REGIONS[key] || [0.1, 0.1, 0.8, 0.8];
  const x0 = Math.round(r[0] * w), y0 = Math.round(r[1] * h);
  const cw = Math.round(r[2] * w), chh = Math.round(r[3] * h);
  const L = new Float64Array(cw * chh);
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      const i = ((y0 + y) * w + (x0 + x)) * ch;
      L[y * cw + x] = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    }
  }
  return { L, w: cw, h: chh, name: base };
}

function stats({ L, w, h }) {
  let sum = 0;
  for (const v of L) sum += v;
  const mean = sum / L.length;

  /* Mean absolute one-pixel gradient, the same quantity grad.mjs reports, so a
     figure here can be put next to one from there. */
  let g = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) { g += Math.abs(L[y * w + x + 1] - L[y * w + x]); n++; }
      if (y + 1 < h) { g += Math.abs(L[(y + 1) * w + x] - L[y * w + x]); n++; }
    }
  }
  const grad = g / n;

  const s = Float64Array.from(L).sort();
  const pc = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  /* How much of the region is within a code value or two of black. A face that
     is dark reads as rock; a face with a tail pinned at zero reads as a hole,
     and the tail is invisible in a mean. */
  const below = t => 100 * s.findIndex(v => v > t / 255) / s.length;

  return {
    meanCV: mean * 255, grad, gradCV: grad * 255, gradOverL: grad / Math.max(mean, 1e-9),
    p1: pc(0.01) * 255, p5: pc(0.05) * 255, p50: pc(0.5) * 255, p99: pc(0.99) * 255,
    at0: 100 * s.filter(v => v <= 0.5 / 255).length / s.length,
    b2: below(2), b4: below(4), b6: below(6),
    /* Distinct code values present. A tone curve with gain > 1 in the shadows
       cannot create levels that quantisation removed, so this counts how much
       ladder the structure actually has to stand on. */
    levels: new Set(Array.from(s, v => Math.round(v * 255))).size,
  };
}

const rows = files.map(f => ({ f, s: stats(lumaPlane(f)), n: lumaPlane(f).name }));

console.log('file                        L(cv)  grad(cv)  grad/L   p1    p5   p50   p99  ' +
            '=0%   <2cv  <4cv  levels');
for (const r of rows) {
  const s = r.s;
  console.log(`${r.n.slice(0, 26).padEnd(26)} ${s.meanCV.toFixed(2).padStart(5)} ` +
              `${s.gradCV.toFixed(2).padStart(8)}  ${s.gradOverL.toFixed(3)} ` +
              `${s.p1.toFixed(0).padStart(4)} ${s.p5.toFixed(0).padStart(5)} ` +
              `${s.p50.toFixed(0).padStart(5)} ${s.p99.toFixed(0).padStart(5)} ` +
              `${s.at0.toFixed(1).padStart(5)} ${s.b2.toFixed(1).padStart(6)} ` +
              `${s.b4.toFixed(1).padStart(5)} ${String(s.levels).padStart(6)}`);
}

if (rows.length === 2) {
  const [x, y] = rows;
  const d = (k) => {
    const v = x.s[k], u = y.s[k];
    return `${(v > u ? '+' : '')}${(100 * (v / Math.max(u, 1e-9) - 1)).toFixed(1)}%`;
  };
  console.log(`\n${x.n} relative to ${y.n}:`);
  console.log(`  level ${d('meanCV')}   gradient ${d('gradCV')}   levels used ${d('levels')}`);
  console.log(`  at zero ${x.s.at0.toFixed(1)}% vs ${y.s.at0.toFixed(1)}%   ` +
              `below 4 cv ${x.s.b4.toFixed(1)}% vs ${y.s.b4.toFixed(1)}%`);
}

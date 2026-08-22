/* Is the quilt a property of the image, or of the filter used to look for it?
 *
 * A dominant 6-8 px periodicity was reported on every surface in the delivery
 * set, measured through a 9 px high-pass. Two things make that worth testing
 * before it is chased:
 *
 *   - A high-pass built by subtracting a box blur of radius R is a band-pass,
 *     not a high-pass. Its transfer peaks at a scale set by R, so it will
 *     preferentially report structure near R whatever the image contains.
 *   - This project's own _lattice.mjs high-passes at radius 14 and has been
 *     reporting periods of 23 to 27 px on the same frames. Two filters, two
 *     answers, each roughly 0.8 times its own kernel. That is the signature of
 *     a measurement reporting itself.
 *
 * So the test is not "is there a peak" - a peak is guaranteed. It is whether
 * the peak SITS STILL when the filter moves. A real spatial frequency in the
 * image does not care what kernel is used to find it; a filter artefact tracks
 * the kernel linearly.
 *
 * Run against synthetic controls in the same sweep, because a null is only
 * believable next to a positive. White noise has no periodicity by
 * construction, and pink noise has the falling spectrum real imagery has and
 * still no periodicity. If those two produce the same peak positions and
 * comparable peak-to-median ratios as the render, the metric is measuring its
 * own kernel on both.
 *
 *   node tools/_quiltfilt.mjs shots/x.png x0,y0,x1,y1
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const RADII = [0, 3, 5, 7, 9, 12, 16, 22, 30];
const W = 256;                       // FFT length, power of two

/* ---- minimal radix-2 FFT ---- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/* separable box blur on a 2-D float field */
function boxBlur(src, w, h, R) {
  const tmp = new Float64Array(w * h), out = new Float64Array(w * h);
  const n = 2 * R + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -R; x <= R; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s -= src[y * w + Math.min(w - 1, Math.max(0, x - R))];
      s += src[y * w + Math.min(w - 1, Math.max(0, x + R + 1))];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -R; y <= R; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s -= tmp[Math.min(h - 1, Math.max(0, y - R)) * w + x];
      s += tmp[Math.min(h - 1, Math.max(0, y + R + 1)) * w + x];
    }
  }
  return out;
}

/* Is there a LINE in the spectrum?
 *
 * The filter question dissolves once the right statistic is chosen. A
 * box-subtract high-pass multiplies the power spectrum by a smooth transfer
 * function, and so does any other linear filter. So if the continuum is
 * estimated locally - a running median of log power over neighbouring bins -
 * every smooth factor divides out, the filter included, and what is left is
 * only what the filter cannot create: narrow excess at one frequency.
 *
 * That is also the correct definition of the complaint. Real photographs do not
 * have a dominant repeating spatial frequency, which in spectral terms means no
 * line above the continuum. A broad hump is not a repeating pattern, it is a
 * texture scale, and every natural surface has one.
 */
function analyse(field, w, h, R) {
  let src = field;
  if (R > 0) {
    const lo = boxBlur(field, w, h, R);
    src = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) src[i] = field[i] - lo[i];
  }
  const nSeg = Math.max(1, Math.floor(w / W));
  const pow = new Float64Array(W / 2);
  let rows = 0;
  for (let y = 0; y < h; y++) {
    for (let sg = 0; sg < nSeg; sg++) {
      const re = new Float64Array(W), im = new Float64Array(W);
      for (let x = 0; x < W; x++) {
        const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * x / (W - 1));
        re[x] = src[y * w + sg * W + x] * win;
      }
      fft(re, im);
      for (let k = 1; k < W / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
      rows++;
    }
  }
  for (let k = 1; k < W / 2; k++) pow[k] /= rows;

  /* local continuum: median of the surrounding bins, excluding the bin itself
     and its immediate neighbours so a genuine line does not raise its own floor */
  let bestEx = 0, bestK = 0;
  const HALF = 10;
  for (let k = 4; k < W / 2 - 4; k++) {
    const nb = [];
    for (let j = k - HALF; j <= k + HALF; j++) {
      if (j < 2 || j >= W / 2) continue;
      if (Math.abs(j - k) <= 1) continue;
      nb.push(pow[j]);
    }
    nb.sort((a, b) => a - b);
    const cont = nb[nb.length >> 1];
    const ex = pow[k] / Math.max(cont, 1e-30);
    if (ex > bestEx) { bestEx = ex; bestK = k; }
  }
  return { period: W / bestK, excess: bestEx };
}

/* The reported statistic, reproduced so the diagnosis is positive rather than
   only a null: peak-to-median of the power spectrum after a box-subtract
   high-pass. Run it on noise and it returns large numbers, because peak over
   median of a FALLING spectrum measures the slope of the continuum. A 1/f
   field has no repeating frequency anywhere in it and scores higher than any
   surface in the delivery set. */
function criticStat(field, w, h, R) {
  const lo = boxBlur(field, w, h, R);
  const hp = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) hp[i] = field[i] - lo[i];
  const nSeg = Math.max(1, Math.floor(w / W));
  const pow = new Float64Array(W / 2);
  let rows = 0;
  for (let y = 0; y < h; y++) for (let sg = 0; sg < nSeg; sg++) {
    const re = new Float64Array(W), im = new Float64Array(W);
    for (let x = 0; x < W; x++) re[x] = hp[y * w + sg * W + x];
    fft(re, im);
    for (let k = 1; k < W / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
    rows++;
  }
  let bp = 0, bk = 2;
  for (let k = 2; k < W / 2; k++) if (pow[k] > bp) { bp = pow[k]; bk = k; }
  const sorted = Array.from(pow.slice(2)).sort((a, b) => a - b);
  return { period: W / bk, ratio: bp / sorted[sorted.length >> 1] };
}

function noise(w, h, pink) {
  const f = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = Math.random() * 2 - 1;
  if (!pink) return f;
  /* pink-ish: sum of box blurs at octave scales, the falling spectrum real
     imagery has, with no periodicity anywhere in it */
  const out = new Float64Array(w * h);
  for (let o = 0, R = 1; o < 6; o++, R *= 2) {
    const b = boxBlur(f, w, h, R);
    for (let i = 0; i < w * h; i++) out[i] += b[i] * R;
  }
  return out;
}

const [file, box] = process.argv.slice(2);
let field, w, h, label;
if (file && file !== '--synth') {
  const im = decode(readFileSync(file));
  const [x0, y0, x1, y1] = box.split(',').map(Number);
  w = x1 - x0; h = y1 - y0;
  field = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y + y0) * im.w + (x + x0)) * im.ch;
    field[y * w + x] = 0.2126 * im.px[i] + 0.7152 * im.px[i + 1] + 0.0722 * im.px[i + 2];
  }
  label = file.replace(/^shots\//, '') + ' ' + box;
  /* Liveness. A null is only worth reporting if the instrument can see the
     thing whose absence is being claimed, so inject a sinusoid of known period
     and known amplitude and check it comes back. Amplitude is in code values:
     1.0 is a one-level ripple, far below anything a critic could see
     unamplified, which is the right bar - the claim is a DOMINANT pattern. */
  const ii = process.argv.indexOf('--inject');
  if (ii >= 0) {
    const [per, amp] = process.argv[ii + 1].split(',').map(Number);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      field[y * w + x] += amp * Math.sin(2 * Math.PI * x / per);
    label += `  + injected ${per}px sinusoid at +-${amp} code values`;
  }
} else { w = 512; h = 350; field = noise(w, h, true); label = 'synthetic pink'; }

if (process.argv.includes('--critic')) {
  const wnC = noise(w, h, false), pnC = noise(w, h, true);
  console.log(`\n  ${label}   ${w}x${h}`);
  console.log('  the reported statistic, on the render and on fields with no periodicity at all\n');
  console.log('   high-pass R      render            white noise         pink noise');
  for (const R of [3, 5, 7, 9, 12, 16, 22, 30]) {
    const a = criticStat(field, w, h, R);
    const b = criticStat(wnC, w, h, R);
    const c = criticStat(pnC, w, h, R);
    console.log(`   ${String(R).padStart(2)} px      ${a.period.toFixed(1).padStart(6)}px ${a.ratio.toFixed(1).padStart(6)}x` +
      `    ${b.period.toFixed(1).padStart(6)}px ${b.ratio.toFixed(1).padStart(6)}x` +
      `    ${c.period.toFixed(1).padStart(6)}px ${c.ratio.toFixed(1).padStart(6)}x`);
  }
  process.exit(0);
}

console.log(`\n  ${label}   ${w}x${h}`);
console.log('  a line above the local continuum is the only thing a smooth filter cannot make.\n');
console.log('   high-pass R    strongest line     excess over local continuum');
const wn = noise(w, h, false), pn = noise(w, h, true);
for (const R of RADII) {
  const a = analyse(field, w, h, R);
  const bw = analyse(wn, w, h, R);
  const bp = analyse(pn, w, h, R);
  console.log(`   ${(R || 'none').toString().padStart(4)}        ${a.period.toFixed(1).padStart(6)} px       ` +
    `${a.excess.toFixed(2).padStart(6)}x` +
    `    | white ${bw.period.toFixed(1).padStart(5)} px ${bw.excess.toFixed(2).padStart(5)}x` +
    `  | pink ${bp.period.toFixed(1).padStart(5)} px ${bp.excess.toFixed(2).padStart(5)}x`);
}

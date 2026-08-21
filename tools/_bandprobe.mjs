/* Where is the height field's energy, per octave?
 *
 * The midground reads as smooth rolling mounds one to four metres across with
 * featureless flanks. That is a statement about the *spectrum* of the height
 * field, so measure the spectrum rather than argue about it: sample a patch of
 * wash floor on a fine grid, band-pass it into octaves with a difference of box
 * filters, and report the RMS height and the RMS slope each octave contributes.
 *
 * RMS slope is the column that matters, because shading is linear in slope and a
 * band with no slope in it is a band the eye cannot see whatever its height is.
 * A natural surface is roughly self-affine, which means slope should be
 * comparable across octaves or rise gently toward the fine end. A spectrum with
 * all of its slope in one octave and nothing below it is a field of mounds.
 *
 *   node tools/_bandprobe.mjs [x0 z0 halfwidth]
 */
import { Terrain } from '../src/terrain.js';
import { WashPath } from '../src/path.js';

const path = new WashPath();
const terrain = new Terrain(path);

/* 0.025 m sampling over a 25 m square: fine enough that the shortest octave
   under test is eight samples wide, and centred on open floor up-wash. */
const STEP = 0.025;
const HALF = +(process.argv[4] ?? 12.5);
const CX = +(process.argv[2] ?? 0), CZ = +(process.argv[3] ?? -45);
const N = Math.round((HALF * 2) / STEP);

const H = new Float64Array(N * N);
for (let j = 0; j < N; j++) {
  const z = CZ - HALF + j * STEP;
  for (let i = 0; i < N; i++) H[j * N + i] = terrain.heightAt(CX - HALF + i * STEP, z);
}

/** Separable box blur of radius r samples, clamped at the edges. */
function blur(src, n, r) {
  if (r < 1) return Float64Array.from(src);
  const t = new Float64Array(n * n), o = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let s = 0, c = 0;
    for (let d = -r; d <= r; d++) { const xx = x + d; if (xx < 0 || xx >= n) continue; s += src[y*n+xx]; c++; }
    t[y * n + x] = s / c;
  }
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
    let s = 0, c = 0;
    for (let d = -r; d <= r; d++) { const yy = y + d; if (yy < 0 || yy >= n) continue; s += t[yy*n+x]; c++; }
    o[y * n + x] = s / c;
  }
  return o;
}

/* Statistics taken on the interior only, so the clamped edges of the blur do not
   pollute the band that is being measured. */
function bandStats(band, n, skip) {
  let s2 = 0, g2 = 0, m = 0, cnt = 0, gc = 0;
  for (let y = skip; y < n - skip; y++) for (let x = skip; x < n - skip; x++) {
    const v = band[y * n + x];
    m += v; s2 += v * v; cnt++;
    if (x + 1 < n - skip) { const d = (band[y*n+x+1] - v) / STEP; g2 += d * d; gc++; }
    if (y + 1 < n - skip) { const d = (band[(y+1)*n+x] - v) / STEP; g2 += d * d; gc++; }
  }
  const mean = m / cnt;
  return { rms: Math.sqrt(Math.max(0, s2 / cnt - mean * mean)), slope: Math.sqrt(g2 / gc) };
}

/* Octave edges in metres, from a quarter of the mesh spacing up to the width of
   the channel. Radii are in samples. */
const EDGES = [0.05, 0.10, 0.20, 0.40, 0.80, 1.60, 3.20, 6.40, 12.8];
const levels = EDGES.map(e => blur(H, N, Math.max(0, Math.round(e / STEP / 2))));

console.log(`height field spectrum, ${(HALF*2).toFixed(0)} m square at x=${CX} z=${CZ}`);
console.log(`sampled every ${(STEP*1000).toFixed(0)} mm\n`);
console.log('  octave            RMS height   RMS slope   share of slope');
const rows = [];
let tot = 0;
for (let i = 0; i < EDGES.length - 1; i++) {
  const n2 = N;
  const band = new Float64Array(n2 * n2);
  for (let k = 0; k < band.length; k++) band[k] = levels[i][k] - levels[i + 1][k];
  const s = bandStats(band, n2, Math.round(EDGES[EDGES.length - 1] / STEP / 2) + 2);
  rows.push([`${EDGES[i].toFixed(2)} - ${EDGES[i+1].toFixed(2)} m`, s]);
  tot += s.slope;
}
for (const [label, s] of rows) {
  console.log(`  ${label.padEnd(18)} ${(s.rms * 1000).toFixed(1).padStart(7)} mm   ` +
    `${s.slope.toFixed(4).padStart(8)}   ${(100 * s.slope / tot).toFixed(1).padStart(5)}%`);
}
const full = bandStats(H, N, Math.round(EDGES[EDGES.length-1]/STEP/2) + 2);
console.log(`\n  unfiltered           ${(full.rms*1000).toFixed(0).padStart(6)} mm   ${full.slope.toFixed(4).padStart(8)}`);

/* What a pixel can resolve there, for scale: at 30 m a pixel is 29 mm across the
   view and at 60 m it is 58 mm, so every octave above 0.10 m is several pixels
   wide and ought to be visible. */
console.log('\n  for scale: a pixel spans 29 mm of ground across the view at 30 m,');
console.log('  58 mm at 60 m. Every octave from 0.10 m up is resolvable there.');

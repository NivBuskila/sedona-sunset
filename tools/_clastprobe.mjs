/* Scratch probe: shade one clast facet out of the actual clast maps and measure
 * the same statistics tools/grad.mjs measures on a capture. Modelled directly on
 * tools/wallprobe.mjs — same mip pyramid, same trilinear, same stats — but
 * pointed at makeClastSurface instead of makeRock, and at the sampling scale the
 * clast shader really uses.
 *
 *   node tools/_clastprobe.mjs                    # the distances that matter
 *   node tools/_clastprobe.mjs --mpp 0.0015
 *   node tools/_clastprobe.mjs --only coarse|grit|none
 *
 * The scale: scatter.js box-projects hull UVs into the unit square, so one tile
 * spans the instance's full width (2r), then multiplies by uvK = clamp(r*34,
 * 1, 18). Tile size is therefore 2r/(34r) = 58.8 mm for every clast in the
 * clamp range, i.e. 17.0 cycles per metre. A 40 cm boulder two and a half
 * metres away is about 1.5 mm per pixel, which is the case the critique is
 * about.
 */
import { makeClastSurface, makeGrit } from '../src/textures.js';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i < 0 ? d : Number(process.argv[i + 1]);
};
const W = arg('w', 384), H = arg('h', 384);
const SUNEL = arg('sun', 8) * Math.PI / 180;
const oi = process.argv.indexOf('--only');
const ONLY = oi < 0 ? 'all' : process.argv[oi + 1];

function pyramid(data, size, ch = 4) {
  const lv = [];
  let cur = new Float32Array(size * size * ch);
  for (let i = 0; i < cur.length; i++) cur[i] = data[i] / 255;
  let s = size;
  lv.push({ s, d: cur });
  while (s > 1) {
    const n = s >> 1, out = new Float32Array(n * n * ch);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < ch; c++) {
      out[(y * n + x) * ch + c] = 0.25 * (
        cur[((y * 2) * s + x * 2) * ch + c] + cur[((y * 2) * s + x * 2 + 1) * ch + c] +
        cur[((y * 2 + 1) * s + x * 2) * ch + c] + cur[((y * 2 + 1) * s + x * 2 + 1) * ch + c]);
    }
    cur = out; s = n;
    lv.push({ s, d: cur });
  }
  return lv;
}
function bilinear(lv, u, v, ch, out) {
  const s = lv.s, d = lv.d;
  const fx = u * s - 0.5, fy = v * s - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const wrap = (i) => ((i % s) + s) % s;
  const xa = wrap(x0), xb = wrap(x0 + 1), ya = wrap(y0), yb = wrap(y0 + 1);
  for (let c = 0; c < ch; c++) {
    const a = d[(ya * s + xa) * ch + c], b = d[(ya * s + xb) * ch + c];
    const e = d[(yb * s + xa) * ch + c], f = d[(yb * s + xb) * ch + c];
    out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (e * (1 - tx) + f * tx) * ty;
  }
}
const tmpA = new Float32Array(4), tmpB = new Float32Array(4);
function sampleMip(pyr, u, v, texels, ch, out) {
  const l = Math.max(0, Math.log2(Math.max(texels, 1e-6)));
  const l0 = Math.min(pyr.length - 1, Math.floor(l));
  const l1 = Math.min(pyr.length - 1, l0 + 1);
  const t = l - l0;
  bilinear(pyr[l0], u, v, ch, tmpA);
  bilinear(pyr[l1], u, v, ch, tmpB);
  for (let c = 0; c < ch; c++) out[c] = tmpA[c] * (1 - t) + tmpB[c] * t;
}
function stats(L, w, h) {
  let g1 = 0, n1 = 0, g4 = 0, n4 = 0, sum = 0, sum2 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = L[y * w + x];
    sum += c; sum2 += c * c;
    if (x + 1 < w) { g1 += Math.abs(L[y * w + x + 1] - c); n1++; }
    if (y + 1 < h) { g1 += Math.abs(L[(y + 1) * w + x] - c); n1++; }
    if (x + 4 < w) { g4 += Math.abs(L[y * w + x + 4] - c); n4++; }
    if (y + 4 < h) { g4 += Math.abs(L[(y + 4) * w + x] - c); n4++; }
  }
  const n = w * h, mean = sum / n;
  const grad = g1 / n1, grad4 = g4 / n4;
  return { grad, grad4, ratio: grad / Math.max(1e-9, grad4), mean,
           sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}
const srgb = (c) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) LUT[i] = lin(i / 255);

console.log('generating maps…');
let t0 = Date.now();
const cl = makeClastSurface(512);
const grit = makeGrit(256);
console.log(`  ${Date.now() - t0} ms`);

const CS = 512;
const cAlin = new Uint8Array(CS * CS * 4);
{
  const d = cl.albedo.image.data;
  for (let i = 0; i < cAlin.length; i++) cAlin[i] = LUT[d[i]] * 255;
}
const pA = pyramid(cAlin, CS);
const pN = pyramid(cl.normal.image.data, CS);
const pM = pyramid(cl.arm.image.data, CS);
const pG = pyramid(grit.image.data, 256);

const SC = arg('sc', 17.0);          // cycles per metre, derived above
/* The shipped weights. Note what this probe cannot see: it rewarded gn 0.85
   with hf/lf 0.68, and in the render gn 0.85 came out as high-contrast polka
   dots, because a grazing sun turns a large tangent slope into a binary lit/
   unlit decision and a binary field has a superb one-pixel gradient. The probe
   measures amplitude in the right band; it does not measure whether the band is
   filled with grain or with dots. Read `sd` alongside `grad` and distrust any
   setting whose sd runs far past the surface it is meant to resemble. */
const GLOCK = arg('glock', 1.0);
const GN = arg('gn', 0.25);          // grit normal weight
const GT = arg('gt', 1.30);          // grit tone weight
const GC = arg('gc', 1.70);          // grit cavity weight
const GBIAS = arg('gbias', 0.93);    // mean micro-shadow
const GR_MEAN = 0.427, GA_MEAN = 0.934;

/* Sun eight degrees up, forty off the facet normal: a grazing key on an
   up-and-outward facet, which is what the loud boulder in `ground` presents. */
const sl = [Math.cos(SUNEL) * Math.sin(0.70), Math.sin(SUNEL), Math.cos(SUNEL) * Math.cos(0.70)];

function probe(mpp) {
  const out = new Float64Array(W * H);
  const a4 = new Float32Array(4), n4 = new Float32Array(4);
  const m4 = new Float32Array(4), g4 = new Float32Array(4);

  const gLod = Math.log2(mpp * 256 * GLOCK);
  const gSc = Math.pow(2, -Math.floor(gLod));
  const gT = gLod - Math.floor(gLod);

  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const wx = px * mpp, wy = -py * mpp;

    sampleMip(pA, wx * SC, wy * SC, mpp * SC * CS, 4, a4);
    sampleMip(pN, wx * SC, wy * SC, mpp * SC * CS, 4, n4);
    sampleMip(pM, wx * SC, wy * SC, mpp * SC * CS, 4, m4);
    const alb = [a4[0], a4[1], a4[2]];
    const rough = m4[1];

    const gu = wx * gSc + 3.7, gv = wy * gSc + 12.9;
    sampleMip(pG, gu, gv, mpp * gSc * 256, 4, g4);
    const ga = [g4[0], g4[1], g4[2], g4[3]];
    sampleMip(pG, gu * 0.5, gv * 0.5, mpp * gSc * 0.5 * 256, 4, g4);
    const gr = ga.map((v, i) => v * (1 - gT) + g4[i] * gT);

    const kC = ONLY === 'all' || ONLY === 'coarse' ? 1 : 0;
    const kG = ONLY === 'all' || ONLY === 'grit' ? 1 : 0;

    /* Clast map normal, faded toward geometric as the footprint crosses the
       lamination period, exactly as the shader does it. */
    const fade = 0.14 + 0.86 * (1 - Math.max(0, Math.min(1,
      (mpp - 0.0011) / (0.006 - 0.0011))));
    let Nx = (n4[0] - 0.5) * 2 * fade * kC, Ny = (n4[1] - 0.5) * 2 * fade * kC;
    if (kG) {
      Nx += (gr[1] - 0.5) * 2 * GN;
      Ny += (gr[2] - 0.5) * 2 * GN;
    }
    let Nz = Math.sqrt(Math.max(1e-4, 1 - Nx * Nx - Ny * Ny));

    const ndl = Math.max(0, Nx * sl[0] + Ny * sl[1] + Nz * sl[2]);
    const tone = kG ? 1 + (gr[0] - GR_MEAN) * GT : 1;
    const cav = kG ? Math.max(0.34, Math.min(1.10, GBIAS - (GA_MEAN - gr[3]) * GC)) : 1;

    /* Sun plus a sky/bounce fill, matching the render's rough proportion. */
    /* Exposed so the facet lands mid-grey. The first run of this probe had the
       key at 2.25 and every pixel sat at 0.95 in sRGB, where the encoding curve
       is nearly flat and every gradient is compressed by a factor of five —
       the instrument could not see the thing it was measuring. */
    const key = arg('key', 0.95), fill = arg('fill', 0.28);
    let L = 0;
    for (let c = 0; c < 3; c++) {
      const v = alb[c] * tone * cav * (key * ndl + fill) * (1 - rough * 0.05);
      L += v * [0.2126, 0.7152, 0.0722][c];
    }
    out[py * W + px] = srgb(Math.max(0, Math.min(1, L)));
  }
  return out;
}

const mi = process.argv.indexOf('--mpp');
const MPPS = mi >= 0 ? [Number(process.argv[mi + 1])] : [0.0015, 0.004, 0.012, 0.035];
console.log(`clast facet, SC ${SC} cyc/m, glock ${GLOCK}, gn ${GN} gt ${GT} gc ${GC}, only=${ONLY}`);
for (const mpp of MPPS) {
  const s = stats(probe(mpp), W, H);
  console.log(`  mpp ${mpp.toFixed(4)}  grad ${s.grad.toFixed(4)}  grad4 ${s.grad4.toFixed(4)}` +
    `  hf/lf ${s.ratio.toFixed(3)}  mean ${s.mean.toFixed(3)}  sd ${s.sd.toFixed(4)}` +
    `  grad/L ${(s.grad / Math.max(1e-6, s.mean)).toFixed(4)}`);
}

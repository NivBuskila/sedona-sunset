/* Designing the sky fix before touching the shader.
 *
 *   node tools/_skydesign.mjs
 *
 * What the measurements say, so the design has something to answer to:
 *
 *   The model is not cold. tools/skylut.mjs reads the LUT at 2 degrees elevation
 *   as linear 4.54 4.17 3.18 - saturation 0.300 at hue 44, a gold horizon - and at
 *   70 degrees as 0.11 0.17 0.29, saturation 0.623 at hue 221, a deep blue zenith.
 *   The warm-to-blue gradient golden hour is made of is already there.
 *
 *   The tone curve eats the warm half of it. Linear 1.9 to 4.5 all lands between
 *   cv 241 and 250, because ACES at that level has a slope of 9 to 15 cv per
 *   e-fold against 55 at linear 0.5. Nine code values for twenty degrees of sky,
 *   which is why it renders 231/231/231 at saturation 0.032. The upper sky, which
 *   is dim enough to sit where the curve still has slope, already measures
 *   encoded saturation 0.29 to 0.41 - inside the 0.30-0.45 the critique asks for.
 *   So the defect is confined to the bottom 25 degrees and it is a placement
 *   problem, not a colour problem.
 *
 *   The aureole is not narrow enough to be an aureole. A single Henyey-Greenstein
 *   lobe at g 0.76 falls 7% between half a degree and four degrees, so it makes a
 *   tabletop rather than a halo, and the disc sits on it 4% brighter than its
 *   surroundings. Real aerosol phase functions have a diffraction peak an order of
 *   magnitude narrower than their bulk, which is why src/aerial.js already carries
 *   two terms for airlight. The dome has one.
 *
 * So two changes, priced here together:
 *
 *   a chroma-preserving shoulder on the dome's radiance, which is a graduated
 *   filter - the thing a landscape photographer physically screws onto the lens
 *   for exactly this shot, and the reason their skies are not white. Applied to
 *   luminance with the ratios held, so it moves the sky down the tone scale into
 *   the region that still has slope without touching its hue. It cannot disturb
 *   the protected figures: rock, floor and shadow read their light from A.sh and
 *   A.shOpen, which are integrated from the LUT directly and never sample the
 *   dome shader.
 *
 *   a two-term phase, narrow plus broad at fixed total weight. Each HG term
 *   integrates to one over the sphere, so moving weight between them redistributes
 *   the aerosol's scattered energy in angle without creating or destroying any of
 *   it - which is what lets this buy a halo without buying brightness.
 *
 * The irradiance column is the guard on the second one and it is the reason the
 * weight is held fixed: if the dome's contribution to a horizontal surface moves,
 * the fill moves, and the shadow gate at 0.204 moves with it.
 */
import { computeAtmosphere, SUN_EL, MIE_G } from '../src/atmos.js';
import { EXPOSURE } from '../src/sky.js';
import { forward } from './tone.mjs';

const SCALE = 19;
const A = computeAtmosphere();
const { lut, SKY_W, SKY_H, mieTintRGB } = A;

const hg = (c, g) => {
  const g2 = g * g;
  return (1 - g2) / (12.5663706 * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * c), 1.5));
};
const lumOf = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = ([r, g, b]) => { const m = Math.max(r, g, b); return m > 0 ? (m - Math.min(r, g, b)) / m : 0; };
const hue = ([r, g, b]) => {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
};
const enc = (c) => forward(c, EXPOSURE);
const cv = (c) => enc(c).map((v) => Math.round(255 * v));

/** Phase: single term as shipped, or two-term at conserved weight. */
const phase = (ca, P) => P.wN === 0 ? hg(ca, P.gB)
  : (1 - P.wN) * hg(ca, P.gB) + P.wN * hg(ca, P.gN);

/** The shoulder. Fixed point at LREF so the zenith is left alone. */
const LREF = 0.20;
const shoulder = (rgb, p) => {
  if (p >= 1) return rgb;
  const L = lumOf(rgb);
  if (L <= 1e-6) return rgb;
  const Lp = Math.pow(L, p) * Math.pow(LREF, 1 - p);
  const k = Lp / L;
  return rgb.map((v) => v * k);
};

function texel(elDeg, azDeg) {
  const el = elDeg * Math.PI / 180, y = Math.sin(el);
  const v = 0.5 + 0.5 * Math.sign(y) * Math.sqrt(Math.abs(y));
  const iy = Math.min(SKY_H - 1, Math.max(0, Math.round(v * (SKY_H - 1))));
  const ix = Math.min(SKY_W - 1, Math.max(0, Math.round(Math.abs(azDeg) / 180 * (SKY_W - 1))));
  const i = (iy * SKY_W + ix) * 4;
  const ca = Math.cos(el) * Math.cos(azDeg * Math.PI / 180) * Math.cos(SUN_EL) + y * Math.sin(SUN_EL);
  return { rgb: [lut[i] * SCALE, lut[i + 1] * SCALE, lut[i + 2] * SCALE], a: lut[i + 3], ca };
}
const skyAt = (elDeg, azDeg, P, p) => {
  const t = texel(elDeg, azDeg);
  const ph = phase(t.ca, P);
  return shoulder([0, 1, 2].map((k) => t.rgb[k] + t.a * ph * mieTintRGB[k] * SCALE), p);
};
/** Angle from the sun for a point on the sun's own bearing, by elevation. */
const skyRadial = (degFromSun, P, p) => {
  const el = SUN_EL * 180 / Math.PI + degFromSun;
  const t = texel(el, 0);
  const ca = Math.cos(degFromSun * Math.PI / 180);
  const ph = phase(ca, P);
  return shoulder([0, 1, 2].map((k) => t.rgb[k] + t.a * ph * mieTintRGB[k] * SCALE), p);
};

/** The dome's contribution to a horizontal surface. The guard on the fill. */
function irradiance(P) {
  let sum = 0;
  const N = 48;
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const el = (a + 0.5) / N * (Math.PI / 2), az = (b + 0.5) / N * Math.PI;
      const y = Math.sin(el), ch = Math.cos(el);
      const v = 0.5 + 0.5 * Math.sqrt(y);
      const iy = Math.min(SKY_H - 1, Math.round(v * (SKY_H - 1)));
      const ix = Math.min(SKY_W - 1, Math.round(az / Math.PI * (SKY_W - 1)));
      const i = (iy * SKY_W + ix) * 4;
      const ca = ch * Math.cos(az) * Math.cos(SUN_EL) + y * Math.sin(SUN_EL);
      const dw = ch * y * (Math.PI / 2 / N) * (Math.PI / N) * 2;
      sum += (SCALE * lumOf([lut[i], lut[i + 1], lut[i + 2]])
        + lut[i + 3] * phase(ca, P) * lumOf(mieTintRGB) * SCALE) * dw;
    }
  }
  return sum;
}

const SHIPPED = { wN: 0, gB: MIE_G, gN: 0 };
console.log(`\n  shipped: one lobe at g ${MIE_G}, no shoulder. exposure ${EXPOSURE}.`);
console.log(`  irradiance guard: the dome puts ${irradiance(SHIPPED).toFixed(4)} on a horizontal surface.\n`);

console.log('=== the shoulder alone: does the bottom 25 degrees come back? ===\n');
console.log('  elev    p=1.00 (shipped)        p=0.70                  p=0.55                  p=0.45');
console.log('          cv        sat  hue      cv        sat  hue      cv        sat  hue      cv        sat  hue');
for (const e of [2, 5, 8, 12, 18, 25, 35, 50, 70]) {
  const cols = [1.0, 0.70, 0.55, 0.45].map((p) => {
    const c = skyAt(e, 0, SHIPPED, p), q = cv(c), n = enc(c);
    return `${q.map((v) => String(v).padStart(3)).join(' ')} ${sat(n).toFixed(3)} ${hue(n).toFixed(0).padStart(3)}`;
  });
  console.log(`  ${String(e).padStart(3)}\u00b0   ${cols.join('   ')}`);
}

console.log('\n=== the two-term phase: is there a halo, and does the fill survive ===\n');
const CANDS = [
  ['shipped, one lobe g 0.76', { wN: 0, gB: 0.76, gN: 0 }],
  ['narrow 0.15 @ 0.93 / 0.70', { wN: 0.15, gB: 0.70, gN: 0.93 }],
  ['narrow 0.25 @ 0.93 / 0.68', { wN: 0.25, gB: 0.68, gN: 0.93 }],
  ['narrow 0.25 @ 0.96 / 0.70', { wN: 0.25, gB: 0.70, gN: 0.96 }],
  ['narrow 0.35 @ 0.95 / 0.62', { wN: 0.35, gB: 0.62, gN: 0.95 }],
];
const P0 = irradiance(SHIPPED);
console.log('  variant                      cv at 0.3\u00b0  1\u00b0   2\u00b0   4\u00b0   8\u00b0  16\u00b0  |  0.3-8\u00b0 drop  |  fill');
for (const [name, P] of CANDS) {
  const at = [0.3, 1, 2, 4, 8, 16].map((d) => cv(skyRadial(d, P, 0.55))[1]);
  const ir = irradiance(P);
  console.log(`  ${name.padEnd(28)} ${at.map((v) => String(v).padStart(3)).join('  ')}  |  ` +
    `${String(at[0] - at[4]).padStart(4)} cv      |  ${((ir / P0 - 1) * 100).toFixed(1).padStart(5)}%`);
}

/* Round two. The rendered result of the pair above put the horizon at saturation
 * 0.593 hue 24 - a gold horizon, which is the win - but left the aureole nearly
 * flat inside four degrees, 236 cv falling only to 234. The two levers fight: the
 * shoulder is a power law, so it compresses every ratio by its exponent, and the
 * halo the narrow lobe had just built is a ratio like any other.
 *
 * The fix is to stop treating the diffraction peak as sky. Within a couple of
 * degrees of the sun that light *is* the sun as far as the picture is concerned -
 * it is solar glare, it is what blooms in a lens, and a photographer bracketing
 * this shot is not attenuating it with the same grad that holds the sky down. So
 * filter the dome and the broad lobe, and add the narrow lobe afterwards with the
 * disc, undimmed. Then the sky can come down as far as it needs to without taking
 * the halo with it.
 */
const splitSky = (elDeg, azDeg, P, p) => {
  const t = texel(elDeg, azDeg);
  const broad = shoulder([0, 1, 2].map((k) =>
    t.rgb[k] + t.a * (1 - P.wN) * hg(t.ca, P.gB) * mieTintRGB[k] * SCALE), p);
  return [0, 1, 2].map((k) => broad[k] + t.a * P.wN * hg(t.ca, P.gN) * mieTintRGB[k] * SCALE);
};
const splitRadial = (deg, P, p) => {
  const el = SUN_EL * 180 / Math.PI + deg;
  const t = texel(el, 0), ca = Math.cos(deg * Math.PI / 180);
  const broad = shoulder([0, 1, 2].map((k) =>
    t.rgb[k] + t.a * (1 - P.wN) * hg(ca, P.gB) * mieTintRGB[k] * SCALE), p);
  return [0, 1, 2].map((k) => broad[k] + t.a * P.wN * hg(ca, P.gN) * mieTintRGB[k] * SCALE);
};

console.log('\n=== narrow lobe as glare, added after the filter: sweep the shoulder ===\n');
const PG = { wN: 0.25, gB: 0.70, gN: 0.96 };
console.log('  p       sky cv at 12\u00b0 elev   halo 0.5\u00b0  2\u00b0    4\u00b0    8\u00b0   16\u00b0  |  0.5-8\u00b0 fall  sat@35\u00b0  sat@70\u00b0');
for (const p of [0.60, 0.52, 0.45, 0.38]) {
  const at = [0.5, 2, 4, 8, 16].map((d) => cv(splitRadial(d, PG, p))[1]);
  const s12 = cv(splitSky(12, 0, PG, p))[1];
  const s35 = sat(enc(splitSky(35, 0, PG, p))), s70 = sat(enc(splitSky(70, 0, PG, p)));
  console.log(`  ${p.toFixed(2)}         ${String(s12).padStart(3)}            ` +
    `${at.map((v) => String(v).padStart(4)).join('  ')}  |  ${String(at[0] - at[3]).padStart(4)} cv     ` +
    `${s35.toFixed(3)}    ${s70.toFixed(3)}`);
}

console.log('\n=== the recommendation, end to end ===\n');
const PICK = { wN: 0.25, gB: 0.68, gN: 0.93 }, PP = 0.55;
console.log('  by elevation on the sun\'s bearing:');
console.log('   elev     shipped cv    sat     ->   fixed cv      sat    hue');
for (const e of [2, 5, 8, 12, 18, 25, 35, 50, 70]) {
  const a = skyAt(e, 0, SHIPPED, 1.0), b = skyAt(e, 0, PICK, PP);
  console.log(`   ${String(e).padStart(3)}\u00b0    ${cv(a).map((v) => String(v).padStart(3)).join(' ')}   ${sat(enc(a)).toFixed(3)}    ->   ` +
    `${cv(b).map((v) => String(v).padStart(3)).join(' ')}   ${sat(enc(b)).toFixed(3)}  ${hue(enc(b)).toFixed(0).padStart(4)}`);
}
console.log('\n  radially from the disc:');
console.log('   from sun   shipped cv   ->  fixed cv    sat');
for (const d of [0.3, 0.5, 1, 2, 4, 8, 16, 32]) {
  const a = skyRadial(d, SHIPPED, 1.0), b = skyRadial(d, PICK, PP);
  console.log(`   ${d.toFixed(1).padStart(5)}\u00b0     ${cv(a).map((v) => String(v).padStart(3)).join(' ')}    ->  ` +
    `${cv(b).map((v) => String(v).padStart(3)).join(' ')}   ${sat(enc(b)).toFixed(3)}`);
}
console.log(`\n  fill moves ${((irradiance(PICK) / P0 - 1) * 100).toFixed(2)}%, so the gate should not.\n`);

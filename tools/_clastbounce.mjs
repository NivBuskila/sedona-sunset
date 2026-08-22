/* Does ground bounce reach a near-vertical facet at clast scale?
 *
 *   node tools/_clastbounce.mjs [--top 168 123 84] [--side 37 16 13]
 *
 * The critic's instance: a pale slab in open sunlit wash, top face at RGB (168,123,84),
 * side face at (37,16,13), about 1:5, where a real photograph is expected to carry
 * orange bounce off the lit floor and read 90 to 110 in red.
 *
 * Terrain has already shown the render is faithful to the prediction, and that deleting
 * the whole clast occlusion chain moves the pixel only to about (13,9,7). So the render
 * is drawing what it is told. **The open question is whether what it is told is right,
 * and that is this file's atmosphere.**
 *
 * Everything here is a **ratio of the side facet to the top facet**, and that choice is
 * the whole design. Absolute code values cannot be trusted from here: sky.js multiplies
 * both the sun and the SH probe by SCALE = 19, and post applies a grade this file does
 * not model. Solving the slab's albedo from the measured top face recovers 17.1x the
 * known rock albedo against a pipeline SCALE of 19x, which is a 10% agreement on an
 * uncalibrated chain and a good sign - but it is not good enough to quote a code value
 * from. **In a side/top ratio, SCALE cancels exactly, and so does albedo, because the
 * top and the side of one slab are the same material.** What is left is transport.
 *
 * The ratio is then read three ways, which is what makes it decisive rather than
 * suggestive:
 *
 *   model     what this atmosphere delivers to the two normals
 *   render    the critic's measured pair, inverted through ACES at the shipped exposure
 *   physics   what a vertical facet beside an infinite *sunlit* floor must receive
 *
 * The physics column needs no model at all, which is why it can arbitrate. A vertical
 * surface's hemisphere is split by the horizontal plane into two halves of pi/2 each. If
 * the lower half is a uniform Lambertian floor of radiance L, the facet receives
 * pi/2 * L, and that floor's own radiance is L = albedo_g * E_floor / pi. So the ground's
 * share of the vertical facet's irradiance, as a fraction of the floor's own irradiance,
 * is exactly **albedo_g / 2** - no atmosphere, no sun position, no exposure. In red that
 * is 0.335/2 = 0.168, and it is a hard number the model can be held against.
 *
 * Note while reading the model column that src/atmos.js already uses precisely that
 * pi/2 * groundRGB form for the *escarpment* term, at a fully sunlit floor. The local
 * ground term is the one admitted at floorSunlit.
 */
import { computeAtmosphere, GROUND_ALBEDO, SUN_DIR } from '../src/atmos.js';
import { inverse, forward } from './tone.mjs';

const EXPOSURE = 0.95;                                   // sky.js EXPOSURE
const argv = process.argv.slice(2);
const grab = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i < 0 ? d : argv.slice(i + 1, i + 4).map(Number);
};
const TOP = grab('top', [168, 123, 84]);
const SIDE = grab('side', [37, 16, 13]);
/* The critic asks for "90 to 110 in red" on a facet "carrying orange bounce off the lit
   floor". A red channel on its own cannot be inverted - the ACES matrices couple the
   channels, so feeding (100,0,0) to the inverse invents a radiance no real pixel has. So
   take the ask at the top face's own chromaticity, which is what bounce off that floor
   would actually be, scaled until red lands at 100. */
const WANT_R = Number(grab('want', [100])[0]);

function irr(sh, n) {
  const c = sh.coefficients, out = [0, 0, 0];
  const b = [
    0.886227, 1.023328 * n[1], 1.023328 * n[2], 1.023328 * n[0],
    0.858086 * n[0] * n[1], 0.858086 * n[1] * n[2],
    0.247708 * (3 * n[2] * n[2] - 1), 0.858086 * n[0] * n[2],
    0.429043 * (n[0] * n[0] - n[1] * n[1]),
  ];
  for (let k = 0; k < 9; k++) {
    out[0] += b[k] * c[k].x; out[1] += b[k] * c[k].y; out[2] += b[k] * c[k].z;
  }
  return out;
}
const unit = (v) => { const L = Math.hypot(...v); return v.map((x) => x / L); };
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const f3 = (v, d = 3) => v.map((x) => x.toFixed(d).padStart(d + 4)).join(' ');

/* Away from the sun and near-vertical: the darkest facet a clast has, and the one the
   critic measured. y = 0.10 rather than 0 so it is a slab side and not a knife edge. */
const nSide = unit([-SUN_DIR.x, 0.10, -SUN_DIR.z]);
const nTop = [0, 1, 0];
const cosTop = Math.max(0, SUN_DIR.y);

const A = computeAtmosphere({ decompose: true });

/* Self-check before anything is believed: the model's own top-face irradiance must agree
   with the irradiance implied by its own sunlit-floor radiance, since groundSpec is built
   as albedo * E_floor / pi. If these two disagree the model is inconsistent with itself
   and no ratio below means anything. */
const Etop = [0, 1, 2].map((k) => A.sunRGB[k] * cosTop + irr(A.sh, nTop)[k]);
const EtopFromGround = [0, 1, 2].map((k) => Math.PI * A.groundRGB[k] / GROUND_ALBEDO[k]);
console.log(`\n  self-check: top-face irradiance two ways`);
console.log(`    sun*sin(el) + probe up   ${f3(Etop, 4)}`);
console.log(`    pi * groundRGB / albedo  ${f3(EtopFromGround, 4)}`);
const skew = Math.max(...[0, 1, 2].map((k) => Math.abs(Etop[k] / EtopFromGround[k] - 1)));
console.log(`    agree to ${(100 * skew).toFixed(1)}%` +
  (skew > 0.25 ? '   <- inconsistent, treat everything below as suspect' : '   (consistent)'));

/* Second candidate mechanism, independent of the constant's value: the ground is a
   hemisphere of near-uniform radiance, and an order-2 SH probe cannot represent a sharp
   hemisphere split. If the projection is losing the ground term on a near-horizontal
   normal, that is an omission at exactly this geometry and no constant will fix it.
   The test is exact and needs no atmosphere: for a uniform lower hemisphere the
   cosine-weighted irradiance is pi*L straight down and pi/2*L on a vertical, so the
   ratio must be 2. Anything well over 2 is the projection eating the term. */
{
  const dn = irr(A.shGround, [0, -1, 0]), sd = irr(A.shGround, nSide);
  console.log(`\n  SH faithfulness of the ground term at this geometry`);
  console.log(`    irradiance straight down / on the near-vertical   ` +
    `${(dn[0] / sd[0]).toFixed(2)}   (exact answer 2.00)`);
}

/* ── the three readings of the side/top ratio ─────────────────────────────── */
/* The band no longer travels in the SH probe - it is delivered analytically in sky.js,
   because an order-2 projection cannot hold a thin annulus. So the model's fill is the
   probe plus the band, and this must mirror the shader or the prediction is of a build
   that does not exist. F is the fitted geometric factor from tools/_bandfit.mjs. */
const bandF = (ny) => Math.max(0, (1 - ny) * (0.512659 + ny * (0.406724 + ny * (0.115671 +
  ny * (0.108816 + ny * (0.229111 + ny * (0.247205 + ny * 0.013122)))))));
const fillOn = (Ax, n) => {
  const E = irr(Ax.sh, n), f = bandF(n[1]);
  return [0, 1, 2].map((k) => E[k] + Ax.bandExcess[k] * f);
};
const rModel = (Ax) => {
  const E = fillOn(Ax, nSide);
  return [0, 1, 2].map((k) => E[k] / Etop[k]);
};
const topLin = inverse(TOP.map((x) => x / 255), EXPOSURE);
const sideLin = inverse(SIDE.map((x) => x / 255), EXPOSURE);
const rRender = [0, 1, 2].map((k) => sideLin[k] / topLin[k]);
const WANT = TOP.map((x) => x * WANT_R / TOP[0]);
const wantLin = inverse(WANT.map((x) => x / 255), EXPOSURE);
const rWant = wantLin[0] / topLin[0];

const rGroundPhys = GROUND_ALBEDO.map((a) => a / 2);
const Eup = irr(A.shSky, nSide), Ewl = irr(A.shWall, nSide);
const rPhysCeil = [0, 1, 2].map((k) => rGroundPhys[k] + (Eup[k] + Ewl[k]) / Etop[k]);

console.log(`\n  side / top irradiance ratio - SCALE, exposure and albedo all cancel`);
console.log(`                                       R      G      B`);
console.log(`  model, as shipped               ${f3(rModel(A))}`);
console.log(`  render, critic's measured pair  ${f3(rRender)}`);
console.log(`  physics, ground half alone      ${f3(rGroundPhys)}   <- albedo_g / 2, no model`);
console.log(`  physics, + this corridor above  ${f3(rPhysCeil)}   <- sunlit floor below`);
console.log(`  critic's ask, red only          ${rWant.toFixed(3).padStart(7)}`);

/* ── where the fill on that facet comes from, and the one constant that governs it ── */
/* A code value for each ratio, anchored on the measured side pixel rather than computed
   from scratch. Scaling a real pixel from the delivered frame by a ratio of ratios keeps
   post's grade in the answer to first order, which an absolute forward pass cannot. */
/* Anchored on the *ablated* model, not the shipped one. The measured 37,16,13 came off
   the delivered build, which did not have the two-zone ground in it, so that is the
   build the anchor has to correspond to. Anchoring on the new model instead would make
   the "after" column reproduce the measurement exactly and by construction - a baseline
   is a measurement and it expires the moment the thing it measured changes. */
const rShip = rModel(computeAtmosphere({ groundBand: false, decompose: true }));
const cvAt = (r) => {
  const lin = [0, 1, 2].map((k) => sideLin[k] * r[k] / rShip[k]);
  return forward(lin, EXPOSURE).map((x) => Math.round(255 * x));
};

console.log(`\n  the fill arriving on the near-vertical facet`);
console.log('  floorSunlit   ground%  sky%  wall%   side/top R   % of ceiling   predicted RGB');
for (const fs of [0.05, 0.15, 0.30, 0.50, 0.70]) {
  const Ax = computeAtmosphere({ floorSunlit: fs, decompose: true });
  const g = irr(Ax.shGround, nSide), s = irr(Ax.shSky, nSide), w = irr(Ax.shWall, nSide);
  const E = irr(Ax.sh, nSide), tot = lum(E);
  const r = [0, 1, 2].map((k) => E[k] / Etop[k]);
  const cv = cvAt(r);
  console.log(`     ${fs.toFixed(2)}${fs === 0.05 ? ' *' : '  '}     ` +
    `${(100 * lum(g) / tot).toFixed(1).padStart(6)} ${(100 * lum(s) / tot).toFixed(1).padStart(5)}` +
    ` ${(100 * lum(w) / tot).toFixed(1).padStart(6)}     ${r[0].toFixed(3).padStart(6)}` +
    `       ${(100 * r[0] / rPhysCeil[0]).toFixed(0).padStart(4)}%       ` +
    `${String(cv[0]).padStart(4)}${String(cv[1]).padStart(5)}${String(cv[2]).padStart(5)}`);
}
console.log('  * shipped.  The open wash floor is measured 0.70 sunlit (fillprobe.mjs --floor).');
console.log(`\n  what the endpoints look like in code values`);
console.log(`    measured now                       ${SIDE.join(' ')}`);
console.log(`    physics ceiling, sunlit floor       ${cvAt(rPhysCeil).join(' ')}` +
  `   <- correct transport at this geometry`);
console.log(`    the critic's ask                    ${WANT.map((x) => Math.round(x)).join(' ')}` +
  `   <- ratio ${rWant.toFixed(3)}, against a ceiling of ${rPhysCeil[0].toFixed(3)}`);

/* ── the two-zone ground, A/B in one process ──────────────────────────────────
 * The lower hemisphere is not one radiance. Below the shadow line it is the near,
 * self-shadowed floor; above it, out to the horizon, it is the open sunlit wash. The SH
 * projection then works out the normal dependence on its own, and the point of this
 * table is that the dependence is the guardrail: the facet the critic measured must
 * move, and the corridor wall face the same critic endorses must not. */
{
  const OFF = computeAtmosphere({ groundBand: false, decompose: true });
  const ON = A;
  const NRM = {
    'clast side, near-vertical': nSide,
    'wall face, across canyon': unit([0.94, 0.20, -0.28]),
    'wall face, away from sun': unit([0.34, 0.20, 0.92]),
    'underside, looking down': [0, -1, 0],
    'floor / slab top, up': nTop,
  };
  /* Chroma of the light *after* it reflects off the rock, which is what a critic reads,
     and quoted as an absolute hue with its saturation beside it - a hue angle without its
     chroma magnitude has been the wrong answer in this project twice. The retired attempt
     at a flat 0.70 is on record as taking a shaded vertical to hue 331, so the absolute
     value is the figure that matters here, not the shift. */
  const ROCK = [0.2890, 0.1617, 0.1211];
  const chroma = (E) => {
    const c = [0, 1, 2].map((k) => ROCK[k] * E[k] / Math.PI);
    const mx = Math.max(...c), mn = Math.min(...c);
    let h = 0, d = mx - mn;
    if (d > 1e-12) {
      if (mx === c[0]) h = 60 * (((c[1] - c[2]) / d) % 6);
      else if (mx === c[1]) h = 60 * ((c[2] - c[0]) / d + 2);
      else h = 60 * ((c[0] - c[1]) / d + 4);
    }
    return { h: (h + 360) % 360, s: mx > 0 ? d / mx : 0 };
  };
  console.log(`\n  the two-zone ground, against the same build with it ablated`);
  console.log('  normal                       fill lum  off -> on    side/top R       hue      sat');
  for (const [label, n] of Object.entries(NRM)) {
    const eo = fillOn(OFF, n), en = fillOn(ON, n);
    const qo = chroma(eo), qn = chroma(en);
    console.log(`  ${label.padEnd(28)}${lum(eo).toFixed(4)} -> ${lum(en).toFixed(4)}` +
      `  x${(lum(en) / lum(eo)).toFixed(2)}` +
      `  ${(eo[0] / Etop[0]).toFixed(3)} -> ${(en[0] / Etop[0]).toFixed(3)}` +
      `  ${qo.h.toFixed(0).padStart(4)}->${qn.h.toFixed(0).padStart(4)}` +
      `  ${qo.s.toFixed(3)}->${qn.s.toFixed(3)}`);
  }
  /* Can an order-2 SH probe hold the band, or does it have to be delivered analytically?
   *
   * The first version of this check said the probe lost 63% of it, and that figure was
   * wrong in a way worth leaving on the record. It integrated the environment by brute
   * force using the *sunlit fraction* as the radiance - 0.70 in the band against 0.05
   * below it, a ratio of fourteen. The actual radiances are
   * albedo * (frac * sun * sin(el) + skyIrradiance) / pi, and that additive sky term does
   * not scale with the fraction at all, so the real ratio between the two zones is about
   * 3.3, not 14. The toy model inflated the band's contribution by four and the "loss"
   * was the gap between a delivered truth and an invented target. A mechanism that
   * explains a number - order-2 SH cannot hold a thin annulus, which is true in general -
   * is not evidence that the number is real.
   *
   * Done properly there is no integral to do. The band's radiance is uniform over the
   * band and the floor's is uniform below it, so for any normal the exact irradiance is
   *     E_on = E_off + bandExcess * F(ny)
   * where F is the band's own cosine-weighted geometric factor from tools/_bandfit.mjs.
   * That identity *is* the analytic term sky.js evaluates, so the analytic delivery is
   * exact by construction and the only open question is how closely the probe tracks it. */
  /* Measured SH figures from commit 0b4f84d, where the same environment was routed
     through the probe instead: vertical x2.06, underside x1.26, up normal x1.02. */
  const SH_WAS = {
    'clast side, near-vertical': 2.06,
    'wall face, across canyon': 2.14,
    'wall face, away from sun': 2.14,
    'underside, looking down': 1.26,
    'floor / slab top, up': 1.02,
  };
  console.log(`\n  the band's effect on the ground term, exact against the SH route`);
  console.log('  normal                       exact    via probe (0b4f84d)   probe error');
  for (const [label, n] of Object.entries(NRM)) {
    const g0 = irr(OFF.shGround, n)[0];
    if (g0 < 1e-7) {
      console.log(`  ${label.padEnd(28)} an up normal sees no ground: exact is x1.000 exactly,` +
        ` the probe returned x${SH_WAS[label].toFixed(2)}`);
      continue;
    }
    const ex = 1 + ON.bandExcess[0] * bandF(n[1]) / g0;
    const sh = SH_WAS[label];
    console.log(`  ${label.padEnd(28)} x${ex.toFixed(3)}         x${sh.toFixed(3)}` +
      `            ${(100 * (sh / ex - 1) >= 0 ? '+' : '') + (100 * (sh / ex - 1)).toFixed(1)}%`);
  }
  console.log('  The probe tracked the exact answer to a few percent on every normal that');
  console.log('  sees ground. It is delivered analytically anyway, because the identity is');
  console.log('  exact and because F(ny) is structurally zero on an up normal where the');
  console.log('  probe returned x1.02 - a spurious lift on every sunlit floor pixel.');

  console.log(`\n  clast side facet in code values   ${cvAt(rModel(OFF)).join(' ')}  ->  ` +
    `${cvAt(rModel(ON)).join(' ')}    (ceiling ${cvAt(rPhysCeil).join(' ')}, ` +
    `critic's ask ${WANT.map((x) => Math.round(x)).join(' ')})`);
}

console.log(`\n  read the model row against the physics rows, not against the frame. If the`);
console.log('  model sits far under albedo_g/2 the ground term is being under-delivered at');
console.log('  this geometry; if it sits at the ceiling the transport is right and the');
console.log('  difference from a photograph is somewhere else.');

/* Is there any blue left in the illuminant to find, and would splitting the
 * occlusion release it?
 *
 *   node tools/_probesplit.mjs
 *
 * The lead being tested: `reflectedLight.indirectDiffuse` is multiplied by a single
 * occlusion scalar, but the light it scales arrives from three sources with very
 * different visibility from inside a crevice - sky through a narrow slot overhead,
 * escarpment bounce off nearby wall, and ground bounce. Collapsing them onto one
 * factor necessarily preserves their ratio at every occlusion depth, so it cannot
 * produce the shift toward skylight that a real slot has. Giving the sky term its own
 * less aggressive occlusion would, and that is a correction rather than a knob.
 *
 * The falsification stated in CONTRACT.md was to bin a rendered window by tAO and read
 * B/R. That test needs a per-pixel tAO the frame does not carry, and it also cannot
 * answer the question that decides whether to spend the remaining time - **how much
 * blue is available at all.** So the test here is the analytic one, on the real
 * atmosphere: reflect each illuminant off the rock albedo on its own and read the
 * chroma. That is decisive in the honest direction, because the ceiling on any
 * reweighting is the sky-only case. **If sky-only reflected light is not markedly
 * bluer and less saturated than the mix, no reweighting of any kind can help, the
 * lead is dead, and warm shade in this corridor is a fact about the corridor.**
 *
 * Two cautions this tool is built around, both learned the hard way in this file's
 * neighbours. Absolute levels here are NOT comparable to a rendered figure: this is one
 * flat albedo on one normal in scene-linear, and the contract's rendered numbers are a
 * textured population through ACES and an 8-bit encode. `_litguard.mjs` says so in its
 * footer and its 0.468 was quoted against a rendered 0.638 anyway, which is the same
 * category error twice in one night. **Read the columns against each other, never
 * against the frame.** And saturation is quoted with B/R beside it, because a hue angle
 * or a saturation on its own has been wrong here before.
 */
import { computeAtmosphere } from '../src/atmos.js';

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  let hh = (h + 360) % 360; if (hh > 180) hh -= 360;
  return { h: hh, s: mx > 0 ? d / mx : 0 };
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

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

const ROCK = [0.2890, 0.1617, 0.1211];
const A = computeAtmosphere({ decompose: true });

/* Check the split is exact before believing anything computed from it: the three
   components must add back to the probe they came out of. */
{
  let worst = 0;
  for (let k = 0; k < 9; k++) for (const ax of ['x', 'y', 'z']) {
    const s = A.shSky.coefficients[k][ax] + A.shWall.coefficients[k][ax] +
      A.shGround.coefficients[k][ax];
    worst = Math.max(worst, Math.abs(s - A.sh.coefficients[k][ax]) /
      Math.max(1e-9, Math.abs(A.sh.coefficients[k][ax])));
  }
  console.log(`\n  decomposition closes to ${(100 * worst).toFixed(4)}% of the summed probe` +
    (worst > 1e-6 ? '   <- NOT EXACT, everything below is suspect' : '   (exact)'));
}

/* A shaded wall face: lateral normal, no direct sun on it at all. This is the
   population wall_shade's rock window is made of. */
const NRM = {
  'wall facing across, shaded': [0.94, 0.20, -0.28],
  'wall facing away from sun': [0.34, 0.20, 0.92],
  'floor, up': [0, 1, 0],
};

const refl = (E) => [0, 1, 2].map((k) => ROCK[k] * E[k] / Math.PI);

for (const [label, n0] of Object.entries(NRM)) {
  const n = [...n0]; const L = Math.hypot(...n);
  for (let k = 0; k < 3; k++) n[k] /= L;

  const Esky = irr(A.shSky, n), Ewall = irr(A.shWall, n), Egnd = irr(A.shGround, n);
  const Emix = irr(A.sh, n);

  console.log(`\n  ${label}`);
  console.log('  illuminant            share of fill      hue      sat      B/R');
  const show = (nm, E, share) => {
    const c = refl(E), q = hsv(...c);
    console.log(`  ${nm.padEnd(22)}${share == null ? '      -' : (100 * share).toFixed(1).padStart(6) + '%'}` +
      `      ${q.h.toFixed(1).padStart(6)}   ${q.s.toFixed(3)}   ${(c[2] / Math.max(1e-9, c[0])).toFixed(3)}`);
  };
  const tot = lum(Emix);
  show('sky only', Esky, lum(Esky) / tot);
  show('escarpment only', Ewall, lum(Ewall) / tot);
  show('ground bounce only', Egnd, lum(Egnd) / tot);
  show('all three (shipped)', Emix, 1);

  /* The reweighting sweep. vWall is the escarpment's visibility relative to the
     sky's; 1.0 is what ships. This is the *ceiling* on what splitting the occlusion
     could deliver, because it holds sky at full visibility throughout. */
  console.log('  --- holding sky at full visibility, closing the escarpment down ---');
  for (const vW of [1.0, 0.7, 0.5, 0.3, 0.15, 0.0]) {
    const E = [0, 1, 2].map((k) => Esky[k] + vW * Ewall[k] + vW * Egnd[k]);
    const c = refl(E), q = hsv(...c);
    console.log(`    escarpment x ${vW.toFixed(2)}` +
      `    hue ${q.h.toFixed(1).padStart(6)}   sat ${q.s.toFixed(3)}` +
      `   B/R ${(c[2] / Math.max(1e-9, c[0])).toFixed(3)}` +
      `   fill luminance x ${(lum(E) / tot).toFixed(2)}`);
  }
}

console.log('\n  Read across, not against the frame. The bottom row of each sweep is the');
console.log('  sky-only ceiling: no occlusion split can go past it, because a split can');
console.log('  only ever remove escarpment relative to sky, never add sky that is not there.');

/* ── the landable form ───────────────────────────────────────────────────────
 * The sweep above changes brightness as well as colour, and brightness is spoken
 * for: the shadow gate is a luminance ratio sitting mid-band at 0.211 and the whole
 * project has been defending it. So solve for the split that **preserves luminance
 * exactly** and only moves chroma. Then the correction cannot touch the gate at all,
 * and because it is unity at full visibility it cannot touch lit rock either - the
 * same two properties the Jimenez curve was chosen for.
 *
 * Physically: local relief occludes grazing directions long before it occludes the
 * zenith - a pit's own rim cuts the horizon and leaves the slot overhead open. The
 * escarpment lives in a band near the horizon and the sky lives overhead, so a single
 * scalar necessarily over-occludes the sky and under-occludes the warm bounce. What
 * comes out below is the per-channel gain that corrects that, as a function of tAO,
 * ready to fold into the one expression rock.js and terrain.js already share.
 */
const n = [0.94, 0.20, -0.28];
{ const L = Math.hypot(...n); for (let k = 0; k < 3; k++) n[k] /= L; }
const Es = irr(A.shSky, n), Ew = irr(A.shWall, n), Eg = irr(A.shGround, n);
const Ewg = [0, 1, 2].map((k) => Ew[k] + Eg[k]);

console.log('\n  luminance-preserving chroma correction, shaded lateral face');
console.log('   tAO    vSky   vWall     gain R    gain G    gain B      sat     B/R');
for (const ao of [1.0, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18]) {
  /* Sky keeps a share of its visibility that the bounce loses. One parameter, the
     grazing bias k: vWall = tAO^k, then vSky is whatever restores the luminance
     that uniform tAO would have delivered. k = 1 is exactly today's behaviour. */
  const K = 2.0;
  const vW = Math.pow(ao, K);
  const Ltarget = ao * lum([0, 1, 2].map((k) => Es[k] + Ewg[k]));
  const vS = Math.min(1, Math.max(0, (Ltarget - vW * lum(Ewg)) / Math.max(1e-9, lum(Es))));
  const Esp = [0, 1, 2].map((k) => vS * Es[k] + vW * Ewg[k]);
  const Eun = [0, 1, 2].map((k) => ao * (Es[k] + Ewg[k]));
  const g = [0, 1, 2].map((k) => Esp[k] / Math.max(1e-9, Eun[k]));
  const c = refl(Esp), q = hsv(...c);
  console.log(`  ${ao.toFixed(2)}   ${vS.toFixed(3)}   ${vW.toFixed(3)}` +
    `    ${g[0].toFixed(3)}     ${g[1].toFixed(3)}     ${g[2].toFixed(3)}` +
    `    ${q.s.toFixed(3)}   ${(c[2] / Math.max(1e-9, c[0])).toFixed(3)}`);
}
console.log('\n  gain is 1,1,1 at tAO = 1 by construction, so no lit pixel moves, and the');
console.log('  luminance of every row equals uniform tAO, so the shadow gate cannot move.');

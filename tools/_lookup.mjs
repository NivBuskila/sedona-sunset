/**
 * What pitch does the walk actually need at the end, derived from the height
 * field rather than from a frame somebody liked?
 *
 * `LIFT_DEG = 12` was chosen because the `head_up` capture at 14 degrees reads
 * as an arrival and 12 looked right walking in. That is a taste argument. This
 * is the geometry argument, and it runs in Node against the real height field
 * with no browser, which matters when the GPU is not ours to use.
 *
 * The complaint being tested is specific: at eye level in the last few metres
 * the ground you are standing on fills the bottom of the frame. So march the
 * height field forward along the centreline from the eye and measure two angles:
 *
 *   nearTop  the highest elevation angle of any ground within NEAR metres — the
 *            skyline of the hummock underfoot. Every ray below it lands on
 *            something you could touch.
 *   skyline  the highest elevation angle of anything ahead at all, which is what
 *            has to stay inside the frame.
 *
 * With a vertical field of view of 58 degrees the frame spans pitch +/- 29, so
 * the fraction of frame height eaten by near ground is a closed form, and the
 * pitch needed to hold it under a quarter of the frame falls straight out.
 */
import { WashPath } from '../src/path.js';
import { Terrain } from '../src/terrain.js';

const EYE = 1.65;          // main.js
const FOV_V = 58;          // main.js, PerspectiveCamera vertical fov
const HALF = FOV_V / 2;
const NEAR = 6;            // metres: "the ground you are standing on"
const BUDGET = 0.25;       // no more than a quarter of the frame
const DEG = 180 / Math.PI;

/* main.js: LIFT_DEG * smoothstep(t), t = (LIFT_FROM - remaining) / LIFT_FROM */
const LIFT_DEG = 12, LIFT_FROM = 45;
const implemented = (rem) => {
  const t = Math.max(0, Math.min(1, (LIFT_FROM - rem) / LIFT_FROM));
  return LIFT_DEG * t * t * (3 - 2 * t);
};

const path = new WashPath();
const terrain = new Terrain(path);
const _q = {};
const groundAt = (x, z) => terrain.heightAtQ(x, z, path.atZ(z, _q));

function angles(s) {
  const p = path.posAt(s);
  const th = path.headingAt(s);
  const ex = p.x, ez = p.z, ey = groundAt(p.x, p.z) + EYE;
  // forward = (sin th, -cos th), matching main.js
  const fx = Math.sin(th), fz = -Math.cos(th);
  let nearTop = -Math.PI / 2, skyline = -Math.PI / 2;
  for (let r = 0.5; r <= 400; r += (r < 40 ? 0.5 : 2)) {
    const h = groundAt(ex + fx * r, ez + fz * r);
    if (!Number.isFinite(h)) continue;
    const a = Math.atan2(h - ey, r);
    if (r <= NEAR && a > nearTop) nearTop = a;
    if (a > skyline) skyline = a;
  }
  return { nearTop: nearTop * DEG, skyline: skyline * DEG };
}

/* Fraction of frame height below `nearTop` at a given pitch. */
const nearFrac = (nearTop, pitch) =>
  Math.max(0, Math.min(1, (nearTop - (pitch - HALF)) / FOV_V));

/* Smallest pitch holding near ground to BUDGET of the frame, and never so high
   that the skyline leaves the top. */
function needed(a) {
  const forNear = a.nearTop + HALF - BUDGET * FOV_V;
  const ceiling = a.skyline - HALF;          // above this the skyline is out
  return { forNear, ceiling, want: Math.max(0, forNear) };
}

console.log(`\n  eye ${EYE} m, vertical fov ${FOV_V}°, "near" = within ${NEAR} m,`
  + ` budget ${(BUDGET * 100) | 0}% of frame height\n`);
console.log('     s   rem  nearTop  skyline | near%@0  need°  impl°   near%@impl');
const rows = [];
for (let s = 264; s <= path.length + 0.01; s += 6) {
  const ss = Math.min(s, path.length);
  const a = angles(ss);
  const n = needed(a);
  const rem = path.length - ss;
  const impl = implemented(rem);
  rows.push({ ss, rem, a, n, impl, at0: nearFrac(a.nearTop, 0), atI: nearFrac(a.nearTop, impl) });
}
for (const r of rows) {
  console.log(`  ${r.ss.toFixed(0).padStart(4)}  ${r.rem.toFixed(0).padStart(4)}`
    + `   ${r.a.nearTop.toFixed(1).padStart(6)}   ${r.a.skyline.toFixed(1).padStart(6)} |`
    + `   ${(r.at0 * 100).toFixed(0).padStart(3)}%  ${r.n.want.toFixed(1).padStart(5)}`
    + `  ${r.impl.toFixed(1).padStart(5)}      ${(r.atI * 100).toFixed(0).padStart(3)}%`);
}

const tail = rows.filter(r => r.rem <= 12);
const worst0 = Math.max(...rows.map(r => r.at0));
const worstI = Math.max(...rows.map(r => r.atI));
/* Two tolerances, and the difference between them is the point of the tool.
 *
 * A quarter of the frame is *taste* — I picked it — so being half a degree under
 * it proves nothing and a check that fired on that would be policing my own
 * arbitrary threshold. Being three degrees under it inside the ramp's own window
 * is a different claim: at that size the ramp is the wrong shape or the wrong
 * height, which is a thing about the geometry and not about my preferences. So
 * the shortfall is reported at 0.5° and refused at 3°.
 *
 * Losing the skyline out of the top of the frame is not taste at any size, so it
 * refuses on the first degree. */
const MATERIAL = 3;
const notes = rows.filter(r => r.impl + 0.5 < r.n.want);
const short = rows.filter(r => r.rem <= LIFT_FROM && r.impl + MATERIAL < r.n.want);
const over = rows.filter(r => r.impl > r.n.ceiling && r.n.ceiling > 0);

console.log(`\n  near ground fills up to ${(worst0 * 100).toFixed(0)}% of the frame at pitch 0`
  + ` and up to ${(worstI * 100).toFixed(0)}% under the implemented ramp`);
console.log(`  at the head itself: need ${tail.map(r => r.n.want.toFixed(1)).join(', ')}°`
  + `  implemented ${tail.map(r => r.impl.toFixed(1)).join(', ')}°`);
console.log(`  short of the ${(BUDGET * 100) | 0}% budget at all: ${notes.length} station(s)`
  + (notes.length ? ` — ${notes.map(r => `s=${r.ss.toFixed(0)} by ${(r.n.want - r.impl).toFixed(1)}°`).join(', ')}` : ''));
console.log(`  short by more than ${MATERIAL}° inside the ramp window: ${short.length}`);
console.log(`  stations where the ramp pushes the skyline out of frame: ${over.length}`);
console.log(short.length || over.length
  ? '\n  the ramp does not match the geometry — reconsider LIFT_DEG / LIFT_FROM\n'
  : '\n  the ramp clears the near ground everywhere it is asked to and never loses\n'
    + '  the skyline; the sub-degree misses are outside its window or inside taste\n');
process.exit(short.length || over.length ? 1 : 0);

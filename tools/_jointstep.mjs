/* Does the wall surface have fracture facets, or is it smooth?
 *
 * The ship critic's sharpest single observation is that bedding lines "wrap
 * around the form like grain on lathe-turned wood, instead of being cut by it" -
 * where a face turns a convex corner the laminae follow the silhouette
 * continuously rather than terminating against a fracture. Their reading of it is
 * that the laminae are a function of height alone. That reading is half right and
 * the half it gets wrong matters, because it points at the wrong fix: bedding
 * *is* a function of height on a real cliff too, beds being horizontal, and a
 * horizontal bed exposed on a convex prow really does continue round it. What a
 * real cliff has that this one does not is a surface built of joint-bounded
 * planar facets, so the bedding trace is a polyline that kinks at every joint
 * rather than a smooth curve. "Cut by it" is a statement about the *surface*, not
 * about the laminae.
 *
 * So measure the surface. Two numbers decide whether this is a fix or a rebuild:
 *
 *   1. the distribution of lateral step between adjacent columns. A fracture
 *      facet is a step of a metre or more across one 0.62 m column, which is a
 *      near-vertical face. A smooth wall has steps of a few centimetres.
 *   2. the vertical coherence of whatever steps exist. A joint is a *plane*, so a
 *      real one puts its step at the same station at every height. Steps that
 *      wander with height are roughness, not fractures, and cannot terminate a
 *      lamina.
 *
 * Number 2 is the one that cannot be argued with. If the steps are vertically
 * incoherent then there are no joint planes in the geometry at all, and no
 * strengthening of a shading term will make a bedding line stop at one.
 *
 *   node tools/_jointstep.mjs [wallL]
 */
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildWalls } = await import('../src/rock.js');

const which = process.argv[2] || 'wallL';
const path = new WashPath(), terrain = new Terrain(path);
const mesh = buildWalls(path, terrain, {}).find((m) => m.name === which);
const pos = mesh.geometry.getAttribute('position');
const att = mesh.geometry.getAttribute('aRock');
const side = which === 'wallL' ? 1 : -1;
const DS = 0.62;

function offsetAt(i) {
  const s = att.getY(i);
  const p = path.posAt(s), th = path.headingAt(s);
  return (pos.getX(i) - p.x) * Math.cos(th) * side + (pos.getZ(i) - p.z) * Math.sin(th) * side;
}

/* One lateral profile per 2 m height band, on the column grid. */
const BANDS = [];
for (let b = 4; b <= 40; b += 2) {
  const acc = new Map();
  for (let i = 0; i < att.count; i++) {
    const hy = att.getX(i);
    if (hy < b || hy >= b + 2) continue;
    const k = Math.round(att.getY(i) / DS);
    const a = acc.get(k) || [0, 0];
    a[0] += offsetAt(i); a[1]++; acc.set(k, a);
  }
  if (acc.size > 40) BANDS.push({ b, u: acc });
}

/* 1. step distribution, pooled over all bands */
const steps = [];
for (const { u } of BANDS) {
  for (const k of u.keys()) {
    if (!u.has(k + 1)) continue;
    steps.push(Math.abs(u.get(k + 1)[0] / u.get(k + 1)[1] - u.get(k)[0] / u.get(k)[1]));
  }
}
steps.sort((a, b) => a - b);
const q = (p) => steps[Math.min(steps.length - 1, Math.floor(p * steps.length))];
console.log(`${which}: ${BANDS.length} height bands, ${steps.length} column-to-column steps`);
console.log(`  lateral step over one ${DS} m column, in metres:`);
console.log(`    median ${q(0.5).toFixed(3)}   p90 ${q(0.9).toFixed(3)}   `
  + `p99 ${q(0.99).toFixed(3)}   max ${steps[steps.length - 1].toFixed(3)}`);
for (const t of [0.3, 0.6, 1.0, 1.5]) {
  const n = steps.filter((s) => s >= t).length;
  const ang = (Math.atan(t / DS) * 180 / Math.PI).toFixed(0);
  console.log(`    steps >= ${t.toFixed(1)} m (face tilted ${ang} deg from the wall): `
    + `${n}  = ${(100 * n / steps.length).toFixed(2)}%`);
}

/* 2. vertical coherence. For each band, mark the stations whose step is in the
   top 2% of that band; a joint plane would put the same station in the top 2% of
   every band it cuts. Measured as the fraction of marked stations in one band
   that are also marked within one column in the band above. */
const marks = BANDS.map(({ b, u }) => {
  const rows = [...u.keys()].filter((k) => u.has(k + 1)).map((k) =>
    [k, Math.abs(u.get(k + 1)[0] / u.get(k + 1)[1] - u.get(k)[0] / u.get(k)[1])]);
  rows.sort((x, y) => y[1] - x[1]);
  return { b, set: new Set(rows.slice(0, Math.max(3, Math.round(rows.length * 0.02))).map((r) => r[0])),
    n: rows.length };
});
let pairs = 0, held = 0;
for (let i = 1; i < marks.length; i++) {
  for (const k of marks[i].set) {
    pairs++;
    if ([k - 1, k, k + 1].some((j) => marks[i - 1].set.has(j))) held++;
  }
}
const density = marks[0].set.size / marks[0].n;
console.log(`\n  vertical coherence of the steepest 2% of steps:`);
console.log(`    ${held}/${pairs} = ${(100 * held / pairs).toFixed(0)}% persist into the band below`);
console.log(`    chance at this density is about ${(100 * 3 * density).toFixed(0)}%`);
console.log(`\n  A joint plane holds its station over its whole height, so a wall with real`);
console.log(`  fractures scores far above chance here. At or near chance means the steepest`);
console.log(`  places are roughness that wanders with height, and there is no plane for a`);
console.log(`  lamina to terminate against.`);

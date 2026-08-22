/* Does a plant actually break the skyline, and by how much — in two seconds.
 *
 *   node tools/_skyveg.mjs shade_far
 *   node tools/_skyveg.mjs bend --deg 40
 *
 * `tools/_skyenv.mjs` established the shape of the problem: `shade_far`'s left
 * skyline is wallL seen end-on, so the silhouette is the upper *envelope* of the
 * crest over every station inside a screen column, not the crest profile, and no
 * subtractive notching of the rock can break it. The remedy is something standing
 * above the envelope. This answers whether anything does.
 *
 * The method is the same binning, run twice and subtracted. For each half-degree
 * of bearing off the view axis: the maximum elevation angle over every rock vertex
 * in that bin, which is the silhouette the rock draws; then the maximum elevation
 * angle over the *top* of every vegetation instance in that bin, where the top is
 * the instance's own y plus its y scale times the real bounding-box height of the
 * geometry it was assigned. Where the second exceeds the first, a plant is in the
 * sky, and the margin in degrees converts to pixels at the delivery framing.
 *
 * Two things this deliberately does not do. It does not render, so it says nothing
 * about whether the plant is *legible* — that needs a capture and an eye. And it
 * takes the whole instance list rather than the four silhouette variants
 * separately, so a plant's height is the height of the tallest variant it might
 * have been assigned; `instanceVaried` distributes by a separate stream and
 * reproducing that here would couple this tool to a detail that is allowed to
 * change. The figure is therefore an upper bound on the break, and the capture is
 * what confirms it. Stated because an upper bound quoted as a measurement is how
 * five population errors landed on this project in one night.
 */
import * as THREE from 'three';
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildWalls } = await import('../src/rock.js');
const { planVegetation, midTuftGeo, MID_SHAPES } = await import('../src/vegetation.js');
const { VIEWS } = await import('./views.mjs');

const argv = process.argv.slice(2);
const viewName = argv.find((a) => !a.startsWith('--')) || 'shade_far';
const gi = argv.indexOf('--deg');
const SPAN = gi >= 0 ? +argv[gi + 1] : 30;

const v = VIEWS.find((q) => q.name === viewName);
if (!v) { console.log(`no view ${viewName}; have ${VIEWS.map(q => q.name).join(', ')}`); process.exit(1); }

const path = new WashPath(), terrain = new Terrain(path);
const eye = path.posAt(v.d).clone();
eye.y = terrain.heightAt(eye.x, eye.z) + 1.65;

const yaw = (v.yaw * Math.PI) / 180;
const fwd = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
const axis = Math.atan2(fwd.x, -fwd.z);

const rocks = buildWalls(path, terrain, {});
const plan = planVegetation(path, terrain, rocks);

/* The tallest of the four bench silhouettes, measured rather than assumed. */
let midTop = 0;
MID_SHAPES.forEach((s, i) => {
  const g = midTuftGeo(2002 + i * 97, s);
  g.computeBoundingBox();
  midTop = Math.max(midTop, g.boundingBox.max.y);
});

const BIN = 0.5;
const bearing = (x, z) => {
  let b = ((Math.atan2(x - eye.x, -(z - eye.z)) - axis) * 180) / Math.PI;
  while (b > 180) b -= 360;
  while (b < -180) b += 360;
  return b;
};
const elev = (x, y, z) => {
  const r = Math.hypot(x - eye.x, z - eye.z);
  return { el: (Math.atan2(y - eye.y, r) * 180) / Math.PI, r };
};

/* Rock silhouette. Every wall and butte, because the envelope that matters is the
   maximum over all of them and not over the one mesh under suspicion. */
const rock = new Map();
const p = new THREE.Vector3();
for (const m of rocks) {
  const g = m.geometry;
  if (!g || !g.attributes.position) continue;
  m.updateMatrixWorld(true);
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    p.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
    const r = Math.hypot(p.x - eye.x, p.z - eye.z);
    if (r < 3) continue;
    const k = Math.round(bearing(p.x, p.z) / BIN) * BIN;
    const e = elev(p.x, p.y, p.z).el;
    const cur = rock.get(k);
    if (cur === undefined || e > cur) rock.set(k, e);
  }
}

/* Vegetation tops. */
const veg = new Map();
for (const o of plan.mid) {
  const top = o.y + o.sy * midTop;
  const k = Math.round(bearing(o.x, o.z) / BIN) * BIN;
  const e = elev(o.x, top, o.z);
  const cur = veg.get(k);
  if (!cur || e.el > cur.el) veg.set(k, { el: e.el, r: e.r, o });
}

/* Degrees to pixels at the framing critiques are written against. */
const FOV_Y = 50, H = 1440, W = 2560;
const pxPerDeg = (H / FOV_Y) * (1);   // square pixels, so the same either axis

/* Straightness, not flatness, and the distinction is the whole point.
 *
 * The first version of this looked for runs where the envelope's elevation barely
 * changed between adjacent bins. That finds horizontal skylines and misses the
 * defect: `shade_far`'s left rim *rises* across the frame, so every bin is a step
 * by that test and it reported the offending edge as broken up. The critic's own
 * statistic is deviation from a fitted straight line — "straight to within a pixel
 * and a half over hundreds of pixels" — and a line with a constant slope scores
 * zero on it. A rising ruler is exactly as artificial as a level one.
 *
 * So: every window of `WIN` bins, least-squares fit of elevation against bearing,
 * maximum absolute residual converted to pixels. Small residual over a long window
 * is the defect, whatever the slope.
 */
const WIN = 12;              // 6 degrees, ~173 px wide at the delivery framing
const straightness = (keys, from) => {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = from; i < from + WIN; i++) {
    const k = keys[i], y = rock.get(k);
    sx += k; sy += y; sxx += k * k; sxy += k * y; n++;
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  const m = (n * sxy - sx * sy) / den, c = (sy - m * sx) / n;
  let worst = 0;
  for (let i = from; i < from + WIN; i++) {
    const k = keys[i];
    worst = Math.max(worst, Math.abs(rock.get(k) - (m * k + c)));
  }
  return { worst, slope: m };
};

const keys = [...rock.keys()].filter((k) => Math.abs(k) <= SPAN).sort((a, b) => a - b);
console.log(`${viewName} (d ${v.d}, yaw ${v.yaw})   eye y ${eye.y.toFixed(2)}`);
console.log(`  tallest bench silhouette ${midTop.toFixed(2)} local units`);
console.log(`  ${pxPerDeg.toFixed(1)} px per degree at ${W}x${H}, ${FOV_Y} deg vertical\n`);
console.log('  bearing   rock el   plant el   margin      px   range');
let broken = 0, bestMargin = 0;
const flat = [];
let prevEl = null, run = 0;
for (const k of keys) {
  const re = rock.get(k);
  const ve = veg.get(k);
  const d = prevEl === null ? 99 : Math.abs(re - prevEl);
  if (d < 0.20) run++; else run = 0;
  flat.push({ k, run });
  prevEl = re;
  if (!ve) continue;
  const margin = ve.el - re;
  if (margin <= 0) continue;
  broken++;
  bestMargin = Math.max(bestMargin, margin);
  console.log(`  ${k.toFixed(1).padStart(6)}   ${re.toFixed(2).padStart(7)}` +
    `   ${ve.el.toFixed(2).padStart(8)}   ${margin.toFixed(2).padStart(6)}` +
    `  ${(margin * pxPerDeg).toFixed(0).padStart(6)}   ${ve.r.toFixed(0).padStart(4)} m`);
}
if (!broken) console.log('  nothing above the rock envelope anywhere in this span');

/* The straightest windows, which are the ones a critic will find, and whether
   anything of mine stands above each. */
const wins = [];
for (let i = 0; i + WIN <= keys.length; i++) {
  const s = straightness(keys, i);
  if (!s) continue;
  let hit = 0, best = 0;
  for (let j = i; j < i + WIN; j++) {
    const ve = veg.get(keys[j]);
    if (!ve) continue;
    const m = ve.el - rock.get(keys[j]);
    if (m > 0) { hit++; best = Math.max(best, m); }
  }
  wins.push({ a: keys[i], b: keys[i + WIN - 1], worst: s.worst, slope: s.slope, hit, best });
}
wins.sort((x, y) => x.worst - y.worst);
console.log(`\n  straightest ${WIN}-bin (${(WIN * BIN).toFixed(1)} deg) windows of the rock`);
console.log('  envelope, and whether a plant of mine stands above each:');
console.log('    bearings        max dev   slope    plants above');
for (const w of wins.slice(0, 8)) {
  console.log(`    ${w.a.toFixed(1).padStart(6)} to ${w.b.toFixed(1).padStart(6)}` +
    `   ${(w.worst * pxPerDeg).toFixed(1).padStart(5)} px` +
    `  ${w.slope.toFixed(2).padStart(6)}   ` +
    (w.hit ? `${w.hit} bins, best ${(w.best * pxPerDeg).toFixed(0)} px`
           : 'none  <- unbroken ruler'));
}
console.log(`\n  ${broken} bins broken over the span, best margin ` +
  `${bestMargin.toFixed(2)} deg = ${(bestMargin * pxPerDeg).toFixed(0)} px`);

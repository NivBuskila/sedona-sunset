/* The hero juniper's proportions and its dead/live split, without a render.
 *
 * The species reads on habit — squat, multi-stemmed, wider than tall, with a
 * large fraction of the woody surface bleached — and all of those are numbers
 * that can be checked here in a second instead of six minutes. */
import { buildTree, moundAt } from '../src/juniper.js';

const { geoms, clumps } = buildTree(20250821);

/* Gauge, and how much of it is above ground.
 *
 * "Everything in this tree is the same thickness — that alone forbids ancient"
 * was a reviewer's finding at 14x, and it could not be argued with because
 * nothing here measured girth. A limb's radius is recoverable from the geometry
 * without any bookkeeping: each ring of a swept tube shares a spine point, so
 * the mean distance from a ring's vertices to their centroid *is* the radius at
 * that station. Reported against height, and separately for what a viewer can
 * actually see, since a fat collar buried in the mound is a fat collar nobody
 * gets to look at. */
const SOIL = moundAt(0) - 0.10 + 0.055;   // mound crest in tree-local coords
const bands = [];
let rMaxAll = 0, rMaxVisible = 0, rMinTwig = 1e9;
for (const g of geoms) {
  const p = g.attributes.position.array;
  const cols = g.userData && g.userData.cols;
  const seg = cols ? cols : 0;
  if (!seg) continue;
  const rings = g.attributes.position.count / seg;
  for (let i = 0; i < rings; i++) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < seg; j++) {
      const k = (i * seg + j) * 3;
      cx += p[k]; cy += p[k + 1]; cz += p[k + 2];
    }
    cx /= seg; cy /= seg; cz /= seg;
    let r = 0;
    for (let j = 0; j < seg; j++) {
      const k = (i * seg + j) * 3;
      r += Math.hypot(p[k] - cx, p[k + 1] - cy, p[k + 2] - cz);
    }
    r /= seg;
    if (r > rMaxAll) rMaxAll = r;
    if (cy > SOIL && r > rMaxVisible) rMaxVisible = r;
    if (r < rMinTwig) rMinTwig = r;
    bands.push({ y: cy, r });
  }
}

let tris = 0, verts = 0;
let deadArea = 0, liveArea = 0;
const bb = { x: [1e9, -1e9], y: [1e9, -1e9], z: [1e9, -1e9] };

for (const g of geoms) {
  const p = g.attributes.position.array;
  const dd = g.attributes.aDead.array;
  const idx = g.index.array;
  verts += g.attributes.position.count;
  tris += idx.length / 3;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < bb.x[0]) bb.x[0] = p[i]; if (p[i] > bb.x[1]) bb.x[1] = p[i];
    if (p[i + 1] < bb.y[0]) bb.y[0] = p[i + 1]; if (p[i + 1] > bb.y[1]) bb.y[1] = p[i + 1];
    if (p[i + 2] < bb.z[0]) bb.z[0] = p[i + 2]; if (p[i + 2] > bb.z[1]) bb.z[1] = p[i + 2];
  }
  /* Triangle area, split by the dead mask at its centroid. */
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const ar = 0.5 * Math.hypot(cx, cy, cz);
    const dm = (dd[idx[t]] + dd[idx[t + 1]] + dd[idx[t + 2]]) / 3;
    if (dm > 0.5) deadArea += ar; else liveArea += ar;
  }
}

const H = bb.y[1] - bb.y[0], WX = bb.x[1] - bb.x[0], WZ = bb.z[1] - bb.z[0];
const W = Math.max(WX, WZ);
console.log(`limbs          ${geoms.length}`);
console.log(`woody verts    ${verts}   tris ${tris | 0}`);
console.log(`height         ${H.toFixed(2)} m`);
console.log(`crown width    ${WX.toFixed(2)} x ${WZ.toFixed(2)} m  (max ${W.toFixed(2)})`);
console.log(`width : height ${(W / H).toFixed(2)}   <- want > 1.0 for a Utah juniper`);
console.log(`bark area      live ${liveArea.toFixed(2)} m2   dead ${deadArea.toFixed(2)} m2`);
console.log(`dead fraction  ${(100 * deadArea / (deadArea + liveArea)).toFixed(1)} %`);

console.log(`\nsoil line      y ${SOIL.toFixed(3)} m  (mound crest, tree-local)`);
console.log(`max girth      ${(rMaxAll * 2).toFixed(3)} m dia anywhere,` +
            ` ${(rMaxVisible * 2).toFixed(3)} m above the soil`);
console.log(`thinnest twig  ${(rMinTwig * 2).toFixed(4)} m dia`);
console.log(`gauge spread   ${(rMaxVisible / rMinTwig).toFixed(1)} : 1 visible` +
            `   <- want 10-20+ for an old tree`);
/* Girth against height, so a buried collar shows up as a step at the soil line
   rather than as a number that looks fine and is not on screen. */
const steps = 8, top = Math.max(...bands.map(b => b.y));
console.log('\n girth by height   (max diameter in each band)');
for (let i = steps - 1; i >= 0; i--) {
  const lo = top * i / steps, hi = top * (i + 1) / steps;
  const inB = bands.filter(b => b.y >= lo && b.y < hi);
  if (!inB.length) continue;
  const d = Math.max(...inB.map(b => b.r)) * 2;
  const bar = '#'.repeat(Math.max(1, Math.round(d * 40)));
  console.log(`  ${lo.toFixed(2)}-${hi.toFixed(2)} m  ${d.toFixed(3)}  ${bar}` +
              (lo < SOIL ? '   (part below soil)' : ''));
}

let fol = 0, cards = 0, interior = 0;
let cy0 = 1e9, cy1 = -1e9;
for (const c of clumps) {
  fol++;
  if (c.interior) interior++;
  /* Mirrors foliageGeometry's count, floor included — without the floor this
     under-reported by about a fifth, which is the difference between a spray
     that stays joined and one that sheds its tip into the sky. */
  cards += Math.max(c.interior ? 5 : 9, Math.round(4 + c.size * 16 + 1));
  if (c.p.y < cy0) cy0 = c.p.y;
  if (c.p.y > cy1) cy1 = c.p.y;
}
console.log(`\nfoliage        ${fol} sprays (${interior} interior), ~${cards} cards` +
            ` = ~${cards * 2} tris`);
console.log(`crown spans    y ${cy0.toFixed(2)} .. ${cy1.toFixed(2)} m` +
            `   (skirt reaches ${cy0.toFixed(2)} m off the ground)`);
console.log(`TOTAL tris     ~${(tris + cards * 2) | 0}`);

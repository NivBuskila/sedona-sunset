/* The hero juniper's proportions and its dead/live split, without a render.
 *
 * The species reads on habit — squat, multi-stemmed, wider than tall, with a
 * large fraction of the woody surface bleached — and all of those are numbers
 * that can be checked here in a second instead of six minutes. */
import { buildTree } from '../src/juniper.js';

const { geoms, clumps } = buildTree(20250821);

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

let fol = 0, cards = 0, interior = 0;
let cy0 = 1e9, cy1 = -1e9;
for (const c of clumps) {
  fol++;
  if (c.interior) interior++;
  cards += Math.round(3 + c.size * 11 + 1);
  if (c.p.y < cy0) cy0 = c.p.y;
  if (c.p.y > cy1) cy1 = c.p.y;
}
console.log(`\nfoliage        ${fol} sprays (${interior} interior), ~${cards} cards` +
            ` = ~${cards * 2} tris`);
console.log(`crown spans    y ${cy0.toFixed(2)} .. ${cy1.toFixed(2)} m` +
            `   (skirt reaches ${cy0.toFixed(2)} m off the ground)`);
console.log(`TOTAL tris     ~${(tris + cards * 2) | 0}`);

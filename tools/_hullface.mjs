/* How card-like are the clast hulls, actually?
 *
 * The critic describes "a thin flat-topped plate, quasi-rectangular or
 * hexagonal, with a bright flat top face and a side face that renders pure
 * black, the top/side boundary a hard horizontal cut". That is a description of
 * geometry, not of shading: one large near-planar top facet meeting a near-
 * vertical one at a single edge gives exactly that, and no lighting change can
 * remove it because both facets are correctly lit for their orientation.
 *
 * scatter.js has fought this twice - bevel points were pushed from 0.70-1.10 to
 * 0.90-1.16 and then to 0.99-1.23, each time because points inside the hull of
 * the eight jittered corners contribute no facet at all. Both comments assert
 * the result rather than measuring it, so this measures it.
 *
 * For each angular class, over all its variants, reports:
 *   - triangle and distinct-plane counts of the hull
 *   - the area share of the single largest planar facet (coplanar triangles merged)
 *   - the area share of the largest facet whose normal is within 30 deg of up,
 *     which is the "bright flat top" the critic names
 *   - the share of surface area that is near-vertical (the "black side")
 *
 * A hull whose largest top facet is a quarter of its area reads as a card at any
 * distance where that facet spans more than a few pixels, however it is shaded.
 *
 *   node tools/_hullface.mjs
 */
import * as THREE from 'three';

// pull angularClast and the class table out of scatter.js without running the build
import { readFileSync } from 'node:fs';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const src = readFileSync(new URL('../src/scatter.js', import.meta.url), 'utf8');

/* Re-implement angularClast exactly as scatter.js has it, and assert the
   constants still match the source so this cannot silently drift. */
const EXPECT = ['0.52 + rand() * 0.58', '0.99 + rand() * 0.24', '0.78 + rand() * 0.42'];
for (const e of EXPECT) {
  if (!src.includes(e)) {
    console.error(`_hullface: scatter.js no longer contains "${e}" - this tool has drifted from the source it mirrors. Refusing to report.`);
    process.exit(2);
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function angularClast(seed, flat, bevel) {
  const rand = rng(seed);
  const pts = [];
  const ax = 1.0, ay = flat, az = 0.78 + rand() * 0.42;
  for (let i = 0; i < 8; i++) {
    pts.push(new THREE.Vector3(
      ((i & 1) ? 1 : -1) * ax * (0.52 + rand() * 0.58),
      ((i & 2) ? 1 : -1) * ay * (0.52 + rand() * 0.58),
      ((i & 4) ? 1 : -1) * az * (0.52 + rand() * 0.58)));
  }
  for (let i = 0; i < bevel; i++) {
    let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
    const j = t * (0.99 + rand() * 0.24);
    pts.push(new THREE.Vector3(dx * j, dy * j, dz * j));
  }
  return new ConvexGeometry(pts);
}

/* classes as declared in scatter.js */
const CLASSES = [
  { name: 'gravel3', flat: 0.54, bevel: 7, variants: 4 },
  { name: 'granule', flat: 0.50, bevel: 20, variants: 4 },
  { name: 'cobble', flat: 0.42, bevel: 24, variants: 4 },
  { name: 'pebble', flat: 0.50, bevel: 26, variants: 4 },
  { name: 'pavement', flat: 0.62, bevel: 26, variants: 3 },
  { name: 'slab', flat: 0.62, bevel: 34, variants: 3 },
  { name: 'boulder', flat: 0.86, bevel: 38, variants: 3 },
];

function analyse(g) {
  const p = g.attributes.position;
  const tris = p.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const faces = [];
  let total = 0;
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(p, t * 3); b.fromBufferAttribute(p, t * 3 + 1); c.fromBufferAttribute(p, t * 3 + 2);
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
    const area = n.length() * 0.5;
    if (area < 1e-12) continue;
    n.normalize();
    total += area;
    faces.push({ n: n.clone(), area, d: n.dot(a) });
  }
  // merge coplanar triangles into planes
  const planes = [];
  for (const f of faces) {
    let hit = null;
    for (const pl of planes) {
      if (pl.n.dot(f.n) > 0.9995 && Math.abs(pl.d - f.d) < 1e-4) { hit = pl; break; }
    }
    if (hit) hit.area += f.area;
    else planes.push({ n: f.n.clone(), d: f.d, area: f.area });
  }
  planes.sort((x, y) => y.area - x.area);
  const up = planes.filter(pl => pl.n.y > Math.cos(30 * Math.PI / 180));
  const vert = planes.filter(pl => Math.abs(pl.n.y) < Math.cos(60 * Math.PI / 180));
  return {
    tris, planes: planes.length, total,
    maxShare: planes[0].area / total,
    topShare: up.length ? Math.max(...up.map(pl => pl.area)) / total : 0,
    vertShare: vert.reduce((s, pl) => s + pl.area, 0) / total,
  };
}

console.log('clast hull facet analysis - area shares of the merged convex hull');
console.log('');
console.log('  class      flat bevel  tris  planes  largest  largest-top  vertical');
for (const cl of CLASSES) {
  const rows = [];
  for (let v = 0; v < cl.variants; v++) rows.push(analyse(angularClast(7717 + v * 17, cl.flat, cl.bevel)));
  const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  console.log(`  ${cl.name.padEnd(9)} ${cl.flat.toFixed(2)}  ${String(cl.bevel).padStart(3)}  ${String(Math.round(avg('tris'))).padStart(4)}   ${String(Math.round(avg('planes'))).padStart(4)}   ${(100 * avg('maxShare')).toFixed(1).padStart(5)}%      ${(100 * avg('topShare')).toFixed(1).padStart(5)}%     ${(100 * avg('vertShare')).toFixed(1).padStart(5)}%`);
}
console.log('');
console.log('"largest-top" is the biggest single planar facet within 30 deg of up:');
console.log('the bright flat top face the critic names. At 2560x1440 a cobble of');
console.log('0.19 m radius at 8 m spans roughly 90 px, so a facet at 20% of its');
console.log('area is a flat patch about 40 px across carrying one shading value.');

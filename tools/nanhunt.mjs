/* Where the juniper's non-finite vertex data comes from.
 *
 * System 4 bisected the scene graph and found `juniper-wood` responsible for
 * every NaN pixel in the frame: 33 non-finite floats in its `color` attribute
 * across 11 vertices, first at index 11565. Two pixels, but System 7's bright
 * pass divides by luminance and then blurs twice, so two NaN texels became a
 * black rectangle across the sky of an unrelated view and cost two agents a
 * day chasing a half-float overflow that was never there.
 *
 * An index into the merged buffer is not actionable — the merge concatenates
 * every limb in the tree, so 11565 could be anywhere. `buildTree` hands back
 * the limbs *before* the merge, so scanning them one at a time names the limb,
 * the ring and the attribute, and the merged index can be reconstructed by
 * accumulating counts in the same order `mergeGeometries` sees them.
 *
 * Also scans the hummock for the degenerate triangles and the zero-length
 * normal reported alongside, and checks the foliage and litter builders, since
 * whatever produces a singular frame in one is likely to in the others.
 *
 *   node tools/nanhunt.mjs
 */
import { buildTree, foliageGeometry, hummock, JUNIPER_XZ } from '../src/juniper.js';
import { WashPath } from '../src/path.js';
import { Terrain } from '../src/terrain.js';

let bad = 0;

/* Attribute scan. Reports the first few offenders per attribute with enough
 * context to find them in the builder: which limb, which ring within it, and
 * the whole vertex's worth of values rather than the single float, because a
 * NaN in one channel of a colour usually means all three came from the same
 * division. */
function scanAttrs(label, g, base) {
  const seg = g.userData && g.userData.cols;
  for (const [name, attr] of Object.entries(g.attributes)) {
    const a = attr.array, n = attr.itemSize;
    const hits = [];
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) {
        const v = (i / n) | 0;
        if (!hits.length || hits[hits.length - 1].v !== v) hits.push({ v, i });
      }
    }
    if (!hits.length) continue;
    bad++;
    const nv = hits.length;
    console.log(`\n  ${label}  attribute '${name}'  ${nv} bad vertices` +
                `  (merged index ${base + hits[0].v} first)`);
    for (const h of hits.slice(0, 6)) {
      const vals = [];
      for (let k = 0; k < n; k++) vals.push(a[h.v * n + k]);
      const ring = seg ? `ring ${(h.v / seg) | 0} of ${g.attributes.position.count / seg | 0}, ` +
                        `col ${h.v % seg}` : `vertex ${h.v}`;
      console.log(`      local ${h.v}  (${ring})  [${vals.join(', ')}]`);
    }
    if (nv > 6) console.log(`      ... and ${nv - 6} more`);
  }
}

/* Degenerate triangles and zero-length normals. A zero-area face has no
 * well-defined normal, so it is both a wasted draw and a NaN source the moment
 * anything normalises it. */
function scanTris(label, g) {
  const p = g.attributes.position.array;
  const idx = g.index ? g.index.array : null;
  const tris = idx ? idx.length / 3 : g.attributes.position.count / 3;
  let degen = 0, worst = Infinity;
  for (let t = 0; t < tris; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = p[i1 * 3] - p[i0 * 3], ay = p[i1 * 3 + 1] - p[i0 * 3 + 1],
          az = p[i1 * 3 + 2] - p[i0 * 3 + 2];
    const bx = p[i2 * 3] - p[i0 * 3], by = p[i2 * 3 + 1] - p[i0 * 3 + 1],
          bz = p[i2 * 3 + 2] - p[i0 * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const area = Math.hypot(cx, cy, cz) * 0.5;
    if (area <= 1e-12) degen++;
    else if (area < worst) worst = area;
  }
  const nrm = g.attributes.normal;
  let zero = 0;
  if (nrm) {
    for (let i = 0; i < nrm.count; i++) {
      const l = Math.hypot(nrm.array[i * 3], nrm.array[i * 3 + 1], nrm.array[i * 3 + 2]);
      if (!(l > 1e-6)) zero++;
    }
  }
  if (degen || zero) {
    bad++;
    console.log(`  ${label}  ${degen} degenerate of ${tris} triangles, ` +
                `${zero} zero-length normals  (smallest live area ${worst.toExponential(2)})`);
  }
  return { tris, degen, zero };
}

console.log('juniper-wood, limb by limb (pre-merge, so the index is actionable)');
const { geoms, clumps } = buildTree(20250821);
let base = 0;
for (let i = 0; i < geoms.length; i++) {
  scanAttrs(`limb ${i}`, geoms[i], base);
  scanTris(`limb ${i}`, geoms[i]);
  base += geoms[i].attributes.position.count;
}
console.log(`  ${geoms.length} limbs, ${base} vertices total`);

console.log('\njuniper-foliage');
const fg = foliageGeometry(clumps, 20250821);
scanAttrs('foliage', fg, 0);
scanTris('foliage', fg);

console.log('\njuniper-hummock');
const hm = hummock(new Terrain(new WashPath()), JUNIPER_XZ.x, JUNIPER_XZ.z, 20250821);
scanAttrs('hummock', hm, 0);
scanTris('hummock', hm);

console.log(bad ? `\n${bad} problem(s) found.` : '\nAll buffers finite and non-degenerate.');

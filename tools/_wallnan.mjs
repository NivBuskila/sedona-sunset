/* Are the wall meshes finite?
 *
 * wall_lit came back with no wall in it at all — terrain, junipers and sky, and
 * the cliff simply absent — which is not a colour fault however it measures. A
 * mesh disappears wholesale for one common reason: a non-finite vertex makes the
 * bounding sphere NaN, every frustum test fails, and three drops the object.
 *
 * Builds the walls in node and reports, per mesh, the first non-finite position
 * and the bounding sphere.
 *
 *   node tools/_wallnan.mjs
 */
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildWalls } = await import('../src/rock.js');

const path = new WashPath(), terrain = new Terrain(path);
const meshes = buildWalls(path, terrain, {});

for (const m of meshes) {
  const g = m.geometry;
  if (!g) { console.log(`${m.name}: no geometry`); continue; }
  const p = g.getAttribute('position');
  let bad = -1, nbad = 0;
  for (let i = 0; i < p.count; i++) {
    if (!Number.isFinite(p.getX(i)) || !Number.isFinite(p.getY(i)) || !Number.isFinite(p.getZ(i))) {
      if (bad < 0) bad = i;
      nbad++;
    }
  }
  g.computeBoundingSphere();
  const s = g.boundingSphere;
  console.log(`${m.name.padEnd(14)} verts ${String(p.count).padStart(7)}  bad ${String(nbad).padStart(6)}`
    + (bad >= 0 ? ` first@${bad} (${p.getX(bad)}, ${p.getY(bad)}, ${p.getZ(bad)})` : '')
    + `  sphere r=${s ? s.radius.toFixed(2) : 'null'} c=${s ? [s.center.x, s.center.y, s.center.z].map((v) => v.toFixed(1)).join(',') : ''}`);
}

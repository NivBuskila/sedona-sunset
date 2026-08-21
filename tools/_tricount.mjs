/* Where the triangles are, by object, offline.
 *
 * The frame went 2.68-2.80 M to 3.86-3.98 M in one window against a ~3 M
 * ceiling, and renderer.info reports one number for the whole scene, so it can
 * say the budget is blown and not say by whom. This builds every geometry-
 * bearing module in node and prints triangles per object, with instanced meshes
 * charged their full instance count the way the renderer charges them.
 *
 * No page, no GPU, no capture lock: it answers in seconds and it answers for
 * the tree as it stands rather than for whichever capture is lying around.
 *
 *   node tools/_tricount.mjs
 */
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain, buildTerrainMesh, applyScour } = await import('../src/terrain.js');
const { buildWalls, buildDistantButtes, buildTalus } = await import('../src/rock.js');
const { buildScatter } = await import('../src/scatter.js');
const { buildFarRidges } = await import('../src/farridge.js');

const path = new WashPath(), terrain = new Terrain(path);
const rows = [];

const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

function add(group, o) {
  if (!o) return;
  if (Array.isArray(o)) { for (const q of o) add(group, q); return; }
  if (o.isMesh || o.isInstancedMesh) {
    const n = o.isInstancedMesh ? (o.count ?? o.instanceMatrix.count) : 1;
    rows.push({ group, name: o.name || '(unnamed)', inst: n, per: tris(o.geometry),
                total: tris(o.geometry) * n });
  }
  if (o.children) for (const c of o.children) add(group, c);
}

const ground = buildTerrainMesh(terrain, {});
applyScour(ground, terrain);
add('terrain', ground);

const walls = buildWalls(path, terrain, {});
add('rock/walls', walls);
add('rock/buttes', buildDistantButtes(terrain, {}));
/* buildTalus makes its own material out of the texture bag, so it needs one
   with the shape makeRockMaterial reads. Nothing here samples a map; the one
   real requirement is an image whose mean luminance can be taken. */
const oneTexel = { image: { data: new Uint8Array([128, 96, 72, 255]) } };
const stubTex = {
  rock: { albedo: oneTexel, normal: oneTexel, arm: oneTexel },
  dirt: { albedo: oneTexel },
  macro: oneTexel, variance: oneTexel, grit: oneTexel,
};
add('rock/talus', buildTalus(path, terrain, { userData: { tex: stubTex } }));
add('farridge', buildFarRidges(terrain, path));

try {
  add('scatter', buildScatter(terrain, {
    ...stubTex, clast: { albedo: oneTexel, normal: oneTexel, arm: oneTexel },
  }));
} catch (e) {
  console.log('scatter: ' + (e && e.message));
}

rows.sort((a, b) => b.total - a.total);
let sum = 0;
const byGroup = new Map();
for (const r of rows) {
  sum += r.total;
  byGroup.set(r.group, (byGroup.get(r.group) || 0) + r.total);
}

console.log('object                          inst      per        total');
for (const r of rows) {
  if (r.total < 2000) continue;
  console.log(`${(r.group + ' ' + r.name).padEnd(30)} ${String(r.inst).padStart(6)} `
    + `${String(r.per).padStart(8)} ${(r.total / 1000).toFixed(0).padStart(8)}k`);
}
console.log('\nby group');
for (const [g, t] of [...byGroup].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${g.padEnd(14)} ${(t / 1e6).toFixed(3)} M   ${(100 * t / sum).toFixed(1)}%`);
}
console.log(`  ${'TOTAL'.padEnd(14)} ${(sum / 1e6).toFixed(3)} M`);

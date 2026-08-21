/* Find a triangle that faces the sun while everything around it faces away.
 *
 * The floating slab in wall_shade is owned by wallL, survives a halving of the
 * receiver-plane bias cap, and cannot be read off the normal or shadow-only
 * buffers because scene.overrideMaterial makes some large invisible foreground
 * object opaque and it fills the crop. So ask the geometry instead: a patch that
 * is brightly lit inside a fully shaded face is, if it is not a shadow leak, a
 * facet whose normal disagrees with its neighbours.
 *
 * Reports isolated sun-facing triangles by world position and size, so the ones
 * that matter can be checked against where the artefact appears.
 */
import * as THREE from 'three';
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildWalls } = await import('../src/rock.js');

const SUN_AZ = -9 * Math.PI / 180, SUN_EL = 15 * Math.PI / 180;
const L = new THREE.Vector3(
  Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL));

const path = new WashPath(), terrain = new Terrain(path);
const walls = buildWalls(path, terrain, {}).filter((m) => m.name.startsWith('wall'));

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();

for (const m of walls) {
  const p = m.geometry.getAttribute('position');
  /* Via the index buffer. Reading positions in threes assumes a non-indexed
     geometry, and creasedMesh returns an indexed one — which produced a first
     run reporting 300 m2 triangles that do not exist, because consecutive
     vertices in the buffer are not a triangle. The non-integer triangle count it
     printed for wallL was the tell. */
  const idx = m.geometry.index;
  const nt = idx ? idx.count / 3 : p.count / 3;
  const vi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  const cen = new Float32Array(nt * 3), dot = new Float32Array(nt), area = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    a.fromBufferAttribute(p, vi(t, 0)); b.fromBufferAttribute(p, vi(t, 1)); c.fromBufferAttribute(p, vi(t, 2));
    e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2);
    area[t] = n.length() * 0.5;
    n.normalize();
    dot[t] = n.dot(L);
    cen[t * 3] = (a.x + b.x + c.x) / 3;
    cen[t * 3 + 1] = (a.y + b.y + c.y) / 3;
    cen[t * 3 + 2] = (a.z + b.z + c.z) / 3;
  }

  /* Bucket by a 6 m grid so neighbourhood queries are cheap. */
  const CELL = 6, map = new Map();
  const key = (x, y, z) => (Math.floor(x / CELL) + ',' + Math.floor(y / CELL) + ',' + Math.floor(z / CELL));
  for (let t = 0; t < nt; t++) map.set(key(cen[t * 3], cen[t * 3 + 1], cen[t * 3 + 2]),
    (map.get(key(cen[t * 3], cen[t * 3 + 1], cen[t * 3 + 2])) || []).concat(t));

  const hits = [];
  for (let t = 0; t < nt; t++) {
    if (dot[t] < 0.10 || area[t] < 0.4) continue;         // not lit, or a sliver
    const cx = cen[t * 3], cy = cen[t * 3 + 1], cz = cen[t * 3 + 2];
    let lit = 0, tot = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const g = map.get(key(cx + dx * CELL, cy + dy * CELL, cz + dz * CELL));
      if (!g) continue;
      for (const q of g) { tot++; if (dot[q] > 0.05) lit++; }
    }
    if (tot >= 8 && lit / tot < 0.22) hits.push({ t, cx, cy, cz, d: dot[t], area: area[t], frac: lit / tot });
  }

  /* Cluster, so one protruding quad is reported once rather than twice. */
  hits.sort((x, y) => y.area - x.area);
  const kept = [];
  for (const h of hits) {
    if (kept.some((k) => Math.hypot(k.cx - h.cx, k.cy - h.cy, k.cz - h.cz) < 5)) continue;
    kept.push(h);
  }

  console.log('\n  ' + m.name + ': ' + nt + ' triangles, ' +
    hits.length + ' sun-facing inside a shaded neighbourhood, ' + kept.length + ' distinct patches');
  for (const h of kept.slice(0, 10)) {
    console.log('    at (' + h.cx.toFixed(1) + ', ' + h.cy.toFixed(1) + ', ' + h.cz.toFixed(1) + ')' +
      '   n.L ' + h.d.toFixed(2) + '   area ' + h.area.toFixed(1) + ' m2' +
      '   lit neighbours ' + (h.frac * 100).toFixed(0) + '%');
  }
}

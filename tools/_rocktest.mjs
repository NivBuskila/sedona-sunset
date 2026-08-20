import { WashPath } from '../src/path.js';
import { Terrain } from '../src/terrain.js';
import * as R from '../src/rock.js';

const path = new WashPath();
const terrain = new Terrain(path);
console.log('column rows', R.COLUMN_ROWS);

const t0 = Date.now();
const walls = R.buildWalls(path, terrain, {});
const buttes = R.buildDistantButtes(terrain, {});
const talus = R.buildTalus(path, terrain, {});
console.log('build ms', Date.now() - t0);

let tris = 0;
for (const m of [...walls, ...buttes]) tris += m.geometry.index.count / 3;
let ti = 0, tt = 0;
for (const m of talus) { ti += m.count; tt += m.count * (m.geometry.attributes.position.count / 3); }
console.log('wall+butte tris', tris | 0, ' talus inst', ti, 'tris', tt | 0,
            ' TOTAL', (tris + tt) | 0);
console.log('draw calls added', walls.length + buttes.length + talus.length);

/* Lateral profile of the near wall along the corridor: how far the rock stands
   off the centreline at the foot and at the rim, and how tall it is. */
const q = {};
for (const s of [0, 20, 46, 70, 92, 120, 160, 200, 240, 280, 320]) {
  const p = path.posAt(s);
  const th = path.headingAt(s);
  const row = [];
  for (const side of [1, -1]) {
    const nx = Math.cos(th) * side, nz = Math.sin(th) * side;
    /* nearest wall vertex to this station, by scanning the mesh is overkill;
       instead report the terrain profile the wall is seated on. */
    let toe = 44;
    const dat = 0.0125 * Math.max(0, s);
    for (let av = 7; av < 46; av += 0.25) {
      if (terrain.heightAt(p.x + nx * av, p.z + nz * av) >= dat + 3.0) { toe = av; break; }
    }
    row.push(toe.toFixed(1));
  }
  console.log(`s=${String(s).padStart(3)}  toeR=${row[0]}  toeL=${row[1]}`);
}

/* The section itself: lateral offset against elevation for the right wall at one
   station, which is the only way to see whether the profile is a staircase. */
{
  const m = walls[0];
  const p = m.geometry.attributes.position.array;
  const a = m.geometry.attributes.aRock.array;
  const zTarget = path.posAt(46).z;
  const bins = new Map();
  for (let i = 0; i < p.length / 3; i++) {
    if (Math.abs(p[i * 3 + 2] - zTarget) > 0.4) continue;
    const y = Math.round(a[i * 4] * 2) / 2;
    const u = Math.hypot(p[i * 3] - path.posAt(46).x, p[i * 3 + 2] - zTarget);
    if (!bins.has(y) || bins.get(y) > u) bins.set(y, u);
  }
  const keys = [...bins.keys()].sort((x, z) => x - z);
  console.log('\nsection at s=46, right wall:  colY -> lateral offset');
  for (const k of keys) if (k % 1 === 0 || Math.abs(k) < 0.6) {
    console.log(`  y=${String(k).padStart(6)}  u=${bins.get(k).toFixed(1)}`);
  }
}

/* Wall extents, and the check that matters: nothing may cross the centreline. */
for (const m of walls) {
  const p = m.geometry.attributes.position.array;
  let ylo = 1e9, yhi = -1e9, xlo = 1e9, xhi = -1e9;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1] < ylo) ylo = p[i + 1];
    if (p[i + 1] > yhi) yhi = p[i + 1];
    if (p[i] < xlo) xlo = p[i];
    if (p[i] > xhi) xhi = p[i];
  }
  console.log(m.name, 'y', ylo.toFixed(1), '..', yhi.toFixed(1), ' x', xlo.toFixed(1), '..', xhi.toFixed(1));
}
for (const m of buttes) {
  const b = m.geometry.boundingSphere;
  console.log(m.name, 'c', b.center.x.toFixed(0), b.center.y.toFixed(0), b.center.z.toFixed(0),
              'r', b.radius.toFixed(0), 'tris', (m.geometry.index.count / 3) | 0);
}

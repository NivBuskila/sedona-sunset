/* Which supporting plants land close enough to a capture viewpoint to be
   resolved as geometry rather than as a speck? The far-field blob is twenty
   flat-shaded triangles with no texture, which is correct at two hundred metres
   and indefensible at thirty, so anything it puts near a camera is a bug. Runs
   under node in about a second; no canvas, no renderer. */
import { WashPath } from '../src/path.js';
import { Terrain } from '../src/terrain.js';
import * as R from '../src/rock.js';
import { planVegetation } from '../src/vegetation.js';

const EYE = 1.65, DEG = Math.PI / 180;
const VIEWS = [
  { name: 'wash_low', d: 8, yaw: 0, pitch: -4 },
  { name: 'wash_mid', d: 46, yaw: 0, pitch: 0 },
  { name: 'ground', d: 30, yaw: 10, pitch: -38 },
  { name: 'wall_lit', d: 46, yaw: 72, pitch: 12 },
  { name: 'wall_shade', d: 46, yaw: -104, pitch: 10 },
  { name: 'bend', d: 92, yaw: -22, pitch: 2 },
  { name: 'juniper', d: 62, yaw: 34, pitch: 3 },
  { name: 'sun_gap', d: 120, yaw: 0, pitch: 6 },
];
const FOV = 58, ASPECT = 16 / 9;

const path = new WashPath();
const terrain = new Terrain(path);
const rocks = [...R.buildWalls(path, terrain, {}), ...R.buildDistantButtes(terrain, {})];
const plan = planVegetation(path, terrain, rocks);
console.log('counts', Object.fromEntries(
  Object.entries(plan).map(([k, v]) => [k, v.length])));

const q = {};
const cams = VIEWS.map(v => {
  const p = path.posAt(v.d);
  const yaw = path.headingAt(v.d) + v.yaw * DEG;
  return {
    name: v.name, x: p.x, z: p.z,
    y: terrain.heightAtQ(p.x, p.z, path.atZ(p.z, q)) + EYE,
    /* main.js: rotation.y = -yaw, so forward is (sin yaw, -cos yaw). */
    fx: Math.sin(yaw), fz: -Math.cos(yaw), pitch: v.pitch * DEG,
  };
});

/* How far out from the corridor does rock actually stand? The far height-field
   scatter is documented as covering ground "which the buttes do not cover", so
   it has to begin outside the wall footprint — inside it, the height field is
   buried under rock and anything planted there is embedded in a cliff. */
if (process.env.ROCKENV) {
  const band = new Map();
  const p = { };
  for (const m of rocks) {
    const pa = m.geometry.attributes.position;
    m.updateMatrixWorld(true);
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      if (y > 30) continue;
      const b = Math.round(z / 20) * 20;
      const qq = path.atZ(z, p);
      const u = Math.abs((x - qq.x) * Math.cos(qq.th));
      const cur = band.get(b);
      if (!cur || u > cur) band.set(b, u);
    }
  }
  console.log('\nrock footprint: |u| max per 20 m z-band (below y=30)');
  for (const b of [...band.keys()].sort((a, c) => c - a)) {
    console.log(`  z=${String(b).padStart(5)}  |u|max=${band.get(b).toFixed(0)}`);
  }
}

const tanV = Math.tan(FOV * 0.5 * DEG);
const tanH = tanV * ASPECT;

for (const kind of ['far', 'mid']) {
  console.log(`\n── ${kind} ${'─'.repeat(60)}`);
  for (const c of cams) {
    let worst = null;
    for (const o of plan[kind]) {
      const dx = o.x - c.x, dz = o.z - c.z;
      /* Along-view depth and lateral offset, ignoring pitch for the horizontal
         gate: a blob just outside the vertical frame is still worth knowing. */
      const fwd = dx * c.fx + dz * c.fz;
      if (fwd < 0.5) continue;
      const lat = Math.abs(dx * c.fz - dz * c.fx);
      if (lat > fwd * tanH * 1.15) continue;
      const dy = (o.y + o.sy * 0.5) - c.y;
      const dist = Math.hypot(dx, dz, dy);
      /* Apparent height as a fraction of frame height. */
      const frac = (o.sy / dist) / (2 * tanV);
      if (!worst || frac > worst.frac) worst = { o, dist, frac };
    }
    if (!worst) { console.log(`${c.name.padEnd(11)} none in frame`); continue; }
    const { o, dist, frac } = worst;
    console.log(`${c.name.padEnd(11)} nearest-apparent  dist=${dist.toFixed(1)}m` +
      `  h=${o.sy.toFixed(2)}m  ${(frac * 100).toFixed(2)}% of frame` +
      `  (${(frac * 900).toFixed(0)}px at 900)` +
      `  at ${o.x.toFixed(1)},${o.y.toFixed(1)},${o.z.toFixed(1)}`);
  }
}

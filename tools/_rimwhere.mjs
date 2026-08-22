/* Where in the world is that skyline edge, and where is my nearest rim plant?
 *
 *   node tools/_rimwhere.mjs shade_far 0.081,0.101 0.125,0.113 0.169,0.125
 *
 * Written after three rim-planting attempts in a row failed to touch the ruler in
 * `shade_far` while every derived measurement said they should have. The reason
 * they said so was that I was reasoning in bearings and elevations computed from
 * the view table, and those numbers disagreed with the frame by about ten degrees
 * — one unverified camera convention, three wasted captures.
 *
 * So this asks the running scene in world coordinates and skips the trigonometry
 * entirely. For each frame fraction given: raycast, report the object hit and the
 * world point. Then, for that point, the nearest instances of every `veg-mid-*`
 * mesh, in metres. If the nearest plant to the offending edge is sixty metres
 * away, that is the answer, and it is an answer no bearing histogram was going to
 * give me.
 */
import { run } from './harness.mjs';
import { VIEWS } from './views.mjs';

const a = process.argv.slice(2);
const view = a[0] || 'shade_far';
const pts = a.slice(1).map((s) => s.split(',').map(Number));
if (!pts.length) { console.error('_rimwhere: give at least one u,v'); process.exit(2); }
const v = VIEWS.find((q) => q.name === view)
  || (() => { const [d, yaw, pitch] = view.split(',').map(Number); return { d, yaw, pitch }; })();

await run({ width: 1600, height: 900, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async ([vv, ps]) => {
    const g = window.__game;
    g.walkTo(vv.d); g.lookAt(vv.yaw, vv.pitch); g.renderOnce();
    const THREE = await import('three');

    /* Every mid-tier instance, in world space, once. */
    const plants = [];
    g._scene.traverse((o) => {
      if (!o.isInstancedMesh || !/^veg-mid/.test(o.name)) return;
      const m = new THREE.Matrix4(), p = new THREE.Vector3();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        p.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        plants.push([p.x, p.y, p.z, o.name, m.elements[5]]);
      }
    });

    const rc = new THREE.Raycaster();
    const res = [];
    for (const [u, w] of ps) {
      rc.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - w * 2), g._camera);
      const hit = rc.intersectObjects(g._scene.children, true)[0];
      if (!hit) { res.push({ u, v: w, miss: true }); continue; }
      const h = hit.point;
      let best = null;
      for (const q of plants) {
        const d = Math.hypot(q[0] - h.x, q[2] - h.z);
        if (!best || d < best.d) best = { d, y: q[1], name: q[3], sy: q[4] };
      }
      res.push({
        u, v: w, obj: hit.object.name || hit.object.type,
        dist: +hit.distance.toFixed(1),
        wx: +h.x.toFixed(1), wy: +h.y.toFixed(1), wz: +h.z.toFixed(1),
        near: best && { d: +best.d.toFixed(1), y: +best.y.toFixed(1),
          sy: +best.sy.toFixed(2), name: best.name },
      });
    }
    /* The rim pass's own grid, recomputed here off the *running* scene.
       This exists because a node-side scratch that called `buildWalls(path,
       terrain, {})` reported no rock at all above y 0 where a raycast in this
       same scene hits wallL at y 46.8 — the default-argument wall built outside
       the app is not the wall the app draws, and a criterion tuned against it is
       tuned against nothing. Anything deciding where plants go has to see the
       geometry that gets rendered. */
    const CELL = 8;
    const grid = new Map();
    g._scene.traverse((o) => {
      if (!o.isMesh || !/^wall|^butte/.test(o.name)) return;
      const pa = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      if (!pa) return;
      o.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      for (let i = 0; i < pa.count; i++) {
        p.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
        if (p.z > 30 || p.z < -700) continue;
        const k = Math.round(p.x / CELL) + ':' + Math.round(p.z / CELL);
        const cur = grid.get(k);
        if (cur === undefined || p.y > cur) grid.set(k, p.y);
      }
    });
    /* No bins, no gates: the highest wall vertex within 12 m of the hit, and
       every object whose name starts `wall`. If this comes back near the hit's own
       height then the grid above is losing the geometry to its binning or its z
       cut; if it comes back far below, the raycast and the vertex buffers do not
       agree and neither does anything built on them. */
    const raw = [];
    if (res[0] && !res[0].miss) {
      const h = res[0];
      g._scene.traverse((o) => {
        if (!o.isMesh || !/^wall/.test(o.name)) return;
        const pa = o.geometry.attributes.position;
        o.updateMatrixWorld(true);
        const p = new THREE.Vector3();
        let hi = -Infinity, n = 0;
        for (let i = 0; i < pa.count; i++) {
          p.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
          if (Math.hypot(p.x - h.wx, p.z - h.wz) > 12) continue;
          n++;
          if (p.y > hi) hi = p.y;
        }
        raw.push({ name: o.name, verts: pa.count, within: n,
          hi: isFinite(hi) ? +hi.toFixed(1) : null,
          instanced: o.isInstancedMesh === true,
          mw: +o.matrixWorld.elements[13].toFixed(2) });
      });
    }

    const around = [];
    if (res[0] && !res[0].miss) {
      const cx = Math.round(res[0].wx / CELL), cz = Math.round(res[0].wz / CELL);
      for (let ix = cx - 4; ix <= cx + 4; ix++) {
        const row = [];
        for (let iz = cz - 3; iz <= cz + 3; iz++) {
          const y = grid.get(ix + ':' + iz);
          row.push(y === undefined ? null : +y.toFixed(1));
        }
        around.push({ x: ix * CELL, row });
      }
      around.zs = null;
    }
    return { n: plants.length, res, cells: grid.size, around, raw,
      zs: res[0] && !res[0].miss
        ? Array.from({ length: 7 }, (_, i) => (Math.round(res[0].wz / CELL) - 3 + i) * CELL)
        : [] };
  }, [v, pts]);

  console.log(`\n${view}  d ${v.d} yaw ${v.yaw} pitch ${v.pitch}` +
    `   ${out.n} mid-tier instances in the scene\n`);
  for (const r of out.res) {
    if (r.miss) { console.log(`  ${r.u},${r.v}  nothing hit`); continue; }
    console.log(`  ${r.u},${r.v}  ${r.obj} at ${r.dist} m` +
      `   world ${r.wx}, ${r.wy}, ${r.wz}`);
    console.log(`      nearest mid plant ${r.near.d} m away in xz,` +
      ` its y ${r.near.y} (edge y ${r.wy}), sy ${r.near.sy}, ${r.near.name}`);
  }
  if (out.raw && out.raw.length) {
    console.log('\n  wall meshes, and the highest vertex each has within 12 m of' +
      ' the first hit:');
    for (const r of out.raw)
      console.log(`    ${r.name.padEnd(10)} ${String(r.verts).padStart(8)} verts,` +
        ` ${String(r.within).padStart(6)} within 12 m, highest ${r.hi}` +
        `   instanced ${r.instanced}, world y offset ${r.mw}`);
  }
  if (out.around && out.around.length) {
    console.log(`\n  ${out.cells} cells in the rim grid.  Rock top height` +
      ` around the first point, as the rim pass sees it:`);
    console.log('      x \\ z' + out.zs.map((z) => String(z).padStart(8)).join(''));
    for (const r of out.around)
      console.log(String(r.x).padStart(9) + '  ' +
        r.row.map((y) => (y === null ? '     -  ' : y.toFixed(1).padStart(8))).join(''));
  }
});

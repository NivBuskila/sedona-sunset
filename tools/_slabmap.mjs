/* Where is the hole, and what is it a hole in?
 *
 *   node tools/_slabmap.mjs
 *
 * tools/_slab.mjs settled the ownership question and it did not come out the way
 * the routing assumed. Every sample inside the slab is geometrically *unblocked* -
 * the sun really does reach it - and every sample in the shadowed surround is
 * blocked by wallL itself, at either 1 m (local relief just above) or about 170 m
 * (a distant section of the same wall). The render agrees with the raycast at
 * every one of the nine points, so the shadow map is not failing here. The wall is
 * genuinely lit through a gap in its own occluder.
 *
 * Which means System 2's ablation could not have decided this. Turning shadows off
 * removes the occlusion, so the patch matches its surround at 1.04x whether the
 * shadow map is broken *or* the occluder has a hole in it - both give the same
 * reading. Their test cleared the receiver's normals, which it does correctly; it
 * cannot see the caster, and the caster is where this lives.
 *
 * So map the caster. Fire a ray at the sun from every cell of a grid covering the
 * slab and its surround, and print the distance to whatever stops it. The shape of
 * the gap says what kind of fault it is: a natural notch in a crest wanders, and a
 * mesh seam, a tile boundary or a missing quad is straight. The critics have been
 * calling this a parallelogram for hours, which is a strong hint already.
 */
import { run } from './harness.mjs';
import { byName } from './views.mjs';

const V = byName('wall_shade');
const W = 1600, H = 900;
const X0 = 50, X1 = 190, Y0 = 265, Y1 = 365, NX = 36, NY = 20;

await run({ width: W, height: H, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  const r = await page.evaluate(([v, w, h, X0, X1, Y0, Y1, NX, NY]) => {
    const g = window.__game, THREE = g._three, scene = g._scene, cam = g._camera;
    g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);
    cam.updateMatrixWorld(true);

    const lights = [];
    scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) lights.push(o); });
    const sun = new THREE.Vector3().subVectors(lights[0].position, lights[0].target.position).normalize();

    const targets = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name === 'sky' || !o.geometry) return;
      if (o.geometry.attributes.position.count > 5000) targets.push(o);
    });

    const rc = new THREE.Raycaster(); rc.far = 4000;
    const rows = [], blockPts = [];
    for (let j = 0; j < NY; j++) {
      const py = Y0 + (Y1 - Y0) * j / (NY - 1);
      const row = [];
      for (let i = 0; i < NX; i++) {
        const px = X0 + (X1 - X0) * i / (NX - 1);
        rc.setFromCamera(new THREE.Vector2((px + 0.5) / w * 2 - 1, 1 - (py + 0.5) / h * 2), cam);
        const hit = rc.intersectObjects(targets, false);
        if (!hit.length) { row.push('.'); continue; }
        const p = hit[0].point;
        const up = new THREE.Raycaster(p.clone().addScaledVector(sun, 0.08), sun, 0, 3000);
        const b = up.intersectObjects(targets, false);
        if (!b.length) { row.push('#'); continue; }   // lit
        const d = b[0].distance;
        if (blockPts.length < 400) {
          blockPts.push({
            d: +d.toFixed(1), name: b[0].object.name || b[0].object.type,
            bx: +b[0].point.x.toFixed(1), by: +b[0].point.y.toFixed(1), bz: +b[0].point.z.toFixed(1),
          });
        }
        row.push(d < 3 ? 'n' : d < 40 ? 'm' : d < 400 ? 'F' : 'X');
      }
      rows.push({ py: Math.round(py), s: row.join('') });
    }
    /* Summarise the far blockers: where in the world is the occluder, and how
       high does its crest reach where it stops blocking? */
    const far = blockPts.filter((q) => q.d >= 40);
    const stat = (a) => a.length ? {
      n: a.length, dmin: Math.min(...a.map((q) => q.d)), dmax: Math.max(...a.map((q) => q.d)),
      ymin: Math.min(...a.map((q) => q.by)), ymax: Math.max(...a.map((q) => q.by)),
      names: [...new Set(a.map((q) => q.name))].slice(0, 4),
    } : null;
    return { rows, farStat: stat(far), nearStat: stat(blockPts.filter((q) => q.d < 3)) };
  }, [V, W, H, X0, X1, Y0, Y1, NX, NY]);

  console.log(`\n  wall_shade, sun-ray blocker map over x ${X0}..${X1}, y ${Y0}..${Y1}`);
  console.log('    #  nothing blocks it (lit)     n  blocked within 3 m (local relief)');
  console.log('    m  blocked 3-40 m             F  blocked 40-400 m (the distant wall)\n');
  for (const q of r.rows) console.log(`   y ${String(q.py).padStart(4)}  ${q.s}`);
  if (r.farStat) {
    console.log(`\n  far occluder: ${r.farStat.n} hits, ${r.farStat.dmin}-${r.farStat.dmax} m away, ` +
      `crest y ${r.farStat.ymin}..${r.farStat.ymax}, drawn by ${r.farStat.names.join(', ')}`);
  }
  if (r.nearStat) {
    console.log(`  local relief: ${r.nearStat.n} hits, crest y ${r.nearStat.ymin}..${r.nearStat.ymax}`);
  }
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});

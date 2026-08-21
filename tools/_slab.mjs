/* The floating slab in wall_shade: correct sunlight, or a hole in the shadow map?
 *
 *   node tools/_slab.mjs
 *
 * System 2 has cleared the geometry with an ablation: the patch is 5.68x its
 * surround with shadows on and 1.04x with them off, so the normals and the surface
 * there are continuous with the wall and the whole difference is the shadow term.
 * It is drawn by wallL, and it appears in sys2m from 01:00, so it predates both the
 * butte0 move and the castShadow fix. They also tested the rpBias cap on my behalf
 * - halved it, nothing changed, reverted it.
 *
 * There are only two ways a face can be bright inside a shadowed neighbourhood.
 * Either the sun really does reach it and not its neighbours, in which case the
 * render is right and the complaint is about geometry letting a beam through; or
 * the sun reaches neither and the shadow map is failing on this patch alone, in
 * which case it is mine. Those two have opposite fixes and they are told apart by
 * one measurement, which is what this does: fire a ray from each sample point
 * toward the sun and see whether anything is actually in the way.
 *
 * Everything else here is context for whichever answer comes back. For each point
 * it also reports the clip coordinates in every shadow cascade, which cascade
 * would be selected, and the texel footprint - because if the shadow map is
 * failing, "outside the frustum" and "under-resolved" are the two candidates and
 * they look nothing alike in these columns.
 *
 * Note on instruments: _rockdiag.mjs's normals, flatnorm and shadowonly variants
 * are contaminated - something invisible in the normal render turns opaque under
 * scene.overrideMaterial and fills the foreground - so shadowonly, which is the
 * obvious tool for this, cannot be trusted. This raycasts instead.
 */
import { run } from './harness.mjs';
import { byName } from './views.mjs';

const V = byName('wall_shade');
/* The slab, and a ring of comparison points in the shadowed wall around it. */
const SLAB = { x0: 79, x1: 147, y0: 292, y1: 336 };
const W = 1600, H = 900;

await run({ width: W, height: H, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  const r = await page.evaluate(([v, S, w, h]) => {
    const g = window.__game, THREE = g._three, scene = g._scene, cam = g._camera;
    g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);
    cam.updateMatrixWorld(true);

    const lights = [];
    scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) lights.push(o); });
    lights.sort((a, b) => (a.shadow.camera.right - a.shadow.camera.left) - (b.shadow.camera.right - b.shadow.camera.left));
    const rigs = lights.map((l) => {
      const sc = l.shadow.camera;
      sc.updateMatrixWorld(true); sc.updateProjectionMatrix();
      return {
        l, sc,
        vp: new THREE.Matrix4().multiplyMatriices ? null
          : new THREE.Matrix4().multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse),
        ext: sc.right - sc.left, map: l.shadow.mapSize.x,
      };
    });
    const sun = new THREE.Vector3().subVectors(lights[0].position, lights[0].target.position).normalize();

    /* Big meshes only: there is no BVH here and the scene is 2.8M triangles. */
    const targets = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name === 'sky' || !o.geometry) return;
      if (o.geometry.attributes.position.count > 5000) targets.push(o);
    });

    const rc = new THREE.Raycaster(); rc.far = 4000;
    const probe = (px, py, label) => {
      rc.setFromCamera(new THREE.Vector2((px + 0.5) / w * 2 - 1, 1 - (py + 0.5) / h * 2), cam);
      const hit = rc.intersectObjects(targets, false);
      if (!hit.length) return null;
      const p = hit[0].point, obj = hit[0].object;
      const n = hit[0].face ? hit[0].face.normal.clone().transformDirection(obj.matrixWorld) : null;
      /* Does the sun actually reach this point? Offset along the sun so the ray
         does not immediately re-hit the face it started on. */
      const up = new THREE.Raycaster(p.clone().addScaledVector(sun, 0.08), sun, 0, 3000);
      const block = up.intersectObjects(targets, false);
      const clips = rigs.map((R) => {
        const q = p.clone().applyMatrix4(R.vp);
        return {
          in: Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && Math.abs(q.z) <= 1,
          x: +q.x.toFixed(3), y: +q.y.toFixed(3), z: +q.z.toFixed(3),
          cm: +(R.ext / R.map * 100).toFixed(1),
        };
      });
      return {
        label, px, py, obj: obj.name || obj.type, dist: +hit[0].distance.toFixed(1),
        wy: +p.y.toFixed(1), ndotl: n ? +n.dot(sun).toFixed(3) : null,
        blocked: block.length ? `${block[0].object.name || block[0].object.type}@${block[0].distance.toFixed(0)}m` : 'NOTHING',
        clips,
      };
    };

    const out = [];
    const cx = Math.round((S.x0 + S.x1) / 2), cy = Math.round((S.y0 + S.y1) / 2);
    for (const [lx, ly, lab] of [
      [cx, cy, 'slab centre'],
      [S.x0 + 8, cy, 'slab left'],
      [S.x1 - 8, cy, 'slab right'],
      [cx, S.y0 + 6, 'slab top'],
      [cx, S.y1 - 6, 'slab bottom'],
      [S.x0 - 30, cy, 'surround L'],
      [S.x1 + 30, cy, 'surround R'],
      [cx, S.y0 - 30, 'surround above'],
      [cx, S.y1 + 26, 'surround below'],
    ]) {
      const q = probe(lx, ly, lab);
      if (q) out.push(q);
    }
    return {
      out, nLights: lights.length,
      rigs: rigs.map((R) => ({
        ext: +R.ext.toFixed(0), map: R.map, near: R.sc.near, far: R.sc.far,
        cm: +(R.ext / R.map * 100).toFixed(1),
      })),
      sun: [+sun.x.toFixed(3), +sun.y.toFixed(3), +sun.z.toFixed(3)],
    };
  }, [V, SLAB, W, H]);

  console.log(`\n  wall_shade, ${r.nLights} shadow cascades, sun ${r.sun.join(' ')}`);
  for (const R of r.rigs) console.log(`    cascade ${String(R.ext).padStart(5)} m across, ${R.map}\u00b2 = ${R.cm} cm a texel, z ${R.near}..${R.far}`);
  console.log('');
  console.log('  point            obj      dist    y     n\u00b7L    sun blocked by      cascade0        cascade1');
  for (const q of r.out) {
    const c = q.clips.map((k) => `${k.in ? 'in ' : 'OUT'} ${String(k.x).padStart(6)},${String(k.y).padStart(6)},${String(k.z).padStart(6)}`);
    console.log(`  ${q.label.padEnd(15)} ${q.obj.padEnd(8)} ${String(q.dist).padStart(5)} ${String(q.wy).padStart(6)} ` +
      `${String(q.ndotl).padStart(6)}  ${q.blocked.padEnd(18)} ${c.join('  ')}`);
  }
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});

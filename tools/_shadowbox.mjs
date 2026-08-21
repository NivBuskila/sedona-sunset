/* Does the far cascade's frustum contain the things that cast into it?
 *
 *   node tools/_shadowbox.mjs
 *
 * System 2 reports a pale patch on the far wall in wall_shade that survives their
 * ablation, is absent from the normal buffer, and vanishes with shadows off. It is
 * at x 79-147, y 292-336 - a compact island with straight edges, direct-sun
 * coloured at V 0.97 in a frame whose shaded wall sits at 0.18.
 *
 * An island is the tell. A receiver outside the shadow frustum would give a
 * half-plane, since frustumTest fails on one side of a straight boundary and the
 * lit region runs off to the frame edge. A bounded island of sunlight inside a
 * shadow is the silhouette of an occluder that is *missing from the depth map* -
 * a caster outside the box, not a receiver outside it. At elevation 15 a shadow is
 * cot(15) = 3.73x the caster's height long, so a 60 m butte throws 224 m while
 * FAR_BOX spans 208 x 124 m and rides with the player. The caster can easily be
 * outside the box while its shadow lands inside.
 *
 * So this checks casters, and does it from bounding boxes rather than by
 * raycasting - the first version fired 1936 rays at 2.8M triangles with no BVH and
 * would never have finished.
 */
import { run } from './harness.mjs';
import { byName } from './views.mjs';

const V = byName('wall_shade');

await run({ width: 640, height: 360, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  const r = await page.evaluate(([v]) => {
    const g = window.__game, THREE = g._three, scene = g._scene, cam = g._camera;
    g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);
    cam.updateMatrixWorld(true);

    const lights = [];
    scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) lights.push(o); });
    const ext = (l) => (l.shadow.camera.right - l.shadow.camera.left);
    lights.sort((a, b) => ext(b) - ext(a));
    const far = lights[0];
    const sc = far.shadow.camera;
    sc.updateMatrixWorld(true);
    sc.updateProjectionMatrix();
    const vp = new THREE.Matrix4().multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse);

    /* Every shadow caster's world bounding box, pushed into the far cascade's clip
       space, so we can see what falls outside the box that is meant to hold it. */
    const box = new THREE.Box3(), p = new THREE.Vector3();
    const rng = { x: [1e9, -1e9], y: [1e9, -1e9], z: [1e9, -1e9] };
    const offenders = [];
    /* The decisive question for ownership: butte0 blocks the sun geometrically at
       520 m but is not in the depth map. rock.js:1250 says the buttes sit "half a
       kilometre outside the shadow camera's box", and if that is true the fix is
       to grow FAR_BOX, which is System 4's. If it is false the fix is one line in
       rock.js, which is System 2's. For a directional light a caster and its
       shadow share clip x and y, so a butte whose shadow lands on a wall inside
       the box has to be inside it in x and y too, leaving only z — and z spans
       1,860 m. Measure it rather than argue it. */
    const roll = [];
    scene.traverse((o) => {
      if (!o.isMesh || o.name === 'sky' || !o.geometry) return;
      o.geometry.computeBoundingBox();
      const bb = new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      const t = new THREE.Vector3();
      for (let c = 0; c < 8; c++) {
        t.set(c & 1 ? bb.max.x : bb.min.x, c & 2 ? bb.max.y : bb.min.y, c & 4 ? bb.max.z : bb.min.z).applyMatrix4(vp);
        lo = [Math.min(lo[0], t.x), Math.min(lo[1], t.y), Math.min(lo[2], t.z)];
        hi = [Math.max(hi[0], t.x), Math.max(hi[1], t.y), Math.max(hi[2], t.z)];
      }
      roll.push({
        name: o.name || o.type, cast: !!o.castShadow, vis: !!o.visible,
        clipX: [+lo[0].toFixed(2), +hi[0].toFixed(2)],
        clipY: [+lo[1].toFixed(2), +hi[1].toFixed(2)],
        clipZ: [+lo[2].toFixed(2), +hi[2].toFixed(2)],
        tris: Math.round((o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3) / 1000),
      });
    });
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.castShadow || o.name === 'sky') return;
      if (!o.geometry) return;
      o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let c = 0; c < 8; c++) {
        p.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z);
        p.applyMatrix4(vp);
        lo = [Math.min(lo[0], p.x), Math.min(lo[1], p.y), Math.min(lo[2], p.z)];
        hi = [Math.max(hi[0], p.x), Math.max(hi[1], p.y), Math.max(hi[2], p.z)];
      }
      rng.x = [Math.min(rng.x[0], lo[0]), Math.max(rng.x[1], hi[0])];
      rng.y = [Math.min(rng.y[0], lo[1]), Math.max(rng.y[1], hi[1])];
      rng.z = [Math.min(rng.z[0], lo[2]), Math.max(rng.z[1], hi[2])];
      const out = lo[0] < -1 || hi[0] > 1 || lo[1] < -1 || hi[1] > 1 || lo[2] < -1 || hi[2] > 1;
      if (out) {
        offenders.push({
          name: o.name || o.type,
          clipX: [+lo[0].toFixed(2), +hi[0].toFixed(2)],
          clipY: [+lo[1].toFixed(2), +hi[1].toFixed(2)],
          clipZ: [+lo[2].toFixed(2), +hi[2].toFixed(2)],
          tris: o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3,
        });
      }
    });

    /* And the receiver itself: nine rays through the artefact only, against the
       big surfaces, which is cheap enough to actually return. */
    const targets = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name === 'sky') return;
      const t = o.geometry && o.geometry.attributes.position.count;
      if (t && t > 5000) targets.push(o);
    });
    const rc = new THREE.Raycaster(); rc.far = 3000;
    const recv = [];
    /* And the question that settles it before any shadow-map theory is worth
       having: does the sun geometrically reach these points at all? Fire a ray
       from each hit toward the light and see whether anything is in the way. If
       nothing is, the wall is correctly lit and the artefact is a report about
       geometry rather than about shadows. */
    const sunDir = new THREE.Vector3().subVectors(far.position, far.target.position).normalize();
    for (const fy of [0.33, 0.35, 0.37]) {
      for (const fx of [0.052, 0.070, 0.090]) {
        rc.setFromCamera(new THREE.Vector2(fx * 2 - 1, 1 - fy * 2), cam);
        const h = rc.intersectObjects(targets, false);
        if (!h.length) continue;
        const q = h[0].point.clone().applyMatrix4(vp);
        const n = h[0].face ? h[0].face.normal.clone().transformDirection(h[0].object.matrixWorld) : null;
        const up = new THREE.Raycaster(h[0].point.clone().addScaledVector(sunDir, 0.05), sunDir, 0, 2500);
        const block = up.intersectObjects(targets, false);
        recv.push({
          screen: [fx, fy], dist: +h[0].distance.toFixed(1), obj: h[0].object.name || h[0].object.type,
          y: +h[0].point.y.toFixed(1),
          nDotL: n ? +n.dot(sunDir).toFixed(3) : null,
          clip: [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3)],
          inside: Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && Math.abs(q.z) <= 1,
          blockedBy: block.length ? `${block[0].object.name || block[0].object.type} at ${block[0].distance.toFixed(1)} m` : 'nothing',
        });
      }
    }

    return {
      farBox: { left: sc.left, right: sc.right, bottom: sc.bottom, top: sc.top, near: sc.near, far: sc.far },
      mapSize: far.shadow.mapSize.x, casterRange: rng, offenders: offenders.slice(0, 10),
      nOffenders: offenders.length, recv, roll,
    };
  }, [V]);

  const b = r.farBox;
  console.log(`\nwall_shade  d ${V.d} yaw ${V.yaw} pitch ${V.pitch}`);
  console.log(`far cascade  ${b.left}..${b.right} x ${b.bottom}..${b.top} m,  z ${b.near}..${b.far},  ${r.mapSize}\u00b2` +
    `  =  ${((b.right - b.left) / r.mapSize * 100).toFixed(1)} cm a texel\n`);
  const f3 = (a) => `${a[0].toFixed(2)} .. ${a[1].toFixed(2)}`;
  console.log(`  all casters occupy clip  x ${f3(r.casterRange.x)}   y ${f3(r.casterRange.y)}   z ${f3(r.casterRange.z)}`);
  console.log(`  (inside is -1 .. 1, so anything past that is not in the depth map)\n`);
  console.log(`  casters not fully inside: ${r.nOffenders}`);
  for (const o of r.offenders) {
    console.log(`    ${o.name.padEnd(20)} x ${f3(o.clipX)}  y ${f3(o.clipY)}  z ${f3(o.clipZ)}   ${Math.round(o.tris / 1000)}k tris`);
  }
  console.log('\n  the receiver under the artefact — and whether the sun can actually see it:');
  for (const q of r.recv) {
    console.log(`    ${q.screen[0]},${q.screen[1]}  ${String(q.dist).padStart(6)} m  y ${String(q.y).padStart(6)}  ` +
      `${q.obj.padEnd(8)} n\u00b7L ${String(q.nDotL).padStart(6)}  ${q.inside ? 'inside ' : 'OUTSIDE'}  ` +
      `sun blocked by: ${q.blockedBy}`);
  }
  console.log('\n  the occluder, and whether it is really outside the box:');
  for (const m of r.roll) {
    if (!/^(butte|wall|apron|terrain)/i.test(m.name)) continue;
    const insideXY = m.clipX[0] >= -1 && m.clipX[1] <= 1 && m.clipY[0] >= -1 && m.clipY[1] <= 1;
    const overlapsXY = m.clipX[1] >= -1 && m.clipX[0] <= 1 && m.clipY[1] >= -1 && m.clipY[0] <= 1;
    const overlapsZ = m.clipZ[1] >= -1 && m.clipZ[0] <= 1;
    console.log(`    ${m.name.padEnd(12)} cast ${m.cast ? 'YES' : 'no '}  ` +
      `x ${f3(m.clipX)}  y ${f3(m.clipY)}  z ${f3(m.clipZ)}  ${String(m.tris).padStart(4)}k  ` +
      `${overlapsXY && overlapsZ ? (insideXY ? 'IN BOX' : 'overlaps box') : 'outside'}`);
  }
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});

/* butte0 is in front of the sun. How far out of the way does it have to go?
 *
 *   node tools/_butteclear.mjs
 *
 * Two regressions landed together and they turn out to be one fact. The pale-patch
 * fix (0e9f46c) gave the buttes castShadow, which was correct - butte0 really does
 * occlude the sun from the far wall - and the frame promptly lost 81% of its ground
 * value, 60% of the wash going below V 0.12. And tools/sundisc.mjs now reports the
 * disc blocked by butte0 at 391 m in sun_gap and 477 m in wash_mid.
 *
 * Both of those are the same sentence: butte0 stands between the hero ground and
 * the sun. Of course its shadow covers the canyon - that is what an occluder does -
 * and of course the disc is behind it. The shadow was always geometrically there;
 * castShadow false was hiding a placement problem rather than causing one, which is
 * why the "fix" looked like a regression.
 *
 * So the question for System 2 is not bias or cascade extents, it is how much
 * angular clearance butte0 needs. This measures it from the camera positions that
 * matter: the butte's silhouette in azimuth and elevation as seen from each, the
 * sun's bearing, and therefore the elevation the sun would have to clear or the
 * bearing it would have to swing - and, more usefully, how far the butte itself has
 * to move or how much it has to drop.
 */
import { run } from './harness.mjs';
import { VIEWS } from './views.mjs';

await run({ width: 640, height: 360, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2000);

  const r = await page.evaluate((views) => {
    const g = window.__game, THREE = g._three, scene = g._scene, cam = g._camera;
    const lights = [];
    scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) lights.push(o); });
    const far = lights.sort((a, b) => (b.shadow.camera.right - b.shadow.camera.left) - (a.shadow.camera.right - a.shadow.camera.left))[0];
    const L = new THREE.Vector3().subVectors(far.position, far.target.position).normalize();
    const sunAz = Math.atan2(L.x, L.z) * 180 / Math.PI;
    const sunEl = Math.asin(L.y) * 180 / Math.PI;

    const buttes = [];
    scene.traverse((o) => {
      if (o.isMesh && /^butte/.test(o.name || '') && o.geometry) {
        o.geometry.computeBoundingBox();
        buttes.push({ o, bb: new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld) });
      }
    });

    const out = [];
    for (const v of views) {
      g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);
      cam.updateMatrixWorld(true);
      const eye = cam.position.clone();
      for (const { o, bb } of buttes) {
        /* Silhouette of the box from the eye: azimuth spread and max elevation. */
        let azMin = 999, azMax = -999, elMax = -999, dMin = 1e9;
        const p = new THREE.Vector3();
        for (let c = 0; c < 8; c++) {
          p.set(c & 1 ? bb.max.x : bb.min.x, c & 2 ? bb.max.y : bb.min.y, c & 4 ? bb.max.z : bb.min.z).sub(eye);
          const az = Math.atan2(p.x, p.z) * 180 / Math.PI;
          const el = Math.atan2(p.y, Math.hypot(p.x, p.z)) * 180 / Math.PI;
          let rel = az - sunAz; while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
          azMin = Math.min(azMin, rel); azMax = Math.max(azMax, rel);
          elMax = Math.max(elMax, el); dMin = Math.min(dMin, p.length());
        }
        const coversAz = azMin <= 0 && azMax >= 0;
        if (!coversAz && Math.min(Math.abs(azMin), Math.abs(azMax)) > 6) continue;
        out.push({
          view: v.name, name: o.name, d: +dMin.toFixed(0),
          azMin: +azMin.toFixed(2), azMax: +azMax.toFixed(2), elMax: +elMax.toFixed(2),
          top: +bb.max.y.toFixed(1), coversAz,
          blocks: coversAz && elMax > sunEl,
        });
      }
    }
    return { sunAz: +sunAz.toFixed(2), sunEl: +sunEl.toFixed(2), out };
  }, VIEWS);

  console.log(`\n  sun bearing ${r.sunAz}\u00b0, elevation ${r.sunEl}\u00b0\n`);
  console.log('  view        butte     dist    az span rel. sun    top elev   crest y   blocks the disc?');
  for (const q of r.out) {
    console.log(`  ${q.view.padEnd(11)} ${q.name.padEnd(8)} ${String(q.d).padStart(5)} m   ` +
      `${q.azMin.toFixed(1).padStart(6)} .. ${q.azMax.toFixed(1).padEnd(6)}   ` +
      `${q.elMax.toFixed(2).padStart(6)}\u00b0   ${String(q.top).padStart(6)}   ${q.blocks ? 'YES' : 'no'}`);
  }
  const worst = r.out.filter((q) => q.blocks).sort((a, b) => b.elMax - a.elMax)[0];
  if (worst) {
    const need = worst.elMax - r.sunEl;
    console.log(`\n  worst offender ${worst.name} in ${worst.view}: crest at ${worst.elMax}\u00b0 against a sun at ${r.sunEl}\u00b0.`);
    console.log(`  to clear it the sun would have to rise ${need.toFixed(2)}\u00b0, or the butte drop`);
    console.log(`  ${(worst.d * (Math.tan(worst.elMax * Math.PI / 180) - Math.tan(r.sunEl * Math.PI / 180))).toFixed(1)} m,`);
    console.log(`  or swing clear in bearing by ${Math.min(Math.abs(worst.azMin), Math.abs(worst.azMax)).toFixed(1)}\u00b0 +`);
    console.log(`  (the azimuth trade is already measured-and-declined at 62% of the wash floor).`);
  }
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});

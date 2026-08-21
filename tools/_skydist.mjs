/* How far away is the rock that fills the bottom of a shaded surface's sky?
 *
 *   node tools/_skydist.mjs
 *
 * The fill integral in src/atmos.js replaces the sky below a 45 degree skyline
 * with escarpment, and hands that escarpment to the rock as raw albedo times
 * irradiance - no extinction, no airlight, as though the wall were pressed
 * against the surface being lit. System 5 measures the same distant landforms in
 * the rendered image at 51 and 56 percent haze. Both cannot be right, and the
 * one that is wrong is the fill: a wall three hundred metres up-canyon does not
 * deliver its own colour, it delivers about half its own colour and half the
 * colour of the air in front of it.
 *
 * That matters for hue and not just for level, which is why it lands on the
 * missing-cool-shade complaint. Sunlit rock is the reddest thing in the scene
 * and airlight at this hour is pale gold to blue depending on bearing, so
 * replacing a fraction of the former with the latter cools and desaturates
 * exactly the warm half of the fill - and does it hardest up-canyon, which is
 * the bearing the away-from-sun lobe integrates over and the warmest part of the
 * current fill by a wide margin.
 *
 * Applying it needs a distance per bearing, which is what this measures.
 * skyview.mjs already bisects for the skyline elevation per azimuth; it throws
 * the hit distance away, and that is the number wanted here.
 */
import { run } from './harness.mjs';

const NAZ = 24;

await run({ width: 320, height: 200, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2000);

  const r = await page.evaluate((NAZ) => {
    const g = window.__game, THREE = g._three, scene = g._scene;
    const lights = [];
    scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) lights.push(o); });
    const sun = new THREE.Vector3().subVectors(lights[0].position, lights[0].target.position).normalize();
    const sunAz = Math.atan2(sun.x, sun.z);

    const targets = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name === 'sky' || !o.geometry) return;
      if (o.geometry.attributes.position.count > 5000) targets.push(o);
    });

    /* Four points along the wash, the same traverse skyview.mjs samples. */
    const rc = new THREE.Raycaster(); rc.far = 3000;
    const out = [];
    for (const d of [40, 100, 160, 220]) {
      g.walkTo(d);
      const eye = g._camera.position.clone();
      const p = new THREE.Vector3(eye.x, eye.y - 1.4, eye.z);   // ground, not eye
      const rows = [];
      for (let i = 0; i < NAZ; i++) {
        const az = (i / NAZ) * Math.PI * 2;
        /* Bisect for the skyline, then report the distance at the elevation
           band that carries the irradiance. A cosine-weighted integral over a
           lateral normal is dominated by low elevations, so sample at a third
           of the skyline height rather than at the crest. */
        const hit = (el) => {
          const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el),
            Math.cos(az) * Math.cos(el));
          rc.set(p, dir);
          const h = rc.intersectObjects(targets, false);
          return h.length ? h[0].distance : null;
        };
        let lo = 0, hi = Math.PI / 2;
        if (hit(1e-3) === null) { rows.push({ az, el: 0, d: null }); continue; }
        for (let k = 0; k < 18; k++) {
          const m = 0.5 * (lo + hi);
          if (hit(m) !== null) lo = m; else hi = m;
        }
        const dm = hit(lo * 0.33);
        rows.push({
          az: +(az * 180 / Math.PI).toFixed(0),
          rel: +(((az - sunAz) * 180 / Math.PI + 540) % 360 - 180).toFixed(0),
          el: +(lo * 180 / Math.PI).toFixed(1),
          d: dm === null ? null : +dm.toFixed(0),
          dcrest: +(hit(lo * 0.95) ?? 0).toFixed(0),
        });
      }
      out.push({ walk: d, rows });
    }
    return { out, sunAz: +(sunAz * 180 / Math.PI).toFixed(1) };
  }, NAZ);

  console.log(`\n  skyline distance by bearing. sun azimuth ${r.sunAz} deg.`);
  console.log('  "rel" is degrees from the sun\'s bearing: 0 looks into the sun, 180 up-canyon away.\n');
  for (const v of r.out) {
    console.log(`  walk ${v.walk} m`);
    const near = v.rows.filter((q) => q.d !== null);
    console.log('    rel deg  ' + v.rows.map((q) => String(q.rel).padStart(5)).join(''));
    console.log('    skyline  ' + v.rows.map((q) => String(q.el).padStart(5)).join(''));
    console.log('    dist m   ' + v.rows.map((q) => String(q.d ?? '-').padStart(5)).join(''));
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const toward = near.filter((q) => Math.abs(q.rel) < 60).map((q) => q.d);
    const away = near.filter((q) => Math.abs(q.rel) > 120).map((q) => q.d);
    const side = near.filter((q) => Math.abs(q.rel) >= 60 && Math.abs(q.rel) <= 120).map((q) => q.d);
    console.log(`    median distance:  toward sun ${toward.length ? med(toward) : '-'} m` +
      `   across ${side.length ? med(side) : '-'} m   up-canyon away ${away.length ? med(away) : '-'} m`);
  }
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});

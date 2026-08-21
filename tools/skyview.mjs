/* How much sky a point in the wash actually sees, by raycast.
 *
 * The escarpment term in src/atmos.js models the canyon walls as a horizon band
 * COVER_MAX = 0.46 of the way round, thinning out at COVER_TOP = sin 31 degrees.
 * Those numbers were reasoned, and the only instrument that could have checked
 * them — tools/horizon.mjs — marches the terrain heightfield and is blind to
 * `wallR`, `wallL` and the buttes, which are separate meshes. That is the same
 * blindness that had the sun clear of a skyline it was inside of.
 *
 * This asks geometry. It fires a hemisphere of rays from points in the wash and
 * reports, per normal, the cosine-weighted fraction of the sky that is blocked —
 * which is the factor the skylight fill should be carrying and currently is not.
 *
 *   node tools/skyview.mjs                # the standard viewpoint distances
 *   node tools/skyview.mjs --d 46 --n 64
 */
import { run } from './harness.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? Number(a[i + 1]) : d; };
/* Default: along the wash at eye height. `--ys` climbs instead, at one distance,
   because the first sweep showed visibility barely varies along the wash
   (0.20-0.30 at 18 through 120 m) while it must go to 1.0 above the rim — so
   height, not position, is the variable a fill term should carry. */
const DS = a.includes('--ys')
  ? [0, 6, 14, 26, 44, 70].map((y) => [opt('--d', 46), y])
  : (a.includes('--d') ? [[opt('--d', 46), 0]] : [[18, 0], [46, 0], [78, 0], [120, 0]]);
const N = opt('--n', 48);

await run({ width: 640, height: 360, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const out = await page.evaluate(([DS, N]) => {
    const g = window.__game, THREE = g._three, scene = g._scene, cam = g._camera;
    /* The sky dome is a mesh and would block every ray; the particles are not
       occluders for a skylight integral either. */
    const SKIP = ['sky', 'dust', 'saltation', 'saltation_far'];
    const targets = scene.children.filter((c) => c.visible && !SKIP.includes(c.name));
    const rc = new THREE.Raycaster();
    rc.near = 0.25; rc.far = 3000;

    const res = [];
    for (const [d, dy] of DS) {
      g.walkTo(d); g.lookAt(0, 0);
      cam.updateMatrixWorld(true);
      const eye = cam.position.clone();
      eye.y += dy;
      const sun = g._post._diag.sunDir;
      const sunH = new THREE.Vector3(sun[0], 0, sun[2]).normalize();

      /* Cosine-weighted hemisphere integral, done as an explicit grid so the
         same samples serve every normal and the horizon profile. */
      const norms = {
        up: new THREE.Vector3(0, 1, 0),
        'away from sun': sunH.clone().negate(),
        across: new THREE.Vector3(-sunH.z, 0, sunH.x).normalize(),
        'toward sun': sunH.clone(),
      };
      /* The occluders are star-shaped about the viewpoint — walls, banks and
         buttes all rise from the ground — so the blocked set is exactly "below
         the horizon" and a bisection for the horizon elevation per azimuth costs
         seven rays where a scan costs sixteen. A full scan of this scene is
         about a billion triangle tests in JavaScript, and does not return. */
      const hit = (phi, el) => {
        rc.set(eye, new THREE.Vector3(
          Math.cos(el) * Math.sin(phi), Math.sin(el), Math.cos(el) * Math.cos(phi)));
        return rc.intersectObjects(targets, true).length > 0;
      };
      const hor = [];
      for (let i = 0; i < N; i++) {
        const phi = 2 * Math.PI * (i + 0.5) / N;
        let lo = 0, hi = Math.PI / 2;
        if (!hit(phi, 1e-3)) hi = 0;                       // open to the ground
        else for (let k = 0; k < 7; k++) {
          const m = 0.5 * (lo + hi);
          if (hit(phi, m)) lo = m; else hi = m;
        }
        hor.push(hi);
      }
      /* Integrate the cosine-weighted hemisphere against that horizon. */
      const acc = {}, tot = {};
      for (const k of Object.keys(norms)) { acc[k] = 0; tot[k] = 0; }
      const M = 40;
      for (let i = 0; i < N; i++) {
        const phi = 2 * Math.PI * (i + 0.5) / N;
        for (let j = 0; j < M; j++) {
          const el = (Math.PI / 2) * (j + 0.5) / M;
          const dir = new THREE.Vector3(
            Math.cos(el) * Math.sin(phi), Math.sin(el), Math.cos(el) * Math.cos(phi));
          const dw = Math.cos(el);
          const blocked = el < hor[i];
          for (const [k, n] of Object.entries(norms)) {
            const c = dir.dot(n);
            if (c <= 0) continue;
            tot[k] += c * dw;
            if (blocked) acc[k] += c * dw;
          }
        }
      }
      const blockedFrac = {};
      for (const k of Object.keys(norms)) blockedFrac[k] = tot[k] ? acc[k] / tot[k] : 0;

      /* How much of that skyline is actually in sun. This is the last free
         parameter in the escarpment model and the sweep showed it is the only
         one that matters — it sets both the shaded fill's level and its colour,
         from B/R 0.27 fully lit to 0.94 fully shaded. So measure it: ray to the
         rock, then a shadow ray from the hit toward the sun. Reported per
         elevation band as a fraction of the skyline's height, to check the ramp
         shape as well as the level. */
      let litAcc = 0, litTot = 0;
      const BANDS = 5, bAcc = new Array(BANDS).fill(0), bTot = new Array(BANDS).fill(0);
      const sunV = new THREE.Vector3(sun[0], sun[1], sun[2]).normalize();
      for (let i = 0; i < N; i++) {
        const phi = 2 * Math.PI * (i + 0.5) / N;
        if (hor[i] <= 1e-3) continue;
        for (let j = 0; j < 6; j++) {
          const frac = (j + 0.5) / 6;
          const el = hor[i] * frac;
          const dir = new THREE.Vector3(
            Math.cos(el) * Math.sin(phi), Math.sin(el), Math.cos(el) * Math.cos(phi));
          rc.set(eye, dir);
          const h = rc.intersectObjects(targets, true)[0];
          if (!h) continue;
          const p = h.point.clone().addScaledVector(h.face ? h.face.normal : dir, 0.0);
          rc.set(p.addScaledVector(sunV, 0.4), sunV);
          const litHere = rc.intersectObjects(targets, true).length === 0 ? 1 : 0;
          const w = Math.cos(el);
          litAcc += litHere * w; litTot += w;
          const b = Math.min(BANDS - 1, Math.floor(frac * BANDS));
          bAcc[b] += litHere; bTot[b] += 1;
        }
      }
      const litFrac = litTot ? litAcc / litTot : 0;
      const litByBand = bAcc.map((v, i) => bTot[i] ? +(v / bTot[i]).toFixed(2) : null);
      const BINS = 12, bin = new Array(BINS).fill(0);
      hor.forEach((v, i) => {
        const b = Math.floor((i + 0.5) / N * BINS);
        bin[b] = Math.max(bin[b], v * 180 / Math.PI);
      });
      res.push({ d, dy, blockedFrac, litFrac, litByBand, horizon: bin.map((x) => +x.toFixed(1)) });
    }
    return res;
  }, [DS, N]);

  console.log(`\ncosine-weighted fraction of the sky hemisphere blocked by geometry`);
  console.log('  d   +y     up     away    across  toward   | visible sky, "across" normal');
  for (const r of out) {
    const b = r.blockedFrac;
    console.log(`  ${String(r.d).padStart(3)} ${String(r.dy).padStart(3)}  ` +
      ['up', 'away from sun', 'across', 'toward sun']
        .map((k) => b[k].toFixed(3).padStart(6)).join('  ') +
      `   | ${(1 - b.across).toFixed(3)}`);
  }
  console.log('\nsunlit fraction of the skyline (cosine-weighted), and by height band');
  console.log('   d  +y   lit    foot ----------------> crest');
  for (const r of out) {
    console.log(`  ${String(r.d).padStart(3)} ${String(r.dy).padStart(3)}  ${r.litFrac.toFixed(3)}   ` +
      r.litByBand.map((x) => String(x).padStart(5)).join(''));
  }
  console.log('\nhorizon elevation by azimuth bin, degrees (30 deg bins from +Z)');
  for (const r of out) console.log(`  d ${String(r.d).padStart(3)}  ${r.horizon.map((x) => String(x).padStart(5)).join('')}`);
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});

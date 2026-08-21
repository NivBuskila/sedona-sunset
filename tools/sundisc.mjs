/* Is the sun disc visible, and if not, what is in front of it.
 *
 * tools/horizon.mjs marches the terrain heightfield, and the buttes are separate
 * meshes — `butte0` .. `butte9`, `wallR`, `wallL`. So it reported the sun clear
 * of the horizon at elevation 11 while System 7 reported the disc occluded from
 * all eight viewpoints, and both were right about different geometry. This asks
 * the actual scene.
 *
 * The scene does not depend on the sun, so one page session can test any number
 * of candidate sun positions: the direction is arithmetic and the occlusion is a
 * raycast from the eye. That is the whole reason this is cheap enough to sweep.
 *
 *   node tools/sundisc.mjs                        # the shipped sun, all views
 *   node tools/sundisc.mjs --az -20:0:2 --el 9,11,13
 */
import { run } from './harness.mjs';
import { decode } from './png.mjs';
import { byName } from './views.mjs';

/* These four were hand-copied from tools/shoot.mjs and had gone stale: wash_low
   was d 18 pitch 0 against the capture's d 8 pitch -4, and bend was d 78 yaw -28
   against d 92 yaw -22. The consequence was not cosmetic — the sun projected to
   screen 0.365,0.25 from a camera nobody photographs, while the disc in the frame
   under review sits at 0.325,0.171, four degrees away. Every occlusion verdict and
   every azimuth sweep this tool produced before that was fixed was raycast along
   the right bearing from the wrong eye. Taken from tools/views.mjs now. */
const VIEWS = ['wash_low', 'wash_mid', 'sun_gap', 'bend'].map(byName);

const a = process.argv.slice(2);
const opt = (k, dflt) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : dflt; };
const list = (s) => s.includes(':')
  ? (() => { const [lo, hi, st] = s.split(':').map(Number); const o = []; for (let v = lo; v <= hi + 1e-9; v += st) o.push(+v.toFixed(3)); return o; })()
  : s.split(',').map(Number);

const azs = list(opt('--az', 'SHIPPED'));
const els = list(opt('--el', 'SHIPPED'));

await run({ width: 800, height: 450, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const shipped = await page.evaluate(() => {
    const s = window.__game._post._diag.sunDir;
    const el = Math.asin(s[1]) * 180 / Math.PI;
    const az = Math.atan2(s[0], -s[2]) * 180 / Math.PI;
    return { az: +az.toFixed(2), el: +el.toFixed(2) };
  });
  const AZ = Number.isNaN(azs[0]) ? [shipped.az] : azs;
  const EL = Number.isNaN(els[0]) ? [shipped.el] : els;
  console.log(`\nshipped sun: azimuth ${shipped.az}, elevation ${shipped.el}`);

  /* Occlusion without a Raycaster, and without one render per candidate.
     Everything in this scene is nearer than the sun, so *any* geometry on the
     sun's pixel occludes the disc. Hide the sky dome and the particles and the
     background is black, so one frame per viewpoint answers every candidate
     direction and the sweep costs four renders rather than four per candidate.
     The mask is read off the *canvas*, not off post's scene target: the first
     version of this read `_diag.sceneRT` and gave two contradictory answers for
     the same candidate on consecutive runs, because that buffer is only rewritten
     while the bloom chain is live and the tier governor can turn it off on a slow
     frame, leaving a stale frame to be measured. The canvas is what was actually
     drawn. The tier is pinned as well, belt and braces. */
  const rows = await page.evaluate(([VIEWS, AZ, EL]) => {
    const g = window.__game, THREE = g._three, scene = g._scene, cam = g._camera;
    const SKIP = ['sky', 'dust', 'saltation', 'saltation_far'];
    const targets = scene.children.filter((c) => c.visible && !SKIP.includes(c.name));
    const out = [];
    for (const v of VIEWS) {
      g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);
      cam.updateMatrixWorld(true);
      const eye = cam.position.clone();
      for (const az of AZ) for (const el of EL) {
        const ar = az * Math.PI / 180, er = el * Math.PI / 180;
        /* Same convention as src/atmos.js SUN_DIR: azimuth measured off -Z. */
        const dir = new THREE.Vector3(
          Math.sin(ar) * Math.cos(er), Math.sin(er), -Math.cos(ar) * Math.cos(er));
        const p = eye.clone().add(dir.clone().multiplyScalar(5000)).project(cam);
        const sx = p.x * 0.5 + 0.5, sy = -p.y * 0.5 + 0.5;
        const inFrame = sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1 && p.z > -1 && p.z < 1;
        /* The disc is half a degree wide, so a single ray through its centre can
           thread a gap the disc would not fit through. Five rays: centre and the
           four limbs at the true angular radius. */
        const R = 0.00465;
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(dir, up).normalize();
        const upp = new THREE.Vector3().crossVectors(right, dir).normalize();
        const offs = [
          dir,
          dir.clone().addScaledVector(right, R).normalize(),
          dir.clone().addScaledVector(right, -R).normalize(),
          dir.clone().addScaledVector(upp, R).normalize(),
          dir.clone().addScaledVector(upp, -R).normalize(),
        ];
        let blocked = 0, first = null;
        for (const o of offs) {
          const rc = new THREE.Raycaster(eye, o, 0.2, 6000);
          const its = rc.intersectObjects(targets, true);
          if (its.length) {
            blocked++;
            if (!first || its[0].distance < first.dist) {
              const ob = its[0].object;
              first = { name: ob.name || ob.parent?.name || ob.type, dist: +its[0].distance.toFixed(0) };
            }
          }
        }
        out.push({ view: v.name, az, el, sx, sy, inFrame, cov: blocked / offs.length, hit: first });
      }
    }
    return out;
  }, [VIEWS, AZ, EL]);
  const many = AZ.length * EL.length > 1;
  if (!many) {
    for (const r of rows) {
      const where = r.inFrame ? `screen ${r.sx.toFixed(2)},${r.sy.toFixed(2)}` : 'off frame       ';
      const occ = !r.inFrame ? '—'
        : r.cov === 0 ? 'CLEAR — disc visible'
          : r.cov < 1 ? `partial, ${Math.round(r.cov * 100)}% covered`
            : 'blocked';
      const by = r.hit ? `  by ${r.hit.name} at ${r.hit.dist} m` : '';
      console.log(`  ${r.view.padEnd(9)} ${where}  ${occ}${by}`);
    }
  } else {
    /* One line per candidate: which viewpoints show the disc. sun_gap is the
       one the brief is about — it is the framing that looks up the wash. */
    console.log('\n  az    el  | sun_gap        | clear in');
    console.log('  ------------+----------------+---------------------------');
    for (const az of AZ) for (const el of EL) {
      const set = rows.filter((r) => r.az === az && r.el === el);
      const gap = set.find((r) => r.view === 'sun_gap');
      const clear = set.filter((r) => r.inFrame && r.cov === 0).map((r) => r.view);
      const part = set.filter((r) => r.inFrame && r.cov > 0 && r.cov < 1).map((r) => r.view);
      const gs = !gap ? '?' : !gap.inFrame ? 'off frame'
        : gap.cov === 0 ? 'CLEAR' : gap.cov < 1 ? `${Math.round(gap.cov * 100)}% covered` : 'blocked';
      console.log(`  ${String(az).padStart(5)} ${String(el).padStart(5)}  | ${gs.padEnd(14)} | ` +
        (clear.length ? clear.join(', ') : '—') + (part.length ? `   (partial: ${part.join(', ')})` : ''));
    }
  }
  if (errs.length) console.log('\npage errors:', errs.slice(0, 4));
});

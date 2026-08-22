/* Where are the instances that fill a screen box actually seated?
 *
 *   node tools/_instrow.mjs --mesh veg-shrub-b --view bend --box 837,519,945,583
 *
 * Two mechanisms for `bend`'s "black rectangle" were falsified by measurement --
 * the alpha-test compensation and the uvFit window -- and rendering the owner
 * alone against sky showed no stray quad at all. What it showed instead was that
 * the whole shrub mass terminates on a razor-straight horizontal line, and that
 * the rock behind it is a continuous slope with no lip to occlude it.
 *
 * A set of plants seated on a slope has bases at many screen heights. A set of
 * plants sharing one world height has bases on one screen line only if they also
 * share a depth. So the instance transforms decide between "seated on the ground
 * and merely dense" and "planted at a constant height regardless of the ground",
 * and no picture can distinguish those two. This prints them.
 */
import { run } from './harness.mjs';
import { byName } from './views.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const mesh = opt('mesh', 'veg-shrub-b');
const view = opt('view', 'bend');
const W = +opt('w', 1997), H = +opt('h', 1123);
const box = opt('box', '837,519,945,583').split(',').map(Number);
const v = byName(view);

const res = await (async () => {
  let out;
  await run({ width: W, height: H, waitReady: false }, async ({ page }) => {
    await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
    await page.evaluate(() => window.__game.begin());
    await page.waitForTimeout(4000);
    await page.evaluate(([d, yaw, pitch]) => {
      const g = window.__game;
      g.walkTo(d); g.lookAt(yaw, pitch);
    }, [v.d, v.yaw, v.pitch]);
    await page.waitForTimeout(900);
    out = await page.evaluate(([name, bx, w, h]) => {
      const g = window.__game;
      g.renderOnce();
      const im = g._scene.getObjectByName(name);
      if (!im) return { err: `no mesh named ${name}` };
      const cam = g.camera || g._camera;
      const THREE = window.THREE || null;
      const m = im.instanceMatrix;
      const n = im.count;
      im.geometry.computeBoundingBox();
      const bbMinY = im.geometry.boundingBox.min.y;
      const bbMaxY = im.geometry.boundingBox.max.y;
      /* Project a point by hand: the camera's matrices are on the object and
         importing three here would be a second module instance. */
      const mvp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
      const e = mvp.elements;
      const proj = (x, y, z) => {
        const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
        const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
        const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
        if (cw <= 0) return null;
        return [(cx / cw * 0.5 + 0.5) * w, (1 - (cy / cw * 0.5 + 0.5)) * h, cw];
      };
      const rows = [];
      for (let i = 0; i < n; i++) {
        const o = i * 16, a4 = m.array;
        const px = a4[o + 12], py = a4[o + 13], pz = a4[o + 14];
        /* Uniform-ish scale from the first column's length. */
        const s = Math.hypot(a4[o], a4[o + 1], a4[o + 2]);
        const base = proj(px, py + bbMinY * s, pz);
        const top = proj(px, py + bbMaxY * s, pz);
        if (!base) continue;
        if (base[0] < bx[0] - 8 || base[0] > bx[2] + 8) continue;
        if (base[1] < bx[1] - 60 || base[1] > bx[3] + 60) continue;
        rows.push({
          i, wx: +px.toFixed(2), wy: +py.toFixed(3), wz: +pz.toFixed(2), s: +s.toFixed(3),
          sx: Math.round(base[0]), sy: +base[1].toFixed(1),
          ty: top ? +top[1].toFixed(1) : null, depth: +base[2].toFixed(2),
        });
      }
      rows.sort((p, q) => p.sy - q.sy);
      return { n, bbMinY: +bbMinY.toFixed(4), bbMaxY: +bbMaxY.toFixed(4), rows };
    }, [mesh, box, W, H]);
  });
  return out;
})();

if (res.err) { console.log(res.err); process.exit(1); }
console.log(`\n${mesh}: ${res.n} instances total; geometry y `
  + `${res.bbMinY} .. ${res.bbMaxY}`);
console.log(`${res.rows.length} whose base projects into the box's x span, ${view} at ${W}x${H}\n`);
console.log('    i    world x     y       z    scale   screen x  base y   top y   depth');
for (const r of res.rows)
  console.log(`  ${String(r.i).padStart(4)} ${String(r.wx).padStart(9)}`
    + ` ${String(r.wy).padStart(8)} ${String(r.wz).padStart(8)} ${String(r.s).padStart(7)}`
    + `   ${String(r.sx).padStart(7)} ${String(r.sy).padStart(8)}`
    + ` ${String(r.ty).padStart(8)} ${String(r.depth).padStart(7)}`);
if (res.rows.length > 1) {
  const ys = res.rows.map(r => r.wy), sy = res.rows.map(r => r.sy);
  const d = res.rows.map(r => r.depth);
  const rg = (v) => `${Math.min(...v).toFixed(2)} .. ${Math.max(...v).toFixed(2)}`
    + ` (spread ${(Math.max(...v) - Math.min(...v)).toFixed(2)})`;
  console.log(`\n  world y   ${rg(ys)}`);
  console.log(`  depth     ${rg(d)}`);
  console.log(`  base row  ${rg(sy)}`);
}

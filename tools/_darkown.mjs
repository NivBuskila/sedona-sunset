/* What is darkening this rectangle? Ablate every mesh, watch one box.
 *
 *   node tools/_darkown.mjs --view bend --box 837,519,945,583
 *
 * A delivery critic found, under the shrub clump in `bend`, "a 5.6x darkening
 * bounded by a dead-straight, screen-axis-aligned horizontal line" that "cuts
 * through open air between blades". Confirmed on the delivery frame: mean
 * luminance runs 2.4-3.2 above the line and recovers to about 17 within six rows
 * below it, which is the surrounding shaded ground.
 *
 * A single pixel cannot attribute this, because the artefact is a region and the
 * question is which of some hundreds of meshes draws or shadows it. So: hide one
 * mesh, redraw, and take the mean luminance of the box. Whatever raises it to the
 * surround owns it. Reading back only the box rather than the frame is what makes
 * a full traverse affordable.
 *
 * Box coordinates are top-origin pixels at the render resolution, matching how
 * the frames are indexed everywhere else in this project. They are flipped for
 * glReadPixels here, once, rather than at each call site -- getting that wrong is
 * how a reported region became shadowed gravel earlier today.
 */
import fs from 'node:fs';
import { run } from './harness.mjs';
import { byName } from './views.mjs';
import { encodeRGB } from './png.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const view = opt('view', 'bend');
const W = +opt('w', 1997), H = +opt('h', 1123);
const box = opt('box', '837,519,945,583').split(',').map(Number);
if (box.length !== 4 || box.some(n => !isFinite(n))) {
  console.error('--box must be x0,y0,x1,y1 in top-origin pixels');
  process.exit(2);
}
const v = byName(view);
if (!v) { console.error(`no view "${view}"`); process.exit(2); }

const PAGE = /* js */`
  /* A crop of the box, magnified, for three arms: as shipped, with the owner
     hidden so what is behind it is visible, and with everything hidden *except*
     the owner and the sky, where a stray quad has nowhere to hide. The third arm
     is the one that decides it -- two mechanisms have already been falsified by
     measurement here, and a silhouette against open sky is not ambiguous. */
  window.__crop = (bx, mode, owner, pad, scale) => {
    const g = window.__game;
    const r = g.renderer;
    const w = r.domElement.width, h = r.domElement.height;
    const gl = r.getContext();
    const x0 = Math.max(0, bx[0] - pad), y0 = Math.max(0, bx[1] - pad);
    const x1 = Math.min(w - 1, bx[2] + pad), y1 = Math.min(h - 1, bx[3] + pad);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    g.setPaused(true);
    const hidden = [];
    g._scene.traverse(o => {
      if (!(o.isMesh || o.isPoints || o.isSprite) || !o.visible) return;
      const n = o.name || '';
      const isOwner = n === owner;
      if (mode === 'without' && isOwner) { o.visible = false; hidden.push(o); }
      if (mode === 'alone' && !isOwner && n !== 'sky') { o.visible = false; hidden.push(o); }
    });
    g.renderOnce();
    const buf = new Uint8Array(bw * bh * 4);
    gl.readPixels(x0, h - 1 - y1, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (const o of hidden) o.visible = true;
    g.setPaused(false);
    const ow = bw * scale, oh = bh * scale;
    const rgb = new Uint8Array(ow * oh * 3);
    for (let y = 0; y < oh; y++) {
      const sy = bh - 1 - ((y / scale) | 0);          // gl rows are bottom-up
      for (let x = 0; x < ow; x++) {
        const s = (sy * bw + ((x / scale) | 0)) * 4, d = (y * ow + x) * 3;
        /* Gamma lift, because the whole question is about a region at L 3. */
        for (let c = 0; c < 3; c++)
          rgb[d + c] = Math.min(255, Math.round(255 * Math.pow(buf[s + c] / 255, 0.45)));
      }
    }
    let str = '';
    for (let i = 0; i < rgb.length; i += 4096)
      str += String.fromCharCode.apply(null, rgb.subarray(i, i + 4096));
    return { b: btoa(str), w: ow, h: oh };
  };

  window.__do = (bx) => {
    const g = window.__game;
    const r = g.renderer;
    const w = r.domElement.width, h = r.domElement.height;
    const gl = r.getContext();
    const [x0, y0, x1, y1] = bx;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const glY = h - 1 - y1;                 // top-origin box -> gl bottom-origin
    const buf = new Uint8Array(bw * bh * 4);
    const meanL = () => {
      g.renderOnce();
      gl.readPixels(x0, glY, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let s = 0;
      for (let i = 0; i < bw * bh; i++)
        s += 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
      return s / (bw * bh);
    };
    g.setPaused(true);
    const base = meanL();
    const cand = [];
    g._scene.traverse(o => {
      if ((o.isMesh || o.isPoints || o.isSprite) && o.visible) cand.push(o);
    });
    const hits = [];
    for (const o of cand) {
      o.visible = false;
      const now = meanL();
      o.visible = true;
      if (Math.abs(now - base) > 0.8)
        hits.push({ name: o.name || o.type, type: o.type, d: now - base, now });
    }
    /* Second phase: having found the owner, test a mechanism rather than guess
       one. uThickFloor divides the cutout's alpha before the alpha test, to undo
       the atlas's thickness profile and restore the original silhouette. That is
       exact at mip 0. At a coarse mip the sampled alpha is an average over a cell
       that is mostly empty, so dividing it by 0.62 inflates it by 1.6x and can
       carry it over an alphaTest it used to fail -- which would draw the whole
       quad instead of discarding it. */
    const sweep = [];
    const mats = [];
    g._scene.traverse(o => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const u = m && m.userData && m.userData.uniforms;
      if (u && u.uThickFloor) mats.push({ n: o.name || '', u });
    });
    for (const tf of [0.62, 0.75, 0.9, 1.0]) {
      const was = mats.map(q => q.u.uThickFloor.value);
      for (const q of mats) q.u.uThickFloor.value = tf;
      sweep.push({ tf, L: meanL(), n: mats.length });
      mats.forEach((q, i) => { q.u.uThickFloor.value = was[i]; });
    }
    g.setPaused(false);
    hits.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
    return { base, n: cand.length, hits, sweep };
  };
`;

await run({ width: W, height: H, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);
  await page.evaluate(PAGE);
  await page.evaluate(([d, yaw, pitch]) => {
    const g = window.__game;
    g.walkTo(d); g.lookAt(yaw, pitch);
  }, [v.d, v.yaw, v.pitch]);
  await page.waitForTimeout(900);
  const r = await page.evaluate(b => window.__do(b), box);

  console.log(`\n${view} at ${W}x${H}, box x ${box[0]}..${box[2]}, y ${box[1]}..${box[3]}`
    + ` (top-origin)`);
  console.log(`  baseline mean L ${r.base.toFixed(2)} over ${r.n} visible meshes tested\n`);
  if (r.hits.length) {
    console.log('  mesh                                  type            dL   box L without it');
    for (const h of r.hits.slice(0, 14))
      console.log(`  ${h.name.slice(0, 36).padEnd(38)}${h.type.padEnd(14)}`
        + `${h.d >= 0 ? '+' : ''}${h.d.toFixed(2).padStart(7)}   ${h.now.toFixed(2)}`);
  } else {
    console.log('  no single mesh moves the box by more than 0.8');
  }
  if (r.sweep && r.sweep.length) {
    console.log(`\n  uThickFloor sweep over ${r.sweep[0].n} foliage materials:`);
    for (const s of r.sweep) console.log(`    uThickFloor ${s.tf.toFixed(2)}   box mean L ${s.L.toFixed(2)}`);
  }

  const crops = opt('crops', '');
  if (crops && r.hits.length) {
    const owner = r.hits[0].name;
    const pad = +opt('pad', 40), scale = +opt('scale', 4);
    for (const mode of ['shipped', 'without', 'alone']) {
      const c = await page.evaluate(([b, m, o, p, s]) => window.__crop(b, m, o, p, s),
        [box, mode, owner, pad, scale]);
      const f = `${crops}_${mode}.png`;
      fs.writeFileSync(f, encodeRGB(c.w, c.h, Buffer.from(c.b, 'base64')));
      console.log(`  wrote ${f}  ${c.w}x${c.h}  (${mode}, owner ${owner}, gamma 0.45)`);
    }
  }
});

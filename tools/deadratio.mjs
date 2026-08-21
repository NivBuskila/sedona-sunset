/* The rendered dead-to-live value ratio on the hero juniper's wood.
 *
 *   node tools/deadratio.mjs
 *   node tools/deadratio.mjs --view juniper --width 900 --height 520
 *
 * Why this exists, and why it is not just tools/sat.mjs on a crop.
 *
 * The deadwood target is stated as a *ratio of rendered values* — bleached
 * heartwood about three and a half times the value of the living bark beside it,
 * measured off the frame. It has now been missed twice by setting the albedo
 * ratio instead and assuming the render would follow. It did not, both times and
 * in opposite directions: once because the bark map had been darkened underneath,
 * so the denominator had moved; once because at low value the sky's specular
 * reflection out-competed a warm diffuse and the wood came out steel blue at
 * hue 224 with a ratio of 1.61x. Neither error is visible in an albedo number.
 *
 * Measuring it off a frame by hand needs a human to say which pixels are dead
 * wood, which is slow, unrepeatable, and biased toward whichever snag looks
 * brightest. So: two captures from one boot of one scene. The first is the frame
 * as it renders. The second replaces the bark shader's output with its own dead
 * mask, which is the exact quantity the material blends on. Intersecting them
 * gives a per-pixel partition of the tree's wood into dead and live, and the
 * statistics follow with no judgement involved.
 *
 * The mask pass is a debug uniform on the bark material, off by default and
 * never touched by a normal render.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run, capture } from './harness.mjs';

const argv = process.argv.slice(2);
const getf = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const VIEW = getf('view', 'juniper');
const W = +getf('width', 1100), H = +getf('height', 620);
const DIR = new URL('..', import.meta.url).pathname.replace(/^\//, '');
const KEEP = argv.includes('--keep');

/* Same viewpoints shoot.mjs uses, so a figure here is comparable with a shot. */
const VIEWS = [
  { name: 'wash_mid', d: 46, yaw: 0, pitch: 0 },
  { name: 'juniper', d: 62, yaw: 34, pitch: 3 },
  { name: 'bend', d: 92, yaw: -22, pitch: 2 },
];
const v = VIEWS.find(x => x.name === VIEW);
if (!v) throw new Error(`no view ${VIEW}; have ${VIEWS.map(x => x.name).join(', ')}`);

const srgb = (c) => c / 255;
/* HSV, on the sRGB frame, which is what every figure in the critique is in. */
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx > 1e-6 ? d / mx : 0, v: mx };
}
/* Circular median for hue, and a plain median for the rest. Averaging hue across
   a distribution that straddles zero returns cyan, which is not a colour on a
   juniper; see the same note in tools/hue.mjs. */
function medAng(xs) {
  if (!xs.length) return NaN;
  let sx = 0, sy = 0;
  for (const a of xs) { sx += Math.cos(a * Math.PI / 180); sy += Math.sin(a * Math.PI / 180); }
  let m = Math.atan2(sy, sx) * 180 / Math.PI;
  return m < 0 ? m + 360 : m;
}
const med = (xs) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
};

await run({ width: W, height: H, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);
  await page.evaluate(([d, yaw, pitch]) => {
    const g = window.__game;
    g.walkTo(d); g.lookAt(yaw, pitch);
  }, [v.d, v.yaw, v.pitch]);
  await page.waitForTimeout(500);

  const lit = path.join(DIR, 'tmp', 'dr_lit.png');
  const msk = path.join(DIR, 'tmp', 'dr_mask.png');
  fs.mkdirSync(path.dirname(lit), { recursive: true });
  await capture(page, lit);

  /* Flip the debug uniform and re-capture the identical frame. Post-processing
     would smear the mask across the boundary between dead and live, so it is
     bypassed for this pass only. */
  const ok = await page.evaluate(() => {
    let found = 0;
    window.__game._scene.traverse(o => {
      const u = o.material && o.material.userData && o.material.userData.uniforms;
      if (u && u.uDebugMask) { u.uDebugMask.value = 1; found++; }
    });
    if (window.__game._post && window.__game._post.setEnabled) {
      window.__game._post.setEnabled(false);
    }
    return found;
  });
  if (!ok) throw new Error('no material exposed uDebugMask — is makeBarkMaterial current?');
  await page.waitForTimeout(350);
  await capture(page, msk);

  /* Decode both PNGs in the page, which already has a working image decoder, and
     hand back only the statistics. */
  const stat = await page.evaluate(async ([a, b]) => {
    const load = async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      return cx.getImageData(0, 0, c.width, c.height);
    };
    const L = await load(a), M = await load(b);
    const dead = [], live = [];
    for (let i = 0; i < M.data.length; i += 4) {
      /* The mask pass writes the dead fraction to all three channels, and the
         background is whatever the sky and rock render to — so a pixel only
         counts as wood if it is a *neutral* mask value, which the sky over this
         view is not. Mid values are the blend band along a strip edge and are
         thrown away rather than assigned to either side. */
      const r = M.data[i], g = M.data[i + 1], bl = M.data[i + 2];
      if (Math.abs(r - g) > 6 || Math.abs(g - bl) > 6) continue;
      const px = [L.data[i], L.data[i + 1], L.data[i + 2]];
      if (r > 225) dead.push(px);
      else if (r < 30) live.push(px);
    }
    return { dead, live };
  }, [`data:image/png;base64,${fs.readFileSync(lit).toString('base64')}`,
      `data:image/png;base64,${fs.readFileSync(msk).toString('base64')}`]);

  const report = (name, px) => {
    if (px.length < 40) { console.log(`${name.padEnd(10)} only ${px.length} px — not enough to quote`); return null; }
    const hs = [], ss = [], vs = [];
    for (const p of px) {
      const c = hsv(srgb(p[0]), srgb(p[1]), srgb(p[2]));
      hs.push(c.h); ss.push(c.s); vs.push(c.v);
    }
    const o = { n: px.length, h: medAng(hs), s: med(ss), v: med(vs) };
    console.log(`${name.padEnd(10)} ${String(o.n).padStart(7)} px   ` +
                `hue ${o.h.toFixed(1).padStart(6)}   sat ${o.s.toFixed(3)}   val ${o.v.toFixed(3)}`);
    return o;
  };

  console.log(`\nrendered wood, view "${VIEW}" at ${W}x${H}, medians over pixels\n`);
  const d = report('deadwood', stat.dead);
  const l = report('live bark', stat.live);
  if (d && l) {
    console.log(`\nvalue ratio   ${(d.v / l.v).toFixed(2)}x        target 3.5x  (real juniper 3.57x)`);
    console.log(`dead hue      ${d.h.toFixed(1)}          target ~27 deg, warm bone`);
    console.log(`dead sat      ${d.s.toFixed(3)}        real juniper 0.134`);
  }
  if (!KEEP) { fs.rmSync(lit, { force: true }); fs.rmSync(msk, { force: true }); }
});

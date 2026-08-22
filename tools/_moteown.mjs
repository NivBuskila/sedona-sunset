/* Whose are the sky motes? Ablation at the delivery resolution, one page load.
 *
 *   node tools/_moteown.mjs
 *
 * A delivery critic reported isolated saturated orange and olive dots in open
 * sky in three of nine framings and called it the most unambiguous
 * not-a-photograph signal in the set. Two candidates: the vegetation planted on
 * wall rims and butte tops, which is by definition the geometry nearest the
 * skyline, and the atmosphere's dust.
 *
 * Per-pixel ablation is the usual instrument here and it is the wrong one for
 * this defect. These dots are one to eight pixels. Whether a given one exists at
 * all depends on where its geometry falls relative to a sample point, so at a
 * different resolution it can vanish or move — and tools/_pixowner.mjs renders at
 * 1600x900 while the delivery frames are 1997x1123. Asking "did this pixel
 * change" would then answer about a mote that is not the one reported.
 *
 * So this counts the *population* at the delivery resolution instead, with one
 * candidate hidden at a time. A population that drops to zero when an object is
 * hidden is owned by that object, and it does not matter that the individuals
 * are not in one-to-one correspondence between arms.
 */
import { run } from './harness.mjs';
import { byName } from './views.mjs';
import { findMotes, SATURATED } from './_skymote.mjs';

const W = 1997, H = 1123;          // the delivery set's resolution, exactly
const VIEWS = ['juniper', 'wash_mid', 'sun_gap'];

/* Name prefixes to hide, one arm each. `dust` is the atmosphere's and `veg` is
   the supporting vegetation; the hero is separated from the rest of the planting
   because it is a different author's problem if it turns out to be the owner. */
const ARMS = [
  ['all on', null],
  ['no dust', ['dust']],
  ['no veg-*', ['veg']],
  ['no juniper-*', ['juniper']],
  /* Hiding one object can *add* a dot as well as remove one, because revealing
     the sky behind it can satisfy the detector's ring test for a neighbour that
     previously failed it. So the residual after the clear owner is removed has to
     be attributed with that owner already hidden, not on its own. */
  ['no dust + veg', ['dust', 'veg']],
  ['no dust + juniper', ['dust', 'juniper']],
  ['no dust + veg + juniper', ['dust', 'veg', 'juniper']],
];

const PAGE = /* js */`
  window.__mo = (() => {
    const g = window.__game;
    const r = g.renderer;
    const w = r.domElement.width, h = r.domElement.height;
    const gl = r.getContext();
    return {
      dims: () => ({ w, h }),
      shot: (pre) => {
        g.setPaused(true);
        const hidden = [];
        if (pre) {
          g._scene.traverse(o => {
            if (!(o.isMesh || o.isPoints || o.isSprite)) return;
            const n = o.name || '';
            if (!o.visible) return;
            if (pre.some(p => n === p || n.indexOf(p) === 0)) {
              o.visible = false; hidden.push(o);
            }
          });
        }
        g.renderOnce();
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        for (const o of hidden) o.visible = true;
        g.setPaused(false);
        const rgb = new Uint8Array(w * h * 3);
        for (let y = 0; y < h; y++) {
          const sy = h - 1 - y;
          for (let x = 0; x < w; x++) {
            const s = (sy * w + x) * 4, d = (y * w + x) * 3;
            rgb[d] = buf[s]; rgb[d + 1] = buf[s + 1]; rgb[d + 2] = buf[s + 2];
          }
        }
        let str = '';
        for (let i = 0; i < rgb.length; i += 4096)
          str += String.fromCharCode.apply(null, rgb.subarray(i, i + 4096));
        return { b: btoa(str), hidden: hidden.length };
      },
    };
  })();
`;

const rows = [];
await run({ width: W, height: H, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);
  await page.evaluate(PAGE);
  const { w, h } = await page.evaluate(() => window.__mo.dims());
  if (w !== W || h !== H) console.log(`note: canvas is ${w}x${h}, asked for ${W}x${H}`);

  for (const vn of VIEWS) {
    const v = byName(vn);
    await page.evaluate(([d, yaw, pitch]) => {
      const g = window.__game;
      g.walkTo(d); g.lookAt(yaw, pitch);
    }, [v.d, v.yaw, v.pitch]);
    await page.waitForTimeout(900);

    for (const [label, pre] of ARMS) {
      const r = await page.evaluate(p => window.__mo.shot(p), pre);
      const px = Buffer.from(r.b, 'base64');
      const ms = findMotes({ w, h, ch: 3, px });
      rows.push({ view: vn, label, hidden: r.hidden,
        n: ms.length, sat: ms.filter(SATURATED).length });
    }
  }
});

console.log(`\nsky motes by ablation, ${W}x${H}, one page load`);
console.log('  n   = isolated warm dots in open sky');
console.log('  sat = those with r-b > 90, the "saturated orange and olive" family\n');
console.log('  view       arm            meshes hidden     n   sat');
for (const r of rows) {
  console.log(`  ${r.view.padEnd(10)} ${r.label.padEnd(14)} ${String(r.hidden).padStart(13)}`
    + ` ${String(r.n).padStart(5)} ${String(r.sat).padStart(5)}`);
}

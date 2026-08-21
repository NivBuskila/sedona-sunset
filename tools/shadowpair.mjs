/* Did the cheaper footprint shadow filter move a pixel?
 *
 *   node tools/shadowpair.mjs                 the four windowed views
 *   node tools/shadowpair.mjs --all           all eight
 *   node tools/shadowpair.mjs --tag sp        prefix for the PNGs
 *
 * `src/terrain.js` replaced the four *offset* taps of its footprint shadow
 * filter — each a full getShadow, which is sixteen texture2DCompare calls under
 * PCF_SOFT — with a four-tap bilinear coverage lookup, and gated the whole
 * block on the weight that multiplies it. The centre tap is untouched. The
 * claim is that this is worth two thirds of the frame and costs nothing
 * visible. The second half of that claim is the one that needs proving, because
 * CONTRACT.md's colour and structure bands were established over days by four
 * other systems and an optimisation that moves them is the wrong optimisation.
 *
 * ── why this is one page load and not two shoot.mjs runs ───────────────────
 *
 * CONTRACT.md: "Two captures are not a pair." With six agents committing, the
 * gap between two runs is however long the second waits on the capture lock,
 * which has run over an hour, and one attempt lost its control to a file
 * rewritten twenty-two seconds after the first half finished. So both halves
 * are rendered from one page, one module set, one set of procedural textures,
 * one sun — with a single substitution in the assembled fragment shader between
 * them. Matched by construction.
 *
 * The substitution restores the *old* estimator, so `old` is the control and
 * `new` is HEAD. Both PNGs land in shots/ with the ordinary naming, so
 * tools/grad.mjs, tools/sat.mjs and tools/hue.mjs read them without argument.
 *
 * It also prints its own pixel diff, which is the thing that decides the
 * question fastest: mean and maximum absolute code-value difference over the
 * whole frame and over the region the change can actually reach.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { VIEWS } from './views.mjs';
import { decode } from './png.mjs';

const args = process.argv.slice(2);
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes('--' + k);

const W = Number(getf('w', 1280)), H = Number(getf('h', 720));
const TAG = getf('tag', 'sp');
const views = has('all') ? VIEWS
  : VIEWS.filter(v => ['wash_mid', 'wall_lit', 'wall_shade', 'bend'].includes(v.name));

/* Two literal substrings, both short and both unique, so a miss is detectable
   rather than silent. `applied` is reported per variant for that reason. */
const OLD = [
  ['footTap(sm, sz, si, sb, sc', 'getShadow(sm, sz, si, sb, sr, sc'],
  ['wide > 0.02', 'wide > -1.0'],
];

process.env.RENDER_GPU = '1';
const { serve, LAUNCH_ARGS } = await import('./harness.mjs');

const shotsDir = new URL('../shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(shotsDir, { recursive: true });

const srv = serve();
await new Promise(r => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/#noadapt`;

const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + (e.stack || e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 300_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const adapter = await page.evaluate(() => {
    const gl = window.__game.renderer.getContext();
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
  console.log(`\n  ${W}x${H}\n  ${adapter}`);

  await page.evaluate((subs) => {
    const mat = window.__game._scene.getObjectByName('terrain').material;
    window.__sp = { mat, saved: mat.onBeforeCompile, old: false, applied: 0, subs };
    mat.onBeforeCompile = function (shader, renderer) {
      window.__sp.saved.call(this, shader, renderer);
      if (!window.__sp.old) return;
      let n = 0;
      for (const [find, rep] of window.__sp.subs) {
        const parts = shader.fragmentShader.split(find);
        n += parts.length - 1;
        shader.fragmentShader = parts.join(rep);
      }
      window.__sp.applied = n;
    };
    mat.customProgramCacheKey = () => 'sedona-terrain-v3|sp:' + (window.__sp.old ? 'old' : 'new');
    mat.needsUpdate = true;
  }, OLD);

  const setVariant = (old) => page.evaluate((o) => {
    window.__sp.old = o;
    window.__sp.applied = 0;
    window.__sp.mat.needsUpdate = true;
    window.__game.renderOnce();
    return window.__sp.applied;
  }, old);

  const shot = async (file) => {
    const png = await page.evaluate(() => {
      const g = window.__game;
      g.setPaused(true);
      g.renderOnce();
      const u = g.renderer.domElement.toDataURL('image/png');
      g.setPaused(false);
      return u;
    });
    fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  };

  /* Five substitution sites expected: four footTap calls and one gate. Printed
     rather than assumed, because "a change that did nothing and a change that
     was never applied look identical" is this project's most repeated lesson. */
  const applied = await setVariant(true);
  console.log(`  control substitutions applied: ${applied} (expect 5)`);
  await setVariant(false);

  const rows = [];
  for (const v of views) {
    await page.evaluate(([d, yaw, pitch]) => {
      window.__game.walkTo(d);
      window.__game.lookAt(yaw, pitch);
    }, [v.d, v.yaw, v.pitch]);
    await page.waitForTimeout(250);

    await setVariant(true);
    const fOld = path.join(shotsDir, `${TAG}old_${v.name}.png`);
    await shot(fOld);
    await setVariant(false);
    const fNew = path.join(shotsDir, `${TAG}new_${v.name}.png`);
    await shot(fNew);

    const a = decode(fs.readFileSync(fOld)), b = decode(fs.readFileSync(fNew));
    let sum = 0, max = 0, over1 = 0, over4 = 0, n = 0;
    let la = 0, lb = 0;
    for (let i = 0; i < a.w * a.h; i++) {
      const ia = i * a.ch, ib = i * b.ch;
      const d = Math.max(Math.abs(a.px[ia] - b.px[ib]),
                         Math.abs(a.px[ia + 1] - b.px[ib + 1]),
                         Math.abs(a.px[ia + 2] - b.px[ib + 2]));
      sum += d; if (d > max) max = d;
      if (d >= 1) over1++;
      if (d >= 4) over4++;
      la += a.px[ia] * 0.2126 + a.px[ia + 1] * 0.7152 + a.px[ia + 2] * 0.0722;
      lb += b.px[ib] * 0.2126 + b.px[ib + 1] * 0.7152 + b.px[ib + 2] * 0.0722;
      n++;
    }
    rows.push({ view: v.name, mean: sum / n, max, over1: over1 / n, over4: over4 / n,
      lOld: la / n, lNew: lb / n });
  }

  console.log('\n  ── control (old estimator) against HEAD, matched in one page load ──');
  console.log('  view          mean |d|   max |d|   px>=1   px>=4    L old    L new     dL');
  for (const r of rows) {
    console.log(`  ${r.view.padEnd(12)} ${r.mean.toFixed(3).padStart(8)} ${String(r.max).padStart(9)} ` +
      `${(r.over1 * 100).toFixed(2).padStart(6)}% ${(r.over4 * 100).toFixed(2).padStart(6)}% ` +
      `${r.lOld.toFixed(2).padStart(8)} ${r.lNew.toFixed(2).padStart(8)} ` +
      `${(r.lNew - r.lOld).toFixed(3).padStart(7)}`);
  }
  console.log(`\n  shots/${TAG}old_*.png and shots/${TAG}new_*.png — run grad.mjs, sat.mjs, hue.mjs on both.`);

  if (errs.length) {
    console.log('\n  ── page errors ──');
    [...new Set(errs)].slice(0, 10).forEach(e => console.log('   ', e));
  } else {
    console.log('  no page errors.');
  }
} catch (e) {
  console.error('\n✗ shadowpair failed:', e && e.message || e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  srv.close();
}

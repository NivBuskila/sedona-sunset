/* One number per commit, so a regression can be bisected instead of argued.
 *
 *   node tools/_regress.mjs                        measure the working tree
 *   node tools/_regress.mjs --root ../wt --tag abc1234
 *   node tools/_regress.mjs --ablate               price the suspects on HEAD
 *
 * ── why not tools/bench.mjs ────────────────────────────────────────────────
 *
 * bench.mjs takes four minutes: three views, seven blocks of thirty, nine
 * ablation columns and a tier table. That is the right shape for a delivery
 * table and the wrong shape for walking fourteen commits, where what is wanted
 * is one comparable number as fast as the scene can be booted. This measures
 * exactly what bench.mjs's `wash_mid` / rung 0 cell measures — same station,
 * same paused loop, same readPixels fence, same median of blocks — and nothing
 * else, so the figures drop straight into that table's units.
 *
 * ── serving a worktree ─────────────────────────────────────────────────────
 *
 * The tree is shared with several other agents, so checking out an old commit in
 * it is not available and `git stash` is forbidden here for reasons the contract
 * records. A detached worktree elsewhere is the safe way to hold an old commit,
 * and it has no node_modules because node_modules is ignored. So the server maps
 * /node_modules/* at the *main* tree and everything else at the worktree. That
 * pins the three version across every commit measured, which is what you want
 * anyway: a bisect that also changes the renderer is not a bisect.
 *
 * ── and it refuses to report a frame it has not looked at ──────────────────
 *
 * Twice in one night this tree rendered a blinding white desert, once with no
 * console error at all, and an old commit is exactly where a half-finished
 * shader lives. A blown-out or black frame is *cheap*, so a bisect run on one
 * reports the regression as fixed. Every measurement here carries the frame's
 * mean luminance and clipped fraction, and the driver should discard any row
 * whose frame does not look like the scene.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from './png.mjs';

const args = process.argv.slice(2);
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes('--' + k);

const MAIN = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.resolve(getf('root', MAIN));
const TAG = getf('tag', 'worktree');
const W = Number(getf('w', 2560)), H = Number(getf('h', 1440));
const BLOCKS = Number(getf('blocks', 7)), PER = Number(getf('per', 30));

process.env.RENDER_GPU = '1';
const { LAUNCH_ARGS } = await import('./harness.mjs');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm', '.css': 'text/css' };

const srv = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  /* node_modules from the main tree, everything else from the commit under test. */
  const base = p.startsWith('/node_modules/') ? MAIN : ROOT;
  const file = path.join(base, p);
  if (!file.startsWith(base)) { rs.writeHead(403).end(); return; }
  fs.readFile(file, (e, b) => {
    if (e) { rs.writeHead(404).end(); return; }
    rs.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    rs.end(b);
  });
});
await new Promise(r => srv.listen(0, r));
const PORT = srv.address().port;

/* ── the suspects, for --ablate ────────────────────────────────────────────
 *
 * Priced as shader substitutions rather than by checking out a parent commit,
 * because that answers the question the trade actually needs: what does *this
 * term* cost, in the tree as it stands, with everything else present. A commit
 * bisect says which change the milliseconds arrived with; an ablation says which
 * expression they are in and therefore whether a cheaper formulation is worth
 * looking for. Both are run, and they check each other.
 *
 * `find` must match the shipping source exactly. Every row reports how many
 * sites it hit, and a row reporting 0 is a stale pattern and not a free feature
 * — that mistake has already cost this project a night once.
 */
const ABLATIONS = [
  // terrain.js 2548d04 — occlusion tints toward albedo instead of black
  ['t.occ-tint', 'occTint', 'vec3(0.0); if (false) occTint'],
  // terrain.js 0dbd81d / 2548d04 — the geometric rake march reading an explicit mip
  ['t.rake-march', 'texture2DGradEXT(uDirtM, d1 + uSunStep * t, ddx, ddy).b', '0.0'],
  // rock.js 25c93fb / 0609843 — the joint blocks
  ['r.joints', 'jointBlock', 'vec3(0.0); if (false) jointBlock'],
];

const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
const out = { tag: TAG, root: ROOT, w: W, h: H, rows: [] };

try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });

  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/#noadapt`, { waitUntil: 'domcontentloaded', timeout: 420_000 });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  out.bootMs = Date.now() - t0;

  const frame = async () => {
    let b;
    try { b = await page.screenshot({ type: 'png', timeout: 120_000 }); }
    catch (e) { return { L: null, hot: null }; }
    const img = decode(b);
    let sum = 0, hot = 0;
    const n = img.w * img.h;
    for (let i = 0; i < n; i++) {
      const k = i * img.ch;
      sum += img.px[k] * 0.2126 + img.px[k + 1] * 0.7152 + img.px[k + 2] * 0.0722;
      if (img.px[k] >= 250 && img.px[k + 1] >= 250 && img.px[k + 2] >= 250) hot++;
    }
    return { L: +(sum / n).toFixed(2), hot: +(100 * hot / n).toFixed(2) };
  };

  const measure = async (label) => {
    const r = await page.evaluate(async ([blocks, per]) => {
      const g = window.__game, gl = g.renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      g.setPaused(true);
      g.perf.setTier('high');
      g.perf.setScale(1);
      g.walkTo(46); g.lookAt(0, 0);
      /* Warm past every reallocation a tier or scale change causes before the
         first block is timed. Six frames was not enough once and the row it
         produced read 42 ms against a true 20. */
      for (let i = 0; i < 60; i++) g.renderOnce();
      sync();
      const ms = [];
      for (let b = 0; b < blocks; b++) {
        const t = performance.now();
        for (let i = 0; i < per; i++) g.renderOnce();
        sync();
        ms.push((performance.now() - t) / per);
      }
      ms.sort((a, b2) => a - b2);
      const info = g.info ? g.info() : g.renderer.info.render;
      return {
        ms: +ms[ms.length >> 1].toFixed(3),
        lo: +ms[0].toFixed(3), hi: +ms[ms.length - 1].toFixed(3),
        calls: info.calls, tris: info.triangles,
        buffer: g.perf.stats().buffer.join('x'),
      };
    }, [BLOCKS, PER]);
    return { label, ...r };
  };

  const f = await frame();
  out.frame = f;
  out.real = f.L != null && f.L > 6 && f.L < 200 && f.hot < 20;

  out.rows.push(await measure('full'));

  if (has('ablate')) {
    /* Substitutions go in through onBeforeCompile on every material in the
       scene, with the active row folded into customProgramCacheKey so three
       relinks instead of handing back the cached program. That last part is not
       optional: an ablation that does not relink measures nothing and reports a
       confident null result, which is how `-shadow` read 30.54 against 30.49 for
       weeks. */
    await page.evaluate(() => {
      window.__ab = { sub: null, sites: {} };
      window.__game.scene.traverse((o) => {
        const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of list) {
          if (m.__abWrapped) continue;
          m.__abWrapped = true;
          const saved = m.onBeforeCompile;
          m.onBeforeCompile = function (sh, rn) {
            if (saved) saved.call(this, sh, rn);
            const s = window.__ab.sub;
            if (!s) return;
            const parts = sh.fragmentShader.split(s.find);
            window.__ab.sites[s.name] = (window.__ab.sites[s.name] || 0) + parts.length - 1;
            sh.fragmentShader = parts.join(s.replace);
          };
          const key = m.customProgramCacheKey;
          m.customProgramCacheKey = function () {
            return (key ? key.call(this) : '') + '|ab:' + (window.__ab.sub ? window.__ab.sub.name : '');
          };
        }
      });
    });
    for (const [name, find, replace] of ABLATIONS) {
      await page.evaluate(([name, find, replace]) => {
        window.__ab.sub = { name, find, replace };
        window.__ab.sites[name] = 0;
        window.__game.scene.traverse((o) => {
          const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          for (const m of list) m.needsUpdate = true;
        });
        window.__game.renderOnce();
      }, [name, find, replace]);
      const row = await measure(name);
      row.sites = await page.evaluate(n => window.__ab.sites[n] | 0, name);
      row.frame = await frame();
      out.rows.push(row);
    }
    await page.evaluate(() => {
      window.__ab.sub = null;
      window.__game.scene.traverse((o) => {
        const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of list) m.needsUpdate = true;
      });
      window.__game.renderOnce();
    });
    out.rows.push(await measure('full again'));
  }

  out.errors = [...new Set(errs)].slice(0, 6);
} catch (e) {
  out.error = String(e && e.message || e).slice(0, 300);
} finally {
  await browser.close().catch(() => {});
  srv.close();
}

if (has('json')) { console.log(JSON.stringify(out)); }
else {
  const base = out.rows[0];
  console.log(`\n  ${out.tag}   ${W}x${H}   boot ${((out.bootMs || 0) / 1000).toFixed(0)}s` +
    `   frame L ${out.frame ? out.frame.L : '?'} clipped ${out.frame ? out.frame.hot : '?'}%` +
    `   ${out.real ? 'looks like the scene' : '✗ DOES NOT LOOK LIKE THE SCENE'}`);
  if (out.error) console.log(`  ✗ ${out.error}`);
  console.log('  what                    ms      lo      hi    saved   sites  calls    tris');
  for (const r of out.rows) {
    const saved = base && r !== base ? (base.ms - r.ms) : null;
    console.log(`  ${r.label.padEnd(16)} ${r.ms.toFixed(2).padStart(8)} ${r.lo.toFixed(2).padStart(7)} ` +
      `${r.hi.toFixed(2).padStart(7)} ${(saved == null ? '' : saved.toFixed(2)).padStart(8)}  ` +
      `${(r.sites == null ? '' : r.sites === 0 ? '0 STALE' : String(r.sites)).padStart(7)} ` +
      `${String(r.calls).padStart(6)} ${((r.tris / 1e6).toFixed(2) + 'M').padStart(7)}`);
  }
  if (out.errors && out.errors.length) { console.log('  page errors:'); out.errors.forEach(e => console.log('    ' + e)); }
  console.log('');
}
fs.writeFileSync(path.join(MAIN, 'tmp', `reg_${TAG}.json`), JSON.stringify(out, null, 2));

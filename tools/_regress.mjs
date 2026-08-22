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
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decode } from './png.mjs';

/* The machine's state, sampled while the frame is being timed.
 *
 * The lesson of this file's own first result. bench.mjs read 16.80 ms at 05:00
 * and 24.48 at 07:45 and the difference was escalated as a 39% code regression;
 * the bisect below found the frame flat across every commit in the window and the
 * GPU sitting at a 65-100% utilisation floor from an animated desktop wallpaper,
 * the vendor overlay and fourteen chrome processes belonging to other agents. A
 * millisecond written into a contract without the machine's state beside it
 * cannot be compared with another one taken two hours later, and this project has
 * now spent real time on exactly that. Best-effort: no nvidia-smi, no column. */
function sampleGpu(ms) {
  const out = [];
  let stop = false;
  const tick = () => {
    if (stop) return;
    execFile('nvidia-smi',
      ['--query-gpu=utilization.gpu,clocks.sm', '--format=csv,noheader,nounits'],
      (e, so) => {
        if (!e && so) {
          const [u, c] = so.trim().split('\n')[0].split(',').map(s => +s);
          if (Number.isFinite(u)) out.push([u, c]);
        }
        if (!stop) setTimeout(tick, ms);
      });
  };
  tick();
  return () => {
    stop = true;
    if (!out.length) return null;
    const u = out.map(a => a[0]);
    return {
      n: u.length,
      mean: Math.round(u.reduce((a, b) => a + b, 0) / u.length),
      min: Math.min(...u), max: Math.max(...u),
      clock: Math.round(out.reduce((a, b) => a + b[1], 0) / out.length),
    };
  };
}

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
const CUBIC = 'clamp(tAO * (aoC1 * tAO * tAO + aoC2 * tAO + aoC3), vec3(tAO), vec3(1.0))';
const TINT = 's4AoTint(tNrmW, tAO)';

const ABLATIONS = [
  /* The indirect-light fix, in the two halves it is actually built from. Both
     anchors appear verbatim in terrain.js and rock.js — the comment beside each
     says "same expression as the other, change both" — so a live row reads 2
     sites and a row reading 1 means one of the two files moved under the probe.
     Replacing the cubic with vec3(tAO) is the exact pre-change form the comment
     records, and it strands aoC1..aoC3 as dead code, which is the point: their
     evaluation is what is being priced. */
  ['ind.cubic', [[CUBIC, 'vec3(tAO)']]],
  ['ind.s4AoTint', [[TINT, 'vec3(1.0)']]],
  /* And both together, which is `indirectDiffuse *= tAO` — the line as it stood
     before either change. This is the number the trade needs. */
  ['ind.both', [[CUBIC, 'vec3(tAO)'], [TINT, 'vec3(1.0)']]],
  /* Cliff jointing. `joint` has exactly one consumer, so cutting it strands the
     four jointTrace marches and everything feeding them; the compiler removes
     the chain and the row prices all of it. */
  ['rock.joints', [['albedo *= 1.0 - joint * 0.46;', 'albedo *= 1.0;']]],
  /* System 4's one-token warning fix at eba1fc0, run backwards: put texture2D
     back where texture2DLodEXT now is, in both tap loops of the penumbra filter.
     A negative saving here means the fix bought frame time as well as silence.
     Both loops are in the shared shadow chunk, so this lands on every material
     that samples a shadow — the site count is the whole scene's worth, and a
     count of 0 would mean this ran against a tree from before the fix. */
  ['s4.lod0-off', [['texture2DLodEXT( map, p.xy + o, 0.0 )', 'texture2D( map, p.xy + o )']]],
];

const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
const out = { tag: TAG, root: ROOT, w: W, h: H, rows: [] };
let stopGpu = () => null;

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

  const measure = async (label, moving = has('moving')) => {
    const r = await page.evaluate(async ([blocks, per, moving]) => {
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
      const run = (draw) => {
        for (let i = 0; i < 12; i++) draw();
        sync();
        const ms = [];
        for (let b = 0; b < blocks; b++) {
          const t = performance.now();
          for (let i = 0; i < per; i++) draw();
          sync();
          ms.push((performance.now() - t) / per);
        }
        ms.sort((a, b2) => a - b2);
        return { ms: +ms[ms.length >> 1].toFixed(3), lo: +ms[0].toFixed(3), hi: +ms[ms.length - 1].toFixed(3) };
      };
      const held = run(() => g.renderOnce());
      /* The two cascades are not on the capture surface either — `__game` has the
         renderer, the walk and the governor, and CONTRACT.md's list stops there —
         so they come off the graph. Order matters only in that both are wanted;
         suppressing either one alone is a different measurement. */
      const lights = [];
      if (window.__scene) window.__scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) lights.push(o); });
      if (!moving || lights.length < 2) {
        const inf = g.info ? g.info() : g.renderer.info.render;
        return { ...held, calls: inf.calls, tris: inf.triangles,
          buffer: g.perf.stats().buffer.join('x'), lights: lights.length };
      }
      /* And again with the rig creeping, which is what a walking player pays and
         what nothing in this project had ever measured: the two shadow cascades
         redraw when the rig moves, and every bench holds the camera still. Five
         centimetres a frame is a jog at 60 fps. */
      let d = 46;
      const walked = run(() => { g.walkTo(d += 0.05); g.lookAt(0, 0); g.renderOnce(); });
      /* And once more moving, with both cascade redraws suppressed at the last
         moment, to split the walking penalty in two. Everything walkTo does —
         height sampling, collision, whatever rescatters — is still paid; only the
         two shadow passes are not. The difference between this row and the one
         above is the redraw, and the difference between this row and `held` is
         the rest of walking. They were being reported as one number, which was an
         attribution and not a measurement. */
      const noRedraw = run(() => {
        g.walkTo(d += 0.05); g.lookAt(0, 0);
        for (const l of lights) { l.shadow.autoUpdate = false; l.shadow.needsUpdate = false; }
        g.renderOnce();
      });
      for (const l of lights) { l.shadow.autoUpdate = true; l.shadow.needsUpdate = true; }
      g.renderer.shadowMap.needsUpdate = true;
      g.walkTo(46); g.lookAt(0, 0); g.renderOnce();
      const info = g.info ? g.info() : g.renderer.info.render;
      return {
        ...held, moving: walked.ms, movingLo: walked.lo, movingHi: walked.hi,
        noRedraw: noRedraw.ms,
        calls: info.calls, tris: info.triangles,
        buffer: g.perf.stats().buffer.join('x'),
      };
    }, [BLOCKS, PER, moving]);
    return { label, ...r };
  };

  const f = await frame();
  out.frame = f;
  out.real = f.L != null && f.L > 6 && f.L < 200 && f.hot < 20;

  /* The scene graph, taken off the renderer as it is handed one, because neither
     the graph nor the two cascade lights are on the `__game` capture surface and
     widening a public API that other systems are shooting captures against is
     not worth it for a probe. The post chain also renders fullscreen-quad
     scenes, so pick the one carrying fog: that is the world. */
  await page.evaluate(() => {
    const r = window.__game.renderer, orig = r.render.bind(r);
    r.render = (sc, cam) => { if (sc && sc.fog) window.__scene = sc; orig(sc, cam); };
    window.__game.renderOnce();
    r.render = orig;
  });
  stopGpu = sampleGpu(700);
  process.stderr.write(`  [${TAG}] booted in ${((out.bootMs) / 1000).toFixed(0)}s, timing full\n`);
  out.rows.push(await measure('full'));

  if (has('ablate')) {
    /* Substitutions go in through onBeforeCompile on every material in the
       scene, with the active row folded into customProgramCacheKey so three
       relinks instead of handing back the cached program. That last part is not
       optional: an ablation that does not relink measures nothing and reports a
       confident null result, which is how `-shadow` read 30.54 against 30.49 for
       weeks. */
    const found = await page.evaluate(() => !!window.__scene &&
      window.__scene.children.length);
    if (!found) throw new Error('could not reach the scene graph to ablate');
    await page.evaluate(() => {
      window.__ab = { sub: null, sites: {} };
      window.__scene.traverse((o) => {
        const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of list) {
          if (m.__abWrapped) continue;
          m.__abWrapped = true;
          const saved = m.onBeforeCompile;
          m.onBeforeCompile = function (sh, rn) {
            if (saved) saved.call(this, sh, rn);
            const s = window.__ab.sub;
            if (!s) return;
            for (const [find, replace] of s.subs) {
              const parts = sh.fragmentShader.split(find);
              window.__ab.sites[s.name] = (window.__ab.sites[s.name] || 0) + parts.length - 1;
              sh.fragmentShader = parts.join(replace);
            }
          };
          const key = m.customProgramCacheKey;
          m.customProgramCacheKey = function () {
            return (key ? key.call(this) : '') + '|ab:' + (window.__ab.sub ? window.__ab.sub.name : '');
          };
        }
      });
    });
    /* Interleaved, baseline immediately before every ablation, and the delta
       taken against *that* baseline rather than against one measurement at the
       start.
     *
     * Not caution for its own sake. The first run of this pass read the closing
     * `full again` row 3.6 ms above the opening `full` row while the GPU's
     * utilisation swung between 58% and 100% — another agent's capture starting
     * or finishing inside the window. The effects being priced here are two
     * tenths to six tenths of a millisecond. Unpaired, every one of them is
     * noise wearing a number, and the run would have reported a confident null
     * for a term that had not been measured at all. */
    const apply = async (name, subs) => {
      await page.evaluate(([name, subs]) => {
        window.__ab.sub = subs ? { name, subs } : null;
        window.__ab.sites[name] = 0;
        window.__scene.traverse((o) => {
          const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          for (const m of list) m.needsUpdate = true;
        });
        window.__game.renderOnce();
      }, [name, subs]);
    };
    for (const [name, subs] of ABLATIONS) {
      await apply('base:' + name, null);
      const base = await measure('base');
      await apply(name, subs);
      const row = await measure(name);
      row.sites = await page.evaluate(n => window.__ab.sites[n] | 0, name);
      row.base = base.ms;
      row.saved = +(base.ms - row.ms).toFixed(3);
      out.rows.push(row);
      process.stderr.write(`  [${TAG}] ${name}: ${row.ms.toFixed(2)} against ` +
        `${base.ms.toFixed(2)} paired = ${row.saved > 0 ? '-' : '+'}${Math.abs(row.saved).toFixed(2)} ms, ` +
        `${row.sites} site${row.sites === 1 ? '' : 's'}${row.sites ? '' : ' — STALE PATTERN, not a free feature'}\n`);
    }
    await apply('restore', null);
    out.rows.push(await measure('full again'));
  }

  out.errors = [...new Set(errs)].slice(0, 6);
} catch (e) {
  out.error = String(e && e.message || e).slice(0, 300);
} finally {
  /* In the finally, not at the end of the try. The sampler is a self-scheduling
     setTimeout chain, so it holds the event loop open; leaving it running on the
     error path does not fail the run, it hangs it forever with the measurement
     already taken and never printed. Two runs and about fifteen minutes went
     that way, which is the same shape as the four captures lost tonight to a
     tool that could not finish and could not say why. */
  out.gpuLoad = stopGpu();
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
  console.log('  what                  held  paired   saved  moving    walk  redraw   sites   tris');
  for (const r of out.rows) {
    console.log(`  ${r.label.padEnd(16)} ${r.ms.toFixed(2).padStart(8)} ` +
      `${(r.base == null ? '' : r.base.toFixed(2)).padStart(7)} ` +
      `${(r.saved == null ? '' : (r.saved >= 0 ? '-' : '+') + Math.abs(r.saved).toFixed(2)).padStart(7)} ` +
      `${(r.moving == null ? '' : r.moving.toFixed(2)).padStart(7)} ` +
      `${(r.noRedraw == null ? '' : '+' + (r.noRedraw - r.ms).toFixed(2)).padStart(7)} ` +
      `${(r.noRedraw == null ? '' : '+' + (r.moving - r.noRedraw).toFixed(2)).padStart(7)}  ` +
      `${(r.sites == null ? '' : r.sites === 0 ? '0 STALE' : String(r.sites)).padStart(6)} ` +
      `${((r.tris / 1e6).toFixed(2) + 'M').padStart(6)}`);
  }
  if (out.gpuLoad) console.log(`  GPU during the run: mean ${out.gpuLoad.mean}% util, ` +
    `${out.gpuLoad.min}-${out.gpuLoad.max}%, sm clock ${out.gpuLoad.clock} MHz — ` +
    'a millisecond without this beside it cannot be compared with one taken an hour later');
  if (out.errors && out.errors.length) { console.log('  page errors:'); out.errors.forEach(e => console.log('    ' + e)); }
  console.log('');
}
fs.writeFileSync(path.join(MAIN, 'tmp', `reg_${TAG}.json`), JSON.stringify(out, null, 2));

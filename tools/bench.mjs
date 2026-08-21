/* What a frame of this scene actually costs, on the GPU that is actually in the
 * machine.
 *
 *   node tools/bench.mjs                     the whole thing, 1920x1080
 *   node tools/bench.mjs --w 2560 --h 1440    at your real desktop resolution
 *   node tools/bench.mjs --cpu                SwiftShader, for comparison only
 *   node tools/bench.mjs --json               machine-readable, for pasting back
 *
 * ── why this file has to exist ─────────────────────────────────────────────
 *
 * Every other tool in this project renders through SwiftShader, a CPU software
 * rasteriser, deliberately: a capture must never take the GPU away from someone
 * playing a game on this machine. The cost of that decision is that until now
 * nothing here had ever been measured. Triangle counts and draw calls were
 * known and were never the problem; the fragment cost — twenty-odd texture
 * fetches per ground pixel, a multisampled half-float offscreen buffer, 56,000
 * blended point sprites — was pure inference.
 *
 * So this is the one tool that runs on the real adapter. It is still headless,
 * still pinned to four of twelve cores at Idle priority, and it is *cheaper* on
 * the CPU than a SwiftShader capture, not more expensive: the work moves to the
 * GPU and the CPU mostly waits. It takes about a minute.
 *
 * ── how it measures, and why not the obvious way ───────────────────────────
 *
 * Three traps, all of which this avoids, and all of which were paid for once
 * already in the sibling project this method is taken from:
 *
 *   1. Watching the framerate cannot work. The loop is capped and vsynced, so a
 *      display will happily report exactly 200 for anything that fits in 5 ms
 *      and tell you nothing about how much of the budget was used. The loop is
 *      therefore paused and frames are driven by hand.
 *
 *   2. glFinish() in the page is a lie. Chromium runs WebGL over a command
 *      buffer into a separate GPU process, and finish() returns once that queue
 *      has been handed over, not once the hardware has drained it. It times how
 *      fast JavaScript can submit draw calls — microseconds, for a scene of
 *      fifty. A one-pixel readPixels cannot return before the frame exists, so
 *      it is a real fence and costs nothing beyond the wait.
 *
 *   3. Sequential A-then-B comparison charges the driver's clock ramp entirely
 *      to whichever ran first, which is how a cheap pass gets blamed for a
 *      millisecond that belonged to the GPU waking up. Blocks are interleaved
 *      and the median of seven is reported.
 *
 * Where the driver exposes EXT_disjoint_timer_query_webgl2 the GPU's own answer
 * is reported beside the wall-clock one. They should agree; if they do not, the
 * wall-clock figure is the one that includes the present.
 *
 * ── what to send back ──────────────────────────────────────────────────────
 *
 * All of it. The tier table says whether the quality ladder is calibrated, the
 * ablation table says which system to attack next, and the header line proves
 * the run was on the GPU rather than falling back to software — a SwiftShader
 * run reports numbers a hundred times larger and means nothing.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes('--' + k);

const W = Number(getf('w', 1920)), H = Number(getf('h', 1080));
const CPU = has('cpu');
const JSON_OUT = has('json');
const REPS = Number(getf('reps', 30));
const BLOCKS = Number(getf('blocks', 7));

/* The three viewpoints the frame cost actually differs between, chosen from the
   standard capture set rather than invented, so a number here can be compared
   against a picture in shots/. wall_lit is the rock shader over most of the
   frame; wash_mid is the terrain shader over most of the frame with a long
   grazing view, which is its worst case; sun_gap looks into the sun, which is
   where the dust, the shafts and the shimmer all cost the most. */
const VIEWS = [
  { name: 'wash_mid',  d: 46,  yaw: 0,  pitch: 0 },
  { name: 'wall_lit',  d: 46,  yaw: 72, pitch: 12 },
  { name: 'sun_gap',   d: 120, yaw: 0,  pitch: 6 },
];

/* The rasteriser choice and the flags that implement it belong to
   tools/harness.mjs, which decides from RENDER_GPU or a `.gpu` file in the root.
   Set it here and import afterwards rather than keeping a second copy of the
   list: the flags are fiddly enough that a divergent copy would eventually be
   measuring a different browser than the one that draws the captures.
   Dynamic import because a static one is hoisted above this assignment. */
if (!CPU) process.env.RENDER_GPU = '1';
const { serve, LAUNCH_ARGS } = await import('./harness.mjs');
/* tame.mjs comes in through harness and pins node and every
   chrome-headless-shell child to four of twelve logical cores at Idle priority.
   Same budget as every other tool here, and generous for this one: the GPU path
   leaves the CPU mostly waiting where a SwiftShader capture takes every thread
   it can reach. */

/* No render lock. A GPU bench and a SwiftShader capture are not competing for
   the same device, and making a one-command benchmark queue behind a
   twenty-minute capture would mean nobody ever runs it. Say so if one is live,
   because the shared core budget will still show up in the numbers. */
try {
  const lock = new URL('../.renderlock', import.meta.url);
  if (fs.existsSync(lock)) {
    console.log(`\n  ⚠ a capture is running (pid ${fs.readFileSync(lock, 'utf8').trim()}).`);
    console.log('    Both are pinned to the same four cores, so these figures will be');
    console.log('    pessimistic. Worth re-running once it is done.');
  }
} catch (_) {}

const srv = serve();
await new Promise(r => srv.listen(0, r));
/* #noadapt, not a pinned tier: the ladder has to be walked explicitly below, and
   a governor quietly adapting downward during the four-second settle would make
   every figure a measurement of a different setting. */
const url = `http://localhost:${srv.address().port}/#noadapt`;

const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
const out = { w: W, h: H, backend: CPU ? 'swiftshader' : 'gpu', views: {} };

try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 180_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);          // procedural textures, deferred geometry, shader compile

  const adapter = await page.evaluate(() => {
    const gl = window.__game.renderer.getContext();
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      name: String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    };
  });
  out.adapter = adapter.name;
  out.gpuTimer = adapter.timer;
  out.software = /swiftshader|llvmpipe|software|basic render/i.test(adapter.name);

  if (!JSON_OUT) {
    console.log(`\n  ${W}x${H}   backend=${out.backend}`);
    console.log(`  ${adapter.name}`);
    console.log(`  gpu timer query: ${adapter.timer ? 'available' : 'NOT available'}`);
    if (out.software && !CPU) {
      console.log('\n  ⚠ this is a software rasteriser. The GPU flags did not take and');
      console.log('    these numbers mean nothing. Send the adapter line above anyway.');
    }
  }

  /* Everything below runs in the page in one evaluate per view, because the
     measurement has to be uninterrupted by anything crossing the CDP boundary. */
  const measure = (view) => page.evaluate(async ([v, reps, blocks]) => {
    const g = window.__game;
    const r = g.renderer;
    const gl = r.getContext();
    const atmo = g._atmo;
    const scene = g._scene;

    g.setPaused(true);
    g.walkTo(v.d);
    g.lookAt(v.yaw, v.pitch);

    const px = new Uint8Array(4);
    /* The fence. See the header: readPixels cannot return before the frame it
       is reading exists, which finish() can and does. */
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const time = (fn, n) => {
      for (let i = 0; i < 6; i++) fn();
      sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) fn();
      sync();
      return (performance.now() - t0) / n;
    };
    const med = (a) => +a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(3);

    const frame = () => g.renderOnce();

    /* ---- ablations ----
       Each turns exactly one thing off and re-renders, so the difference is
       that thing's cost at this viewpoint. Restored immediately afterwards. */
    const veg = [];
    scene.traverse((o) => {
      const n = o.name || '';
      if (/^(veg-|juniper-)/.test(n) && o.visible) veg.push(o);
    });
    const shimmerOn = () => { atmo.setShimmer(true); };

    const variants = {
      full: { run: frame, on: () => {}, off: () => {} },
      noShimmer: {
        on: () => atmo.setShimmer(false),
        off: shimmerOn,
        run: frame,
      },
      noParticles: {
        on: () => atmo.setHidden(true),
        off: () => atmo.setHidden(false),
        run: frame,
      },
      noShadow: {
        on: () => { r.shadowMap.enabled = false; },
        off: () => { r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true; },
        run: frame,
      },
      noVeg: {
        on: () => { for (const o of veg) o.visible = false; },
        off: () => { for (const o of veg) o.visible = true; },
        run: frame,
      },
      halfRes: {
        on: () => { if (g.perf) g.perf.setScale(0.7); },
        off: () => { if (g.perf) g.perf.setScale(0); },
        run: frame,
      },
    };

    const names = Object.keys(variants);
    const acc = {}; for (const n of names) acc[n] = [];

    /* Interleaved: one block of every variant, then the next block, so the
       driver's clock ramp is spread evenly over all of them instead of being
       charged entirely to whichever ran first. */
    time(frame, 12);                                  // warm
    for (let b = 0; b < blocks; b++) {
      for (const n of names) {
        const V = variants[n];
        V.on();
        acc[n].push(time(V.run, reps));
        V.off();
      }
    }

    frame();
    const info = g.info();
    const stats = g.perf ? g.perf.stats() : null;
    g.setPaused(false);

    const res = { view: v.name, info, stats, vegMeshes: veg.length };
    for (const n of names) res[n] = med(acc[n]);
    return res;
  }, [view, reps, blocks]);

  const tiers = await page.evaluate(() =>
    (window.__game.perf ? window.__game.perf.QTIERS.map(q => q.name) : ['(none)']));
  out.tiers = tiers;

  /* ---- per-view ablation at the top tier ---- */
  if (!JSON_OUT) {
    console.log('\n  ── where the frame goes, at the top tier ──');
    console.log('  all figures are milliseconds per frame, median of ' + BLOCKS + ' blocks of ' + REPS);
    console.log('\n  view        full   -shimmer  -particles  -shadow    -veg   @0.7res    calls     tris');
  }
  for (const v of VIEWS) {
    const r = await measure(v);
    out.views[v.name] = r;
    if (!JSON_OUT) {
      const f = (x) => String(x.toFixed(2)).padStart(7);
      console.log(`  ${v.name.padEnd(10)}${f(r.full)}${f(r.noShimmer)}${f(r.noParticles)}` +
                  `${f(r.noShadow)}${f(r.noVeg)}${f(r.halfRes)}   ` +
                  `${String(r.info.calls).padStart(6)}  ${(r.info.triangles / 1e6).toFixed(2)}M`);
    }
  }

  /* ---- the tier ladder, at the worst viewpoint ---- */
  if (tiers[0] !== '(none)') {
    const worst = VIEWS.reduce((a, b) =>
      out.views[a.name].full > out.views[b.name].full ? a : b);
    if (!JSON_OUT) {
      console.log(`\n  ── the quality ladder, at ${worst.name} ──`);
      console.log('  tier      frame ms    gpu ms   scale     buffer      fps@this cost');
    }
    out.ladder = [];
    for (const t of tiers) {
      const row = await page.evaluate(async ([t, v, reps, blocks]) => {
        const g = window.__game, gl = g.renderer.getContext();
        g.setPaused(true);
        g.perf.setTier(t);
        g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);
        const px = new Uint8Array(4);
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const time = (n) => {
          for (let i = 0; i < 6; i++) g.renderOnce();
          sync();
          const t0 = performance.now();
          for (let i = 0; i < n; i++) g.renderOnce();
          sync();
          return (performance.now() - t0) / n;
        };
        time(10);
        const a = []; for (let b = 0; b < blocks; b++) a.push(time(reps));
        const s = g.perf.stats();
        g.setPaused(false);
        return { tier: t, ms: +a.sort((x, y) => x - y)[a.length >> 1].toFixed(3), stats: s };
      }, [t, worst, REPS, BLOCKS]);
      out.ladder.push(row);
      if (!JSON_OUT) {
        console.log(`  ${row.tier.padEnd(9)} ${String(row.ms.toFixed(2)).padStart(8)}  ` +
                    `${String(row.stats.gpuMs == null ? 'n/a' : row.stats.gpuMs.toFixed(2)).padStart(8)}  ` +
                    `${String(row.stats.scale.toFixed(2)).padStart(6)}  ` +
                    `${(row.stats.buffer[0] + 'x' + row.stats.buffer[1]).padStart(11)}  ` +
                    `${String(Math.round(1000 / row.ms)).padStart(11)}`);
      }
    }
    await page.evaluate(() => window.__game.perf.setTier('high'));
  }

  out.errors = [...new Set(errs)].slice(0, 8);
  if (!JSON_OUT) {
    if (out.errors.length) { console.log('\n  ── page errors ──'); out.errors.forEach(e => console.log('   ', e)); }
    console.log('\n  Note: the fps column is 1000/frame ms with the loop paused — it is');
    console.log('  headroom, not observed framerate. A 200 Hz panel needs 5.00 ms.\n');
  } else {
    console.log(JSON.stringify(out, null, 2));
  }
} catch (e) {
  console.error('\n✗ bench failed:', e && e.message || e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  srv.close();
}

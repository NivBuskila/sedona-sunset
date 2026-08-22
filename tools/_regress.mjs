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
      ['--query-gpu=utilization.gpu,clocks.sm,utilization.memory', '--format=csv,noheader,nounits'],
      (e, so) => {
        if (!e && so) {
          const [u, c, m] = so.trim().split('\n')[0].split(',').map(s => +s);
          if (Number.isFinite(u)) out.push([u, c, m]);
        }
        if (!stop) setTimeout(tick, ms);
      });
  };
  tick();
  return () => {
    stop = true;
    if (!out.length) return null;
    const u = out.map(a => a[0]), m = out.map(a => a[2]).filter(Number.isFinite);
    return {
      n: u.length,
      mean: Math.round(u.reduce((a, b) => a + b, 0) / u.length),
      min: Math.min(...u), max: Math.max(...u),
      clock: Math.round(out.reduce((a, b) => a + b[1], 0) / out.length),
      /* The clock is bimodal — ~300 idle, ~2800 boosted — so its *mean* is really a
         duty cycle wearing a megahertz costume, and a mean of 970 is not "slightly
         busy", it is a quarter of the samples at full boost. Report the fraction
         directly; it is what the gate should be read against. Learned by shipping a
         mean-only threshold and watching it admit exactly that. */
      boosted: Math.round(100 * out.filter(a => a[1] >= 1500).length / out.length),
      /* Memory-controller utilisation. **This field is not a contention signal and
         was believed to be one for most of a day — see the correction below.** It
         is kept because it is diagnostic once you know which way round it runs, and
         removing it would erase the evidence. */
      mem: m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : null,
      memMax: m.length ? Math.max(...m) : null,
    };
  };
}

const args = process.argv.slice(2);
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes('--' + k);

let out_idleQuiet = false;
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

/* Foreign GPU load, sampled *before* anything of ours launches.
 *
 * This is the column that proves the machine was quiet, and it has to be taken
 * before the browser exists: once the scene is rendering, utilisation is 100% by
 * design and says nothing about who else is on the card. The number that matters
 * is what the GPU was doing while nobody was asking it to do anything. Tonight
 * that floor was 65-75%, spiking to 100%, from an animated desktop wallpaper, the
 * vendor overlay, the editor and fourteen agent browsers — which is the whole of
 * the 39% "regression" that cost this project three hours. A run that does not
 * report this figure cannot be compared with a run taken at another time. */
const IDLE_SECS = Number(getf('idlesecs', 10));
/* ── the gate, corrected, and the correction is the point ───────────────────────
 *
 * **The first version of this gate declared a badly contended machine quiet, and
 * that single mistake is the whole of the "unexplained six milliseconds" that sat
 * in PERF.md and CONTRACT.md as the project's last open number.** It thresholded
 * the memory controller at <= 13% and utilization.gpu at <= 78%, on the reasoning
 * that this box "rests at gpu 63-66% / mem 12%". That sentence was written from
 * samples taken while fourteen agent browsers and an animated wallpaper were on
 * the card. It codified a contended state as the definition of rest — and worse,
 * because the memory criterion runs the *opposite* way to load here, the gate was
 * actively selecting for contention. It passed at 63% and again at 34%.
 *
 * Measured, same tree, same station, same method, one afternoon:
 *
 *   foreign load at boot            wash_mid rung 0, held
 *   gpu 18%  mem 31%  clock 285-405   17.15 ms      <- actually idle
 *   gpu 34%  mem 10%  clock 2835      22.05 ms
 *   gpu 56%  mem 10%  clock 2835      22.22 ms
 *   gpu 63%  mem 12%  (this morning)  23.06 ms      <- gate said QUIET
 *
 * So the discriminator is the **SM clock**, and it is unambiguous where both
 * utilisation figures are not. At rest this card sits at 285-405 MHz; with any
 * real render work on it, foreign or not, it boosts to 2820-2840 and stays there.
 * utilization.gpu is hopeless on its own — it swung 2-77% within twelve seconds in
 * one unchanging state — and the memory controller reads *high* (30-38%) at true
 * idle and *low* (2-14%) under a shader load, because an idle desktop's traffic is
 * display scanout while a busy one's is arithmetic. Both of the fields I trusted
 * are inverted or noise; the clock is neither.
 *
 * The general lesson, which is the reusable part: **a threshold calibrated against
 * an unverified "normal" inherits whatever was wrong with that normal, and then
 * launders it into every measurement it gates.** The gate was not too loose by
 * accident, it was loose *because* it had been fitted to the thing it was meant to
 * exclude. Nothing downstream can detect that, which is why it survived a bisect,
 * a quiet/contended A/B, and two written corrections.
 */
/* 600 rather than the 1200 this shipped with for one run. 1200 admitted a card whose
   mean clock was 970 — a quarter of the sampling window at full boost — and that run
   read 0.7-1.2 ms high at every rung against one taken at a mean of ~350, with the
   per-rung spread jumping from 0.2-0.9 to 3.9-5.9 as the load came and went underneath
   it. Same mistake as the first gate, one order of magnitude smaller: a threshold set
   by eye against a state nobody had characterised. 600 is ~12% duty cycle. */
const QUIET_CLOCK = Number(getf('quietclock', 600));
const QUIET_GPU = Number(getf('quietgpu', 45));
/* Retained so a run can still be forced through, and so the old behaviour is
   reproducible, but no longer part of the default decision. */
const QUIET_MEM = Number(getf('quietmem', 0));
const WAIT_MIN = Number(getf('waitquiet', 0));
const isQuiet = (s) => {
  if (!s) return false;
  if (QUIET_MEM && !(s.memMax <= QUIET_MEM + 1)) return false;
  /* No clock reading (older driver, or nvidia-smi absent) falls back to the old
     utilisation test, flagged as weaker by the caller rather than silently. */
  if (!Number.isFinite(s.clock) || s.clock <= 0) return s.mean <= QUIET_GPU;
  return s.clock <= QUIET_CLOCK && s.mean <= QUIET_GPU;
};

/* `--waitquiet N` refuses to boot until the card is actually free, re-checking
   for up to N minutes. The gate has to sit here, immediately before the launch,
   rather than in a shell wrapper around the whole command: the boot is forty
   seconds and a capture starting inside it would be measured by a run that had
   already printed QUIET. Sampling and launching back to back is the tightest the
   race gets from outside the driver. */
const sampleIdle = async () => {
  const stop = sampleGpu(500);
  await new Promise(r => setTimeout(r, IDLE_SECS * 1000));
  return stop();
};
let idle = null;
const deadline = Date.now() + WAIT_MIN * 60_000;
for (;;) {
  process.stderr.write(`  [${TAG}] sampling foreign GPU load for ${IDLE_SECS}s before boot\n`);
  idle = await sampleIdle();
  if (!idle) break;                      /* no nvidia-smi: nothing to gate on */
  const quiet = isQuiet(idle);
  process.stderr.write(`  [${TAG}] foreign load: sm clock ${idle.clock} MHz (boosted ${idle.boosted}% of samples), ` +
    `gpu ${idle.mean}% (${idle.min}-${idle.max}), ` +
    `mem ${idle.mem}% (max ${idle.memMax}) over ${idle.n} samples — ` +
    `${quiet ? 'MACHINE IS QUIET' : 'NOT QUIET, this run would be contended'}\n`);
  if (quiet || Date.now() >= deadline) break;
  process.stderr.write(`  [${TAG}] waiting, ` +
    `${Math.round((deadline - Date.now()) / 60000)} min left before giving up\n`);
  await new Promise(r => setTimeout(r, 20_000));
}
out_idleQuiet = isQuiet(idle);

const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
const out = { tag: TAG, root: ROOT, w: W, h: H, rows: [], idle, quiet: out_idleQuiet };
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

  const measure = async (label, moving = has('moving'), rung = -1) => {
    const r = await page.evaluate(async ([blocks, per, moving, rung]) => {
      const g = window.__game, gl = g.renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      g.setPaused(true);
      if (rung < 0) { g.perf.setTier('high'); g.perf.setScale(1); }
      else g.perf.setRung(rung);
      g.walkTo(46); g.lookAt(0, 0);
      for (let i = 0; i < 30; i++) g.renderOnce();
      sync();
      /* Warm until the frame time stops falling, not for a fixed count.
       *
       * A fixed sixty was not enough and produced a table with rung 1 slower
       * than rung 0 and rung 4 faster moving than held. A rung change reallocates
       * the draw buffer and both shadow maps, and a *tier* change alters the
       * atmosphere's sample counts, which is a new shader variant and an ANGLE
       * HLSL compile — and that compile was landing inside the timed blocks. So
       * warm until two consecutive short blocks agree within 4%, then stop, with
       * a cap so a genuinely unstable machine cannot spin here forever. */
      const settle = (draw) => {
        let prev = Infinity;
        for (let g2 = 0; g2 < 12; g2++) {
          const t = performance.now();
          for (let i = 0; i < 15; i++) draw();
          sync();
          const ms = (performance.now() - t) / 15;
          if (ms >= prev * 0.96) return g2;
          prev = ms;
        }
        return 12;
      };
      const run = (draw) => {
        settle(draw);
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
    }, [BLOCKS, PER, moving, rung]);
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

  if (has('ladder')) {
    /* The whole ladder in one page load, held and moving at each rung.
     *
     * One load rather than one per rung because the boot is forty seconds and
     * nine of those is most of the window a frozen tree gives you. The rung
     * changes reallocate the draw buffer and both shadow maps, which is exactly
     * what the sixty warm-up frames inside measure() are for — an earlier
     * version warmed six and reported 42 ms against a true 20. */
    const n = await page.evaluate(() => window.__game.perf.rungs.length);
    /* Visit every rung once before timing any of them, so that every tier's
       shader variant is already compiled when the timed sweep starts. Without
       this the first rung to reach each tier pays that tier's compile and reads
       slower than the rung above it — which is exactly the table the first
       version of this sweep produced. */
    process.stderr.write(`  [${TAG}] pre-compiling ${n} rungs\n`);
    await page.evaluate(async (n) => {
      const g = window.__game;
      g.setPaused(true);
      for (let i = 0; i < n; i++) {
        g.perf.setRung(i);
        for (let f = 0; f < 12; f++) g.renderOnce();
      }
    }, n);
    /* Two passes over the ladder, keeping the lower of the two readings per rung.
     *
     * Not cherry-picking: contention is strictly additive. Another process on the
     * card can only ever make a frame take longer, never shorter, so of two
     * measurements of the same rung the smaller is the better estimate of what
     * the scene costs and the larger contains something that is not the scene.
     * The first clean sweep of this ladder had rungs 6 and 7 land 10 ms and 4 ms
     * above their neighbours, out of order with rungs on either side, because a
     * capture started somewhere else on the machine while they were being timed.
     * The spread between passes is reported so a reader can see how much of that
     * was happening. */
    const PASSES = Number(getf('passes', 2));
    const best = new Array(n).fill(null);
    for (let p = 0; p < PASSES; p++) {
      for (let i = 0; i < n; i++) {
        const row = await measure('rung ' + i, true, i);
        const b = best[i];
        if (!b) best[i] = { ...row, heldHi: row.ms, movingHi: row.moving };
        else {
          b.heldHi = Math.max(b.heldHi, row.ms);
          b.movingHi = Math.max(b.movingHi, row.moving);
          if (row.ms < b.ms) b.ms = row.ms;
          if (row.moving < b.moving) b.moving = row.moving;
        }
        process.stderr.write(`  [${TAG}] pass ${p} rung ${i} ${String(row.buffer).padEnd(9)} ` +
          `held ${row.ms.toFixed(2)}  moving ${row.moving == null ? '?' : row.moving.toFixed(2)}\n`);
      }
    }
    out.passes = PASSES;
    for (const r of best) out.rows.push(r);
  } else {
    out.rows.push(await measure('full'));
  }

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
  if (out.idle) console.log(`  foreign load before boot: sm clock ${out.idle.clock} MHz ` +
    `(boosted ${out.idle.boosted}% of samples; idle is ~300, boosted ~2800 — this is the field that decides), ` +
    `gpu ${out.idle.mean}% (${out.idle.min}-${out.idle.max}), ` +
    `mem ${out.idle.mem}% (max ${out.idle.memMax}) over ${out.idle.n} samples — ` +
    `${out.quiet ? 'MACHINE WAS QUIET, these numbers are the honest ones'
      : 'NOT QUIET — every figure below is a floor, not an estimate'}`);
  if (has('ladder')) {
    console.log(`  best of ${out.passes} passes per rung; the spread is how much the machine moved under it`);
    console.log('  rung  buffer       held ms  held fps   moving ms  moving fps   spread');
    for (const r of out.rows) {
      const sp = Math.max(r.heldHi - r.ms, (r.movingHi || 0) - (r.moving || 0));
      console.log(`  ${r.label.replace('rung ', '').padEnd(5)} ${String(r.buffer).padEnd(11)} ` +
        `${r.ms.toFixed(2).padStart(8)} ${(1000 / r.ms).toFixed(0).padStart(9)}  ` +
        `${(r.moving == null ? '' : r.moving.toFixed(2)).padStart(10)} ` +
        `${(r.moving == null ? '' : (1000 / r.moving).toFixed(0)).padStart(11)} ` +
        `${(Number.isFinite(sp) ? sp.toFixed(2) : '').padStart(8)}`);
    }
  } else {
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
  }
  if (out.gpuLoad) console.log(`  GPU during the run: mean ${out.gpuLoad.mean}% util, ` +
    `${out.gpuLoad.min}-${out.gpuLoad.max}%, sm clock ${out.gpuLoad.clock} MHz — ` +
    'a millisecond without this beside it cannot be compared with one taken an hour later');
  if (out.errors && out.errors.length) { console.log('  page errors:'); out.errors.forEach(e => console.log('    ' + e)); }
  console.log('');
}
fs.writeFileSync(path.join(MAIN, 'tmp', `reg_${TAG}.json`), JSON.stringify(out, null, 2));

/* Which rung does the governor actually choose, how long does it take, and can
 * it get back up?
 *
 *   node tools/govern.mjs --w 2560 --h 1440            the default 150 s walk
 *   node tools/govern.mjs --secs 90                    shorter
 *   node tools/govern.mjs --stall 60                   inject a load spike at 60 s
 *   node tools/govern.mjs --json
 *
 * ── why this is not tools/bench.mjs ────────────────────────────────────────
 *
 * bench.mjs pauses the loop, holds the camera still, and drives renderOnce by
 * hand through each rung. That is the right instrument for *pricing* a rung and
 * it is what the ladder was tuned against. It cannot answer three questions
 * that turn out to matter more to a player than the price of any rung:
 *
 *   1. which rung does the governor settle on, given a live loop and a moving
 *      camera — the shadow cascades redraw when the rig moves, and a walk
 *      passes through framings the bench never stands in;
 *   2. how long does it take to get there from a cold load;
 *   3. once it has gone down, can it come back up.
 *
 * The first real-browser playthrough answered all three unfavourably and none
 * of it was visible here, for a structural reason: every probe in tools/ sets
 * `navigator.webdriver`, and src/perf.js pins the top tier and disables
 * adaptation whenever that is true. So the governor was the one system in the
 * project that no instrument could see. `#adapt` opts back in, and this is the
 * only tool that sets it.
 *
 * ── how it walks ───────────────────────────────────────────────────────────
 *
 * With a real held key, not with walkTo. walkTo teleports and zeroes the bob,
 * which is what a capture wants and is not what the governor sees: a walk moves
 * the shadow rig continuously, keeps `moving` true so the atmosphere and the
 * grain phase advance, and spends most of its time in framings that are not any
 * of the nine canonical ones. Shift is held as well, so a 332 m wash takes
 * about eighty seconds instead of three and a half minutes.
 *
 * ── and it checks that the frame is real ───────────────────────────────────
 *
 * Twice in one night this tree rendered a blinding white desert, once from a
 * shader that failed to link and once from a debug line, and the second had no
 * console error at all. A governor trace is exactly the kind of measurement
 * that would sail straight through it — a blown-out frame is *cheap*, so the
 * ladder would climb, settle high, and the run would look like good news. So
 * frames are sampled and reported: mean luminance, the fraction of pixels at or
 * near the encoder ceiling, and the fraction that are pure black. A white
 * desert reads 240+ with half the frame clipped, and a black one reads 0.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { decode } from './png.mjs';

const args = process.argv.slice(2);
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes('--' + k);

const W = Number(getf('w', 2560)), H = Number(getf('h', 1440));
const SECS = Number(getf('secs', 150));
const STALL = Number(getf('stall', 0));
const JSON_OUT = has('json');
const TAG = getf('tag', 'gov');

process.env.RENDER_GPU = '1';
const { serve, LAUNCH_ARGS } = await import('./harness.mjs');

try {
  const lock = new URL('../.renderlock', import.meta.url);
  if (fs.existsSync(lock)) {
    console.log(`\n  ⚠ a capture is running (pid ${fs.readFileSync(lock, 'utf8').trim()}).`);
    console.log('    This measures the governor, whose whole job is to react to');
    console.log('    contention, so a trace taken now is a trace of the contention.');
    console.log('    Re-run it on an idle machine before quoting a settled rung.');
  }
} catch (_) {}

/* `--root` serves a detached worktree instead of the shared tree, so a commit can
   be held still while it is measured. Four captures died tonight on `Invalid or
   unexpected token` from a file that was mid-edit, and src/terrain.js and
   src/vegetation.js are both dirty as this runs; a committed checkout cannot be
   half-written. Defaults to the shared tree, which is what every existing caller
   wants. */
const rootArg = process.argv.indexOf('--root');
const srv = serve(rootArg < 0 ? undefined : path.resolve(process.argv[rootArg + 1]));
await new Promise(r => srv.listen(0, r));
/* #adapt and nothing else. No pinned tier, no #noadapt, no #perf — the overlay
   is a DOM write per frame and this is the one measurement where that would be
   charged to the thing being measured. */
const TARGET = getf('target', '');
/* --target exists so the ratchet can be *demonstrated* on a tree where the
   ladder is over budget at every rung. With nothing reaching 8.33 ms the
   governor correctly pins at the floor and there is no climb to observe, which
   makes a fixed ratchet indistinguishable from a broken one. At 60 the ladder
   has rungs on both sides of the target, so a stall can push it down and the
   recovery is a thing that either happens or does not. */
const EXTRA = getf('hash', '');
const url = `http://localhost:${srv.address().port}/#adapt` +
  (TARGET ? `&target=${TARGET}` : '') + (EXTRA ? '&' + EXTRA : '');

/* `--uncapped` removes the compositor's frame-rate limit, which is the only way to
   read a real *loop* frame rate rather than the vsync period. Without it the `fps`
   column of this trace is pinned to exactly 60 on every rung — true, and useless,
   because it is a property of the display and not of the scene. It is off by default
   because the governor's subject is frame *cost*, and a capped loop measures that
   perfectly well while being kinder to a shared machine. */
const UNCAPPED = has('uncapped');
const browser = await chromium.launch({
  headless: true,
  args: UNCAPPED
    ? [...LAUNCH_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit']
    : LAUNCH_ARGS,
});
const out = { w: W, h: H, secs: SECS, samples: [] };

try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  const warns = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + (e.stack || e.message || e)));
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') errs.push('[console] ' + m.text());
    else if (t === 'warning') warns.push(m.text());
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 300_000 });
  out.bootMs = Date.now() - t0;

  /* The clock starts at begin(), not at goto: `clock` inside the governor is
     accumulated dt, so t=0 for the ladder is the first frame of the loop and
     not the first byte of the page. Boot is reported separately because it is
     somebody else's problem and averaging the two hides both. */
  await page.evaluate(() => window.__game.begin());
  const tLoop = Date.now();

  const ready = await page.evaluate(() => ({
    adapting: window.__game.perf.adapting,
    harness: window.__game.perf.harness,
    gpu: window.__game.perf.gpu,
    rungs: window.__game.perf.rungs,
  }));
  out.adapting = ready.adapting;
  out.gpu = ready.gpu;
  out.rungs = ready.rungs;

  if (!JSON_OUT) {
    console.log(`\n  ${W}x${H}\n  ${ready.gpu}`);
    console.log(`  boot to __game: ${(out.bootMs / 1000).toFixed(1)} s`);
    console.log(`  adapting: ${ready.adapting}   (harness clause ${ready.harness ? 'fired' : 'clear'})`);
  }
  if (!ready.adapting) {
    console.log('\n  ✗ adaptation is off, so this trace would be a trace of nothing.');
    console.log('    #adapt did not take — check the flag test in src/perf.js.');
    throw new Error('governor not adapting');
  }

  /* Twice in one night this tree rendered a blinding white desert, once with no
     console error at all, and a blown-out frame is *cheap* — so a governor trace
     taken on one would read as good news. Every mode here samples the frame. */
  /* Non-fatal. A 3.7 Mpx PNG encode competes with the frame being measured and
     occasionally overruns, and losing the frame check is a reason to say the
     frame was not checked — not a reason to throw away a two-minute trace. */
  const shot = async (label) => {
    let b;
    try { b = await page.screenshot({ type: 'png', timeout: 120_000 }); }
    catch (e) { return { label, L: null, hot: null, black: null, err: String(e.message || e).slice(0, 80) }; }
    const img = decode(b);
    let sum = 0, hot = 0, black = 0;
    const n = img.w * img.h;
    for (let i = 0; i < n; i++) {
      const k = i * img.ch;
      const L = img.px[k] * 0.2126 + img.px[k + 1] * 0.7152 + img.px[k + 2] * 0.0722;
      sum += L;
      if (L >= 250) hot++;
      if (L <= 1) black++;
    }
    return { label, L: +(sum / n).toFixed(2), hot: +(100 * hot / n).toFixed(2), black: +(100 * black / n).toFixed(2) };
  };

  /* ---- --probe: the rung table, measured where a walk actually goes ----
   *
   * bench.mjs walks the ladder at wash_mid, wall_lit and sun_gap. All three are
   * at 46 m or beyond and none of them is the framing a player boots into, looks
   * down at, or spends the first minute of the walk in. That turns out to matter
   * more than any tier: the same rung costs 5.4 ms at sun_gap and 10 ms at the
   * mouth of the wash, so a ladder tuned on the first number lands two rungs
   * short in the second.
   *
   * Both columns are the bench's own method — paused loop, readPixels fence,
   * median of blocks — so they are directly comparable with the published table.
   * The difference between them is the shadow cascade redraw, which is free with
   * the camera held and is not free for anyone walking.
   */
  /* --warnonly: boot, take the compile log, leave. Used to attribute the X3595
     gradient-in-a-varying-loop warnings by ablation — the same boot with
     --hash hardshadow compiles the shadow path without System 4's variable-width
     spiral, so whichever warnings disappear were that loop's. Cheaper and more
     honest than matching GLSL line numbers against an HLSL compiler's, which is
     what the numbers in those messages actually refer to. */
  if (has('warnonly')) {
    await page.waitForTimeout(2500);
    const f = await shot('boot');
    const seen = [...new Set(warns)];
    const x3595 = seen.filter(w => /X3595/.test(w));
    console.log(`\n  url hash: ${url.split('/#')[1]}`);
    console.log(`  frame check: ${f.L == null ? 'not sampled' : `mean L ${f.L}, ${f.hot}% clipped`}`);
    console.log(`  distinct console warnings: ${seen.length}`);
    console.log(`  of which X3595 gradient-in-a-varying-loop: ${x3595.length}`);
    for (const w of x3595) {
      const m = w.match(/\((\d+),(\d+-\d+)\)/);
      console.log(`    line ${m ? m[1] : '?'}  cols ${m ? m[2] : '?'}`);
    }
    const other = seen.filter(w => !/X3595/.test(w));
    if (other.length) { console.log('  other warnings:'); other.forEach(w => console.log('    ' + w.replace(/\s+/g, ' ').slice(0, 160))); }
    console.log(errs.length ? `  ✗ ${errs.length} page errors` : '  no page errors.');
    console.log('');
    await browser.close().catch(() => {});
    srv.close();
    process.exit(0);
  }

  if (has('probe')) {
    const STATIONS = [
      { name: 'mouth', d: 2, yaw: 0, pitch: -2 },
      { name: 'wash_low', d: 8, yaw: 0, pitch: -4 },
      { name: 'ground', d: 30, yaw: 10, pitch: -38 },
      { name: 'wash_mid', d: 46, yaw: 0, pitch: 0 },
      { name: 'sun_gap', d: 120, yaw: 0, pitch: 6 },
      { name: 'shade_far', d: 160, yaw: -155, pitch: -4 },
    ];
    const table = await page.evaluate(async ([stations, nRungs]) => {
      const g = window.__game, gl = g.renderer.getContext();
      const px = new Uint8Array(4);
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
      g.setPaused(true);
      const rows = [];
      for (let r = 0; r < nRungs; r++) {
        g.perf.setRung(r);
        /* A rung change resizes the drawing buffer, which reallocates the
           shimmer target, the scene target, both bloom buffers and the depth
           attachment, and the first frames after that pay for all of it. Six
           warm-up frames inside `time` was not enough: the first two stations
           measured at rung 1 came out at 42 and 37 ms against rung 0's 25, which
           is not a rung being slower than the one above it — it is an allocator
           being timed. Sixty frames and a fence, once per rung. */
        for (let i = 0; i < 60; i++) g.renderOnce();
        sync();
        const s = g.perf.stats();
        const row = { rung: r, tier: s.tier, scale: s.scale, buf: s.buffer.join('x'), held: {}, moving: {} };
        for (const v of stations) {
          const held = [], moving = [];
          for (let b = 0; b < 3; b++) {
            g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);
            held.push(time(() => g.renderOnce(), 20));
            let d = v.d;
            moving.push(time(() => { g.walkTo(d += 0.05); g.lookAt(v.yaw, v.pitch); g.renderOnce(); }, 20));
          }
          row.held[v.name] = med(held);
          row.moving[v.name] = med(moving);
        }
        rows.push(row);
      }
      g.perf.setRung(0);
      g.setPaused(false);
      return rows;
    }, [STATIONS, out.rungs.length]);
    out.probe = table;
    out.frames = [await shot('probe')];
    out.errors = [...new Set(errs)].slice(0, 10);
    out.warnings = [...new Set(warns)];

    if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
    else {
      const f = out.frames[0];
      console.log(`\n  frame check: mean L ${f.L}, ${f.hot}% at the ceiling, ${f.black}% black — ` +
        (f.L > 200 || f.L < 4 ? '✗ NOT THE SCENE' : 'looks like the scene'));
      for (const mode of ['held', 'moving']) {
        console.log(`\n  ── ms per frame, camera ${mode === 'held' ? 'held (what bench.mjs measures)' : 'moving (what a walk pays)'} ──`);
        console.log('  rung  tier      scale        buffer  ' +
          STATIONS.map(s => s.name.padStart(10)).join(''));
        for (const r of table) {
          console.log(`  ${String(r.rung).padEnd(5)} ${r.tier.padEnd(9)} ${r.scale.toFixed(2).padStart(5)}  ` +
            `${r.buf.padStart(12)}  ` +
            STATIONS.map(s => r[mode][s.name].toFixed(2).padStart(10)).join(''));
        }
      }
      console.log('\n  ── the first rung inside 8.33 ms, per station ──');
      console.log('  station        held        moving');
      for (const s of STATIONS) {
        const h = table.find(r => r.held[s.name] <= 8.33);
        const m = table.find(r => r.moving[s.name] <= 8.33);
        console.log(`  ${s.name.padEnd(12)} ${(h ? 'rung ' + h.rung : 'never').padStart(9)} ` +
          `${(m ? 'rung ' + m.rung : 'NEVER').padStart(13)}`);
      }
      if (out.errors.length) { console.log('\n  ── page errors ──'); out.errors.forEach(e => console.log('   ', e.slice(0, 300))); }
      else console.log('\n  no page errors.');
      console.log('');
    }
    fs.writeFileSync(new URL(`../tmp/${TAG}.json`, import.meta.url), JSON.stringify(out, null, 2));
    await browser.close().catch(() => {});
    srv.close();
    process.exit(0);
  }

  /* Sampling from inside the page. A CDP round trip per sample would charge its
     own latency to the frame being measured, and at 8 ms a frame the round trip
     is most of one. */
  await page.evaluate(() => {
    window.__gov = [];
    window.__govT = performance.now();
    window.__govId = setInterval(() => {
      const s = window.__game.perf.stats();
      window.__gov.push({
        t: +((performance.now() - window.__govT) / 1000).toFixed(2),
        rung: s.rung, floor: s.floor, tier: s.tier, scale: s.scale,
        buf: s.buffer[0] + 'x' + s.buffer[1],
        gpu: s.gpuMs, cpu: s.cpuMs, fps: s.fps,
        shadow: s.shadow[0] + '/' + s.shadow[1],
        probing: s.probing, cool: s.coolNext,
      });
    }, 250);
  });

  /* A real walk: Shift-W held, so the rig moves continuously and the wash gets
     covered. Pointer lock is not available headless, so the yaw is left alone —
     the walk still passes through the whole corridor, which is what varies the
     frame cost.

     --still holds no key, which is the ablation that decomposes the gap between
     this tool's numbers and bench.mjs's. Standing is what bench.mjs measures;
     walking is what a player does. If the two differ, the ladder was tuned
     against the cheaper of the two. */
  if (!has('still')) {
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
  }

  out.frames = [];
  /* Early, so a white desert is caught before a hundred and fifty seconds are
     spent tracing a governor's reaction to one — but not at three seconds, which
     is where this used to be and where it produced a false alarm. The cold-start
     fix makes the ladder take three rung changes in the first 3.3 s, each of
     which resizes the drawing buffer and reallocates every render target, and a
     screenshot that lands inside one catches an unpainted canvas and reports the
     scene as 100% black. Eight seconds is after the ladder has settled and still
     long before anything has been concluded from the trace. */
  await page.waitForTimeout(8000);
  out.frames.push(await shot('t=8s'));

  /* ---- --push: the aftermath of a transient, without the transient ----
   *
   * The first version of this ground a second WebGL context to make the GPU
   * genuinely contended. It worked far too well: the queued draws took four
   * minutes to drain, the GPU timer went permanently disjoint, and the trace
   * measured the injection rather than the governor. Reported rather than
   * quietly replaced, because "the instrument was the loudest thing in the
   * room" is this project's most repeated failure and it is worth one more line.
   *
   * What is actually in question is not the stall — a stall makes the frame
   * expensive and the governor demonstrably descends. It is the *aftermath*:
   * once the ladder is at the bottom and the machine is quiet again, can it come
   * back? So put it at the bottom directly. That is the state a transient leaves
   * behind, reached without a transient to confound the reading, and it is a
   * strictly harder test than a real stall because there is no residual
   * slowness to excuse a failure to climb. */
  if (STALL > 0) {
    await page.waitForTimeout(Math.max(0, STALL * 1000 - 3000));
    out.pushAt = STALL;
    out.pushedTo = await page.evaluate(n => window.__game.perf.setRung(n), out.rungs.length - 1);
    out.stallReleasedAt = STALL;
  }

  const remain = SECS * 1000 - (Date.now() - tLoop);
  if (remain > 0) await page.waitForTimeout(remain);

  if (!has('still')) {
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
  }
  out.frames.push(await shot(`t=${SECS}s`));

  /* ---- where the live frame differs from a benched one, at one fixed rung ----
   * bench.mjs calls g.renderOnce() with the loop paused and the camera held. A
   * live frame is step() + atmo.update() + post.update() + renderOnce(), and the
   * governor's timer brackets all four — so if the two disagree, every rung in
   * the published table is the draw and not the frame. Measured here at the rung
   * the governor is sitting on, in the same page, seconds apart. */
  out.split = await page.evaluate(async () => {
    const g = window.__game, gl = g.renderer.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const time = (fn, n) => {
      for (let i = 0; i < 6; i++) fn();
      sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) fn();
      sync();
      return +((performance.now() - t0) / n).toFixed(3);
    };
    g.setPaused(true);
    const drawStill = time(() => g.renderOnce(), 40);
    /* Walking, by moving the player between draws rather than by holding a key:
       the loop is paused, so the only thing that changes is the shadow rig's
       position, which is what forces the cascades to redraw. */
    let d = 40;
    const drawWalk = time(() => { g.walkTo(d += 0.05); g.renderOnce(); }, 40);
    g.setPaused(false);
    return { drawStill, drawWalk, rung: g.perf.stats().rung };
  });

  const samples = await page.evaluate(() => { clearInterval(window.__govId); return window.__gov; });
  out.samples = samples;

  /* The other half of `#adapt`, tested rather than assumed. The flag exists so
     this tool can watch the governor; the thing that must remain true is that
     *not* passing it still pins a capture. A second page load with no flag at
     all, asserting the harness clause fires — because the failure mode is silent
     by construction, a rung change during a capture looking like a slightly soft
     build rather than like a bug. */
  const plain = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  try {
    await plain.goto(url.split('/#')[0] + '/', { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await plain.waitForFunction(() => !!window.__game, null, { timeout: 300_000 });
    out.capturePin = await plain.evaluate(() => ({
      adapting: window.__game.perf.adapting,
      harness: window.__game.perf.harness,
      tier: window.__game.perf.tier,
      scale: window.__game.perf.scale,
    }));
  } catch (e) { out.capturePin = { error: String(e.message || e).slice(0, 120) }; }
  await plain.close().catch(() => {});
  out.errors = [...new Set(errs)].slice(0, 10);
  out.warnings = [...new Set(warns)];

  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); }
  else {
    /* ---- the frame check first, because everything below is conditional on it ---- */
    console.log('\n  ── is the frame the real scene? ──');
    console.log('  when        mean L    px>=250    px<=1');
    for (const f of out.frames) {
      console.log(f.L == null
        ? `  ${f.label.padEnd(10)}   not sampled — ${f.err}`
        : `  ${f.label.padEnd(10)} ${f.L.toFixed(2).padStart(7)} ${(f.hot + '%').padStart(10)} ${(f.black + '%').padStart(8)}`);
    }
    const bad = out.frames.find(f => f.L != null && (f.L > 200 || f.L < 4));
    const ok = out.frames.filter(f => f.L != null).length;
    console.log(bad
      ? `  ✗ ${bad.label} does not look like the scene. Every number below is about that frame.`
      : ok ? `  looks like the scene in ${ok} of ${out.frames.length} samples.`
        : '  ⚠ no frame was sampled — nothing below is confirmed to be of the real scene.');

    /* ---- the trace, thinned, plus every rung change in full ---- */
    console.log('\n  ── the trace ──');
    console.log('   t/s  rung  tier    scale        buffer    gpu ms   fps   shadow');
    let last = null;
    for (const s of samples) {
      const changed = last === null || s.rung !== last.rung;
      if (!changed && s.t % 5 > 0.3) { last = s; continue; }
      console.log(`  ${String(s.t.toFixed(1)).padStart(5)} ${String(s.rung).padStart(5)}  ${s.tier.padEnd(7)} ` +
        `${s.scale.toFixed(2).padStart(5)}  ${s.buf.padStart(12)}  ` +
        `${String(s.gpu == null ? 'n/a' : s.gpu.toFixed(2)).padStart(8)} ${String(Math.round(s.fps)).padStart(5)}   ` +
        `${s.shadow}${changed && last !== null ? '   <- ' + (s.rung > last.rung ? 'down' : 'up') : ''}` +
        `${s.probing ? '  probing' : ''}${s.cool ? '  cool ' + (s.cool / 1000).toFixed(1) + 's' : ''}`);
      last = s;
    }

    /* ---- the three numbers the playthrough asked about ---- */
    const settleAt = (() => {
      for (let i = 0; i < samples.length; i++) {
        const r = samples[i].rung;
        let held = true;
        for (let j = i; j < samples.length && samples[j].t - samples[i].t < 20; j++) {
          if (samples[j].rung !== r) { held = false; break; }
        }
        if (held) return samples[i];
      }
      return samples[samples.length - 1];
    })();
    const hist = {};
    for (const s of samples) hist[s.rung] = (hist[s.rung] || 0) + 1;
    const worst = samples.reduce((a, b) => (b.rung > a.rung ? b : a), samples[0]);
    const finals = samples.slice(-8);

    console.log('\n  ── what a player gets ──');
    console.log(`  first rung held 20 s:   rung ${settleAt.rung} — ${settleAt.tier} / ${settleAt.scale.toFixed(2)} — at t=${settleAt.t.toFixed(1)}s`);
    console.log(`  lowest rung reached:    rung ${worst.rung} at t=${worst.t.toFixed(1)}s`);
    console.log(`  rung at the end:        rung ${finals[finals.length - 1].rung} — ${finals[finals.length - 1].tier} / ${finals[finals.length - 1].scale.toFixed(2)}`);
    console.log('  time at each rung:      ' +
      Object.keys(hist).sort((a, b) => a - b)
        .map(k => `${k}: ${(hist[k] * 0.25).toFixed(1)}s`).join('   '));
    if (out.pushAt) {
      const before = samples.filter(s => s.t < out.pushAt - 2);
      const settledBefore = before.length ? before[before.length - 1].rung : null;
      const after = samples.filter(s => s.t > out.pushAt + 1);
      const rec = after.length ? Math.min(...after.map(s => s.rung)) : null;
      const back = after.find(s => s.rung === settledBefore);
      console.log(`  pushed to the floor at ${out.pushAt}s, from rung ${settledBefore}`);
      console.log(`  best rung climbed back to: ${rec == null ? 'n/a' : 'rung ' + rec}` +
        (back ? `, reaching rung ${settledBefore} again after ${(back.t - out.pushAt).toFixed(1)}s`
          : ' — DID NOT return to where it was'));
    }

    if (out.capturePin) {
      const c = out.capturePin;
      console.log('\n  ── and a capture, with no flag at all ──');
      console.log(c.error ? `  ✗ could not check: ${c.error}`
        : `  harness clause ${c.harness ? 'fired' : 'DID NOT FIRE'}, adapting ${c.adapting}, ` +
          `pinned to ${c.tier} at scale ${c.scale.toFixed(2)}` +
          (c.harness && !c.adapting && c.tier === 'high' && c.scale === 1 ? '  — captures unaffected' : '  ✗ CHECK'));
    }

    if (out.split) {
      const live = samples.slice(-12).filter(s => s.gpu != null).map(s => s.gpu).sort((a, b) => a - b);
      const med = live.length ? live[live.length >> 1] : null;
      console.log('\n  ── the live frame against the benched one, same rung, same page ──');
      console.log(`  rung ${out.split.rung}`);
      console.log(`  renderOnce, camera held  ${out.split.drawStill.toFixed(2)} ms   <- what bench.mjs measures`);
      console.log(`  renderOnce, rig moving   ${out.split.drawWalk.toFixed(2)} ms   <- plus the cascade redraw`);
      console.log(`  the governor's own gpu   ${med == null ? 'n/a' : med.toFixed(2) + ' ms'}   <- plus step/atmo/post update`);
    }

    if (out.warnings.length) {
      console.log(`\n  ── ${out.warnings.length} distinct console warnings ──`);
      out.warnings.slice(0, 20).forEach(w => console.log('   ', w.replace(/\s+/g, ' ').slice(0, 220)));
    }
    if (out.errors.length) { console.log('\n  ── page errors ──'); out.errors.forEach(e => console.log('   ', e.slice(0, 300))); }
    else console.log('\n  no page errors.');
    console.log('');
  }
  fs.writeFileSync(new URL(`../tmp/${TAG}.json`, import.meta.url), JSON.stringify(out, null, 2));
} catch (e) {
  console.error('\n✗ govern failed:', e && e.message || e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  srv.close();
}

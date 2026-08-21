/* _a5hand.mjs — the depth handover: did it happen, does it come back, what did
 * it buy?
 *
 *   node tools/_a5hand.mjs            1920x1080, real adapter
 *   node tools/_a5hand.mjs --cpu      SwiftShader, contract checks only
 *
 * ── what this is for ──────────────────────────────────────────────────────
 *
 * System 5 used to draw the scene into its own full-frame RGBA16F target at four
 * samples so its shimmer could displace the result. The shimmer is off by user
 * instruction, and the target survived only because the marched in-scatter that
 * makes the light shafts needs a depth texture and that is where depth lived.
 * System 7's sceneRT now carries a depth texture of its own, so the target is
 * gone: the scene lands there, and the march reads their depth through
 * renderShafts().
 *
 * None of that is visible in a frame. A regression would show up as bandwidth
 * and nothing else, or — worse — as the shafts or the antialiasing quietly
 * vanishing while every colour metric on the project still passed. That is not
 * hypothetical: the first version of the handover latched ownership on the first
 * renderShafts call and never released it, so switching the post chain off at
 * runtime left nobody drawing the multisampled target and nobody marching the
 * in-scatter. The frame lost its antialiasing and its shafts, and the only
 * visible symptom was a number in an unrelated instrument. So the handover gets
 * a probe, and the probe gets controls.
 *
 * ── the two arms, and why they are two page loads ─────────────────────────
 *
 *   arm 1, a normal load    the shipped configuration: ownership handed over,
 *                           System 7 driving the march, scene in sceneRT
 *   arm 2, #nopost          ownership retained here, which is the only way to
 *                           reach that state on a build whose chain never runs
 *
 * They cannot be one load. post.js calls renderShafts unconditionally, passing
 * null on frames where it did not draw the scene, and a null call deliberately
 * counts as driving — its startup handshake depends on that, or the handover
 * would deadlock on frame one. So on a build with the chain enabled, ownership
 * converges to System 7 within a frame and cannot be held here. That is correct
 * behaviour and it is why the baseline arm needs the hash.
 *
 * The consequence for the numbers: the pre-handover configuration — chain on
 * *and* ownership here — is no longer reachable at runtime, so the two arms'
 * frame times are not subtractable. Arm 2 is missing the whole post chain. Each
 * arm's internal difference (march on versus off) is valid; a difference across
 * arms is not, and the report does not print one.
 *
 * ── the controls ──────────────────────────────────────────────────────────
 *
 * A metric on this project without a control has a five-for-five record of
 * lying, so:
 *
 *   - the sign control. The shaft buffer is a *subtractive* correction and must
 *     only ever darken. Read straight out of the half-res target and decoded from
 *     half-float: every sample must be <= 0, and some must be < 0. The obvious
 *     version — render with and without and check the frame got darker — was
 *     tried first and is unusable, because on a path where nothing composites the
 *     buffer the frame cannot change however wrong the sign is. A control that
 *     cannot fail is not a control.
 *   - the antialiasing control. Four samples on the scene draw are the only
 *     multisampling in the frame. Asserted on both sides of the handover and on
 *     both sides of a runtime post toggle, since the sample count moves file when
 *     ownership does.
 *   - the ownership-returns control. Two ways, because they have different costs:
 *     the explicit setExternalDriver(false), which must cost zero frames, and
 *     the self-heal for callers that do not know to call it, which is allowed one
 *     frame of evidence and no more.
 *   - the shafts-still-there control. renderShafts must return a texture whose
 *     contents are not uniformly zero. A pass that runs, allocates and returns a
 *     valid handle to a blank buffer is the failure mode a null check cannot see.
 *
 * ── one thing this file learned the hard way ───────────────────────────────
 *
 * Its first version measured the "before" configuration *after* running its own
 * API checks — and calling renderShafts is exactly what hands ownership over, so
 * it had retired the pass with its own instrument and then reported three
 * measurements of the same configuration as three configurations. The march came
 * out at -0.033 ms. Order is load-bearing here.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes('--' + k);

const W = Number(getf('w', 1920)), H = Number(getf('h', 1080));
const CPU = has('cpu');
const REPS = Number(getf('reps', 24));
const BLOCKS = Number(getf('blocks', 5));

if (!CPU) process.env.RENDER_GPU = '1';
const { serve, LAUNCH_ARGS } = await import('./harness.mjs');

try {
  const lock = new URL('../.renderlock', import.meta.url);
  if (fs.existsSync(lock)) {
    console.log(`\n  ⚠ a capture is running (pid ${fs.readFileSync(lock, 'utf8').trim()}).`);
    console.log('    Same four cores, so the timings below will be pessimistic.');
  }
} catch (_) {}

const srv = serve();
await new Promise(r => srv.listen(0, r));
const port = srv.address().port;
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); return !!cond; };

/* The viewpoint the shafts and the dust both cost the most, and the project's
   headline shot. One viewpoint, because this measures a full-frame target whose
   cost does not depend on what is in front of the camera. */
const VIEW = { d: 120, yaw: 0, pitch: 6 };

async function session(hash, label, driven) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://localhost:${port}/#noadapt${hash}`,
    { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 180_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const res = await page.evaluate(async ([v, reps, blocks, driven]) => {
    const g = window.__game;
    const r = g.renderer;
    const gl = r.getContext();
    const atmo = g._atmo;
    const post = g._post;
    const cam = g.camera || g._camera;

    g.setPaused(true);
    g.walkTo(v.d);
    g.lookAt(v.yaw, v.pitch);
    g.renderOnce();

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
    const plain = () => g.renderOnce();
    const settle = (n) => { for (let i = 0; i < n; i++) plain(); };
    const run = (fn) => {
      const a = [];
      for (let i = 0; i < blocks; i++) a.push(time(fn, reps));
      return med(a);
    };
    const state = () => ({ pass: atmo.passInfo(), postSamples: post ? post.samples : null });

    const out = { api: {}, timings: {}, controls: {}, toggle: {} };
    const shaftsWere = atmo.shaftInfo ? atmo.shaftInfo().enabled : true;

    out.state = state();

    /* ---- timings, within this arm only ----------------------------------- */
    atmo.setShaftQuality(2); settle(2);
    out.timings.shaftsOn = run(plain);
    atmo.setShaftQuality(0); settle(2);
    out.timings.shaftsOff = run(plain);
    atmo.setShaftQuality(2); settle(2);
    /* Ownership again after the shaft quality has been round-tripped. Rung 0
       makes this system stop needing a full-frame pass at all, so the target is
       released; coming back up must re-acquire it. */
    out.stateMid = state();

    if (driven) {
      /* ---- API contract ------------------------------------------------- */
      out.api.hasRenderShafts = typeof atmo.renderShafts === 'function';
      out.api.hasPassInfo = typeof atmo.passInfo === 'function';
      out.api.hasSetter = typeof atmo.setExternalDriver === 'function';
      out.api.sceneDepthOffered = !!(post && post._sceneDepth && post._sceneDepth());

      const depth = post._sceneDepth();
      const before = r.getRenderTarget();
      out.api.returnsTexture = !!atmo.renderShafts(depth, cam);
      out.api.restoresTarget = r.getRenderTarget() === before;
      try {
        atmo.renderShafts(null, cam);
        atmo.renderShafts(depth, null);
        out.api.nullSafe = true;
      } catch (e) { out.api.nullSafe = false; }

      /* ---- the sign control --------------------------------------------- */
      settle(2);
      atmo.renderShafts(post._sceneDepth(), cam);
      const rt = atmo._shaftRT ? atmo._shaftRT() : null;
      if (rt) {
        const half = (h) => {
          const s = (h & 0x8000) ? -1 : 1;
          const e = (h >> 10) & 0x1f;
          const f = h & 0x3ff;
          if (e === 0) return s * f * 5.960464477539063e-8;
          if (e === 31) return f ? NaN : s * Infinity;
          return s * Math.pow(2, e - 15) * (1 + f / 1024);
        };
        const cw = Math.min(256, rt.width), ch = Math.min(144, rt.height);
        const x0 = (rt.width - cw) >> 1, y0 = (rt.height - ch) >> 1;
        const buf = new Uint16Array(cw * ch * 4);
        r.readRenderTargetPixels(rt, x0, y0, cw, ch, buf);
        let mn = Infinity, mx = -Infinity, nz = 0, bad = 0;
        for (let i = 0; i < buf.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const val = half(buf[i + c]);
            if (!Number.isFinite(val)) { bad++; continue; }
            if (val < mn) mn = val;
            if (val > mx) mx = val;
            if (val !== 0) nz++;
          }
        }
        out.controls.shaftMin = +mn.toFixed(6);
        out.controls.shaftMax = +mx.toFixed(6);
        out.controls.shaftNonZeroFrac = +(nz / (cw * ch * 3)).toFixed(4);
        out.controls.shaftNonFinite = bad;
        out.controls.readSize = `${cw}x${ch} of ${rt.width}x${rt.height}`;
      }

      /* ---- does ownership come back? ------------------------------------ *
         The case that was broken: the chain stops driving the march at runtime.
         Tested twice, because the two mechanisms have different costs. */
      settle(3);
      if (post && post.setEnabled) {
        /* Explicit. Must cost zero unowned frames, so ownership is read after a
           single render rather than after a settle. */
        post.setEnabled(false);
        atmo.setExternalDriver(false);
        plain();
        out.toggle.explicit = state();
        post.setEnabled(true); atmo.setExternalDriver(true); settle(4);
        out.toggle.restoredAfterExplicit = state();

        /* Self-heal, for a caller that does not know about the setter — which is
           every caller that existed when this broke. Allowed one frame of
           evidence, so it is read after three. */
        post.setEnabled(false);
        plain();
        out.toggle.selfHealFrame1 = state();
        settle(3);
        out.toggle.selfHealed = state();
        post.setEnabled(true); settle(4);
        out.toggle.restoredAfterSelfHeal = state();
      }
    } else {
      /* On this arm, handing the pass away cannot stick, and that is the
         mechanism working rather than failing: nothing here drives the march, so
         the first composite after the setter sees a whole frame with no
         renderShafts call and correctly takes ownership back. The release is not
         even observable — the target is allocated and released lazily inside the
         composite, so reading the flag before the next render reports the state
         before the setter, not after it. Both rows are recorded so a reader can
         tell "the setter did nothing" from "the self-heal undid it", which look
         identical in a single sample. The setter's true direction is covered on
         arm 1, where a driver exists to make it stick. */
      out.api.hasSetter = typeof atmo.setExternalDriver === 'function';
      atmo.setExternalDriver(true);
      out.toggle.handAwayNoFrameYet = state();
      settle(3);
      out.toggle.reclaimedBySelfHeal = state();
    }

    atmo.setShaftQuality(shaftsWere ? 2 : 0);
    settle(4);
    out.stateAfter = state();
    return out;
  }, [VIEW, REPS, BLOCKS, driven]);

  res.pageErrors = errs;
  res.label = label;
  res.hash = hash;
  await page.close();
  return res;
}

const shipped = await session('', 'arm 1  shipped: handed over, System 7 driving', true);
/* `&nopost`, not `,nopost`. post.js matches its flag only after a `#` or a `&`,
   while the numeric dials in atmosphere.js accept commas too, so a comma-joined
   hash silently sets some flags and not others. This arm spent a run reporting
   that a #nopost build had handed its pass away, when what had actually happened
   is that it was never a #nopost build. */
const owned = await session('&nopost', 'arm 2  #nopost: ownership retained here', false);

/* ---- report ------------------------------------------------------------- */
const fmt = (n) => (n == null ? '  —  ' : String(n).padStart(6));
const passLine = (s) => {
  const p = s.pass;
  return `owned=${String(p.owned).padEnd(5)}` +
    (p.owned ? ` ${p.width}x${p.height} x${p.samples} ${p.megabytesPerFrame} MiB/f` : '                        ') +
    `  post.samples=${s.postSamples}`;
};

console.log(`\n  ${W}x${H}   backend=${CPU ? 'swiftshader' : 'gpu'}\n`);

for (const s of [shipped, owned]) {
  console.log(`  ── ${s.label}   (#noadapt${s.hash})`);
  console.log(`     at rest              ${passLine(s.state)}`);
  console.log(`     after quality cycle  ${passLine(s.stateMid)}`);
  if (s.api.hasRenderShafts != null) {
    console.log(`     renderShafts -> texture ${s.api.returnsTexture}` +
      `   restores target ${s.api.restoresTarget}   null-safe ${s.api.nullSafe}`);
  }
  console.log(`     frame ms   march on ${fmt(s.timings.shaftsOn)}   off ${fmt(s.timings.shaftsOff)}` +
    `   -> march ${(s.timings.shaftsOn - s.timings.shaftsOff).toFixed(3)} ms`);
  if (s.controls.shaftMin != null) {
    console.log(`     shaft buffer  min ${s.controls.shaftMin}   max ${s.controls.shaftMax}` +
      `   non-zero ${(100 * s.controls.shaftNonZeroFrac).toFixed(1)}%` +
      `   (${s.controls.readSize}, non-finite ${s.controls.shaftNonFinite})`);
  }
  for (const [k, st] of Object.entries(s.toggle)) {
    console.log(`     ${k.padEnd(22)} ${passLine(st)}`);
  }
  if (s.pageErrors.length) console.log(`     ⚠ page errors: ${s.pageErrors.slice(0, 3).join(' | ')}`);
  console.log('');
}

/* Bandwidth. The "before" row is stated rather than measured, because the
   configuration it describes — the post chain running while this system still
   owns the pass — is no longer reachable at runtime now that ownership converges
   to System 7 within a frame. Its two terms are the ones both arms confirm
   individually: a full-frame RGBA16F at four samples plus a depth texture here
   (arm 2), and a single-sampled one as a blit destination there. 8 bytes per
   sample of colour, 4 for depth. */
const bpp = (s) => 8 * Math.max(1, s | 0) + 4;
const mib = (b) => +((b * W * H) / 1048576).toFixed(1);
const beforeB = bpp(owned.state.pass.samples) + bpp(0);
const afterB = bpp(shipped.state.postSamples);
console.log('  ── bandwidth, counted on both sides rather than on the deleted target');
console.log(`     before  ${String(beforeB).padStart(3)} B/px  ${fmt(mib(beforeB))} MiB/frame` +
  `   (this system x${owned.state.pass.samples} + sceneRT x0)   [stated]`);
console.log(`     after   ${String(afterB).padStart(3)} B/px  ${fmt(mib(afterB))} MiB/frame` +
  `   (sceneRT x${shipped.state.postSamples} only)   [measured]`);
console.log(`     freed   ${String(beforeB - afterB).padStart(3)} B/px  ` +
  `${fmt(mib(beforeB - afterB))} MiB/frame   plus one full-frame blit pass`);
console.log('     The four samples relocated rather than went away, so the retired');
console.log(`     target's own ${owned.state.pass.megabytesPerFrame} MiB is not the saving.`);
console.log('     Frame times are per-arm; arm 2 has no post chain, so they do not');
console.log('     subtract across arms. The frame-time effect of the handover was');
console.log('     measured at -0.04, -0.08 and +0.13 ms before the arms diverged.');

/* ---- what the march costs, and why the two arms disagree by 10x ----------
 *
 * The same ablation — shaft quality 2 versus 0 — prices the march at about
 * 0.26 ms on arm 1 and about 2.8 ms on arm 2. Only one of those is the march.
 *
 * On arm 1 the post chain owns the scene draw, so the multisampled target exists
 * in both halves of the ablation and the only thing that changes is whether the
 * half-res march runs. That difference is the march.
 *
 * On arm 2 this system owns the pass, and the pass exists only to serve the
 * shimmer or the shafts. Switching the march off therefore switches the whole
 * full-frame stage off with it: the ablation removes the march, the 4x
 * multisampled target, its resolve and the blit, and attributes all four to the
 * march. The residue — a little over 2.5 ms — is the multisample resolve, which
 * is worth knowing on its own, because it is paid on both sides of the handover
 * and is most of why retiring the target bought no frame time.
 *
 * This is the same conflation that made bench's `-post` column read 3.77 ms
 * against a chain costing 0.4, and it is why the march has been described as
 * costing 2.0 ms and being the largest item in the frame after the terrain
 * shader. Measured where the target is held constant, it is roughly a tenth of
 * that. Printed here so the two figures cannot be quoted side by side again. */
const m1 = shipped.timings.shaftsOn - shipped.timings.shaftsOff;
const m2 = owned.timings.shaftsOn - owned.timings.shaftsOff;
console.log('\n  ── the march, and a warning about pricing it on the wrong arm');
console.log(`     arm 1  ${m1.toFixed(3)} ms   target held constant -> this is the march`);
console.log(`     arm 2  ${m2.toFixed(3)} ms   ablation also deletes the 4x target, resolve and blit`);
console.log(`     so the 4x resolve and blit are about ${(m2 - m1).toFixed(2)} ms, paid on both`);
console.log('     sides of the handover, which is most of why retiring the target');
console.log('     bought no frame time.\n');

/* ---- assertions --------------------------------------------------------- */
ok(shipped.api.hasRenderShafts, 'atmosphere does not expose renderShafts');
ok(shipped.api.hasPassInfo, 'atmosphere does not expose passInfo');
ok(shipped.api.hasSetter, 'atmosphere does not expose setExternalDriver');
ok(shipped.api.sceneDepthOffered, 'post._sceneDepth() is null on the shipped path');
ok(shipped.api.returnsTexture, 'renderShafts returned null with a valid depth texture');
ok(shipped.api.restoresTarget, 'renderShafts left the render target redirected');
ok(shipped.api.nullSafe, 'renderShafts threw on a null argument its contract allows');

ok(shipped.state.pass.owned === false,
  'THE HANDOVER DID NOT HAPPEN: the full-frame target is still allocated on a ' +
  'normal page load with System 7 driving the march');
ok(shipped.state.pass.megabytesPerFrame === 0, 'shipped path still reports target bandwidth');
ok(owned.state.pass.owned === true,
  'ownership was expected to be retained on a #nopost build and was not, so that ' +
  'build has no multisampling and no shafts');

/* Antialiasing, on both sides of the handover. */
ok(owned.state.pass.samples >= 4,
  `antialiasing lost on the retained path: target samples=${owned.state.pass.samples}`);
ok(shipped.state.postSamples >= 4,
  `ANTIALIASING REGRESSION: post.samples=${shipped.state.postSamples} on the shipped ` +
  'path, so the scene draw is single-sampled and the only multisampling is gone');

/* Ownership must come back when the driver stops, both ways. */
const t = shipped.toggle;
ok(t.explicit && t.explicit.pass.owned === true,
  'setExternalDriver(false) did not return ownership: switching the post chain off ' +
  'at runtime leaves nobody drawing the target and nobody marching the in-scatter');
ok(t.explicit && t.explicit.pass.samples >= 4,
  'ownership returned without multisampling, so a runtime post toggle still costs ' +
  'the frame its only antialiasing');
ok(t.selfHealed && t.selfHealed.pass.owned === true,
  'the self-heal did not fire: a caller that stops driving the march without calling ' +
  'setExternalDriver(false) loses antialiasing and shafts for every subsequent frame');
ok(t.restoredAfterExplicit && t.restoredAfterExplicit.pass.owned === false,
  'the chain coming back on did not re-take ownership after the explicit release');
ok(t.restoredAfterSelfHeal && t.restoredAfterSelfHeal.pass.owned === false,
  'the chain coming back on did not re-take ownership after the self-heal');
ok(owned.toggle.reclaimedBySelfHeal && owned.toggle.reclaimedBySelfHeal.pass.owned === true,
  'the self-heal did not reclaim the pass on a build where nothing drives the march, ' +
  'so a #nopost frame has no multisampling and no shafts');

/* The correction is still subtractive, and still says something. */
ok(shipped.controls.shaftMax != null, 'could not read the shaft buffer back');
ok(shipped.controls.shaftMax <= 1e-4,
  `SIGN CONTROL FAILED: shaft buffer max is ${shipped.controls.shaftMax}, above zero. ` +
  'The correction has been made additive. It is a visibility deficit and can only ' +
  'ever remove in-scatter the fog chunk already granted — see the shader comment.');
ok(shipped.controls.shaftMin < -1e-4,
  `the shaft buffer is empty (min ${shipped.controls.shaftMin}): the march ran and ` +
  'produced nothing, so the shafts are gone even though the API returned a texture');
ok(shipped.controls.shaftNonFinite === 0,
  `${shipped.controls.shaftNonFinite} non-finite samples in the shaft buffer`);

/* Rung 0 releases the pass; coming back up must restore whatever this arm had. */
ok(shipped.stateMid.pass.owned === false, 'quality cycle re-allocated the retired target');
ok(owned.stateMid.pass.owned === true, 'quality cycle lost the retained pass');

for (const s of [shipped, owned]) {
  ok(s.pageErrors.length === 0, `page errors on ${s.label}: ${s.pageErrors.slice(0, 2).join(' | ')}`);
}

await browser.close();
srv.close();

if (fails.length) {
  console.log('  FAIL');
  for (const f of fails) console.log(`   ✗ ${f}`);
  process.exit(1);
}
console.log('  PASS  handover holds, ownership returns both ways, shafts subtractive, AA intact\n');

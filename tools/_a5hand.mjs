/* _a5hand.mjs — does the depth handover actually happen, and what does it buy?
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
 * System 7's sceneRT now carries a depth texture of its own, so the target can
 * go: the scene lands there, and the march reads their depth through
 * atmosphere's renderShafts().
 *
 * None of that is visible in a frame. A regression would show up as bandwidth
 * and nothing else, or — worse — as the shafts or the antialiasing quietly
 * vanishing while every colour metric on the project still passed. So the
 * handover gets an instrument, and the instrument gets controls.
 *
 * ── the four configurations, and why the saving is the difference of two ────
 *
 *   A  pass owned, shafts on     what shipped before this change
 *   B  pass owned, shafts off    A − B is what the march costs
 *   C  pass retired, shafts off  B − C is the target on its own: THE SAVING
 *   D  pass retired, shafts on   what ships after this change
 *
 * D is measured rather than predicted as C + (A − B), because a prediction
 * cannot catch the march getting more expensive when it reads a multisampled
 * depth texture instead of a single-sampled one — which is a real possibility
 * and exactly the kind of thing this project has been caught assuming.
 *
 * `#handover=1` gives C and D: it pre-latches the ownership flag, so the pass
 * steps aside whether or not anything is driving the march. In D the march is
 * driven from here, one call per frame with System 7's depth, which is precisely
 * what their chain will do. So D is a measurement of the shipped path before the
 * call site on their side exists.
 *
 * ── the controls ──────────────────────────────────────────────────────────
 *
 * A metric on this project without a control has a five-for-five record of
 * lying, so:
 *
 *   - the sign control. The shaft buffer is a *subtractive* correction and must
 *     only ever darken. Read straight out of the half-res target and decoded from
 *     half-float: every sample must be <= 0, and some must be < 0. The obvious
 *     version of this test — render with and without and check the frame got
 *     darker — was tried first and is unusable, because on the retired path
 *     nothing composites the buffer yet, so the frame cannot change however
 *     wrong the sign is. A control that cannot fail is not a control.
 *   - the antialiasing control. Four samples on the scene draw are the only
 *     multisampling in the frame. Asserted on both sides of the handover, since
 *     the sample count moves file when ownership does.
 *   - the shafts-still-there control. renderShafts must return a texture whose
 *     contents are not uniformly zero. A pass that runs, allocates and returns a
 *     valid handle to a blank buffer is the failure mode a null check cannot see.
 *
 * ── one thing this file learned the hard way ───────────────────────────────
 *
 * The first version of it measured the "before" configuration *after* running
 * its own API checks — and calling renderShafts is exactly what latches the
 * ownership flag, so it had retired the pass with its own instrument and then
 * reported A, B and C as three measurements of the same configuration. The
 * march came out at -0.033 ms. So: the un-latched session does its timings
 * first and touches renderShafts never, and the API checks live in the latched
 * session only. Order is load-bearing here.
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

async function session(hash, label) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://localhost:${port}/#noadapt${hash}`,
    { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 180_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const res = await page.evaluate(async ([v, reps, blocks, latched]) => {
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
    const run = (fn) => {
      const a = [];
      for (let i = 0; i < blocks; i++) a.push(time(fn, reps));
      return med(a);
    };

    const depth = () => (post && post._sceneDepth ? post._sceneDepth() : null);
    const plain = () => g.renderOnce();
    const driven = () => { g.renderOnce(); atmo.renderShafts(depth(), cam); };

    const out = { api: {}, timings: {}, controls: {} };
    const shaftsWere = atmo.shaftInfo ? atmo.shaftInfo().enabled : true;

    /* ---- ownership, read before anything can perturb it ------------------- */
    out.pass = atmo.passInfo();
    out.postSamples = post ? post.samples : null;

    /* ---- timings ---------------------------------------------------------- *
       On the un-latched session this must not call renderShafts, directly or
       indirectly, or it retires the very pass it is trying to price. */
    atmo.setShaftQuality(2);
    out.timings.shaftsOn = run(plain);
    atmo.setShaftQuality(0);
    out.timings.shaftsOff = run(plain);
    atmo.setShaftQuality(2);
    /* Ownership again, after the shaft quality has been round-tripped. Rung 0
       makes this system stop needing a full-frame pass at all, so the target is
       released; coming back up must re-acquire it. A frame first, because the
       target is allocated lazily inside the composite and reading the flag
       between the setter and the next render reports the gap, not the state. */
    plain();
    out.passMid = atmo.passInfo();

    if (latched) {
      /* ---- API contract. Latching is a one-way door, so it happens here and
         only here, and only in the session that is already latched. --------- */
      out.api.hasRenderShafts = typeof atmo.renderShafts === 'function';
      out.api.hasPassInfo = typeof atmo.passInfo === 'function';
      out.api.sceneDepthOffered = !!depth();

      /* It is called in the middle of System 7's frame, so it must not leave the
         renderer pointed at its own target. */
      const before = r.getRenderTarget();
      const tex = atmo.renderShafts(depth(), cam);
      out.api.returnsTexture = !!tex;
      out.api.restoresTarget = r.getRenderTarget() === before;
      try {
        atmo.renderShafts(null, cam);
        atmo.renderShafts(depth(), null);
        out.api.nullSafe = true;
      } catch (e) { out.api.nullSafe = false; }

      out.timings.shaftsOnDriven = run(driven);

      /* ---- the sign control ---------------------------------------------- *
         Straight out of the half-res buffer. Half-float, so the bits come back
         in a Uint16Array and are decoded here rather than trusted. */
      driven();
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
    }

    atmo.setShaftQuality(shaftsWere ? 2 : 0);
    /* A few frames so post can re-allocate sceneRT once ownership settled: the
       sample count is applied on the branch that draws the scene, which only
       becomes this one after composite has returned false at least once. */
    for (let i = 0; i < 4; i++) plain();
    out.passAfter = atmo.passInfo();
    out.samplesAfter = post ? post.samples : null;
    return out;
  }, [VIEW, REPS, BLOCKS, /handover/.test(hash)]);

  res.pageErrors = errs;
  await page.close();
  return { label, hash, ...res };
}

const owned = await session('', 'A/B  pass owned (before)');
const retired = await session(',handover=1', 'C/D  pass retired (after)');

/* ---- report ------------------------------------------------------------- */
const fmt = (n) => (n == null ? '  —  ' : String(n).padStart(6));
console.log(`\n  ${W}x${H}   backend=${CPU ? 'swiftshader' : 'gpu'}\n`);

for (const s of [owned, retired]) {
  console.log(`  ── ${s.label}  (#noadapt${s.hash})`);
  const p = s.pass;
  console.log(`     full-frame pass owned here : ${p.owned}` +
    (p.owned ? `  ${p.width}x${p.height} RGBA16F x${p.samples}  ${p.megabytesPerFrame} MB/frame` : ''));
  console.log(`     externalDriver latched     : ${p.externalDriver}`);
  console.log(`     post.samples (scene draw)  : ${s.postSamples}`);
  console.log(`     post.samples after settle  : ${s.samplesAfter}`);
  if (s.api.hasRenderShafts != null) {
    console.log(`     renderShafts -> texture    : ${s.api.returnsTexture}` +
      `   restores target: ${s.api.restoresTarget}   null-safe: ${s.api.nullSafe}`);
  }
  console.log(`     frame ms  shafts on  ${fmt(s.timings.shaftsOn)}` +
    `   off ${fmt(s.timings.shaftsOff)}` +
    (s.timings.shaftsOnDriven != null ? `   on+driven ${fmt(s.timings.shaftsOnDriven)}` : ''));
  if (s.controls.shaftMin != null) {
    console.log(`     shaft buffer  min ${s.controls.shaftMin}   max ${s.controls.shaftMax}` +
      `   non-zero ${(100 * s.controls.shaftNonZeroFrac).toFixed(1)}%` +
      `   (${s.controls.readSize}, non-finite ${s.controls.shaftNonFinite})`);
  }
  if (s.pageErrors.length) console.log(`     ⚠ page errors: ${s.pageErrors.slice(0, 3).join(' | ')}`);
  console.log('');
}

const A = owned.timings.shaftsOn;
const B = owned.timings.shaftsOff;
const C = retired.timings.shaftsOff;
const D = retired.timings.shaftsOnDriven;

console.log('  ── the saving');
console.log(`     A  owned,   shafts on   ${fmt(A)} ms    what shipped before`);
console.log(`     B  owned,   shafts off  ${fmt(B)} ms    A-B = march      ${(A - B).toFixed(3)} ms`);
console.log(`     C  retired, shafts off  ${fmt(C)} ms    B-C = the target ${(B - C).toFixed(3)} ms`);
console.log(`     D  retired, shafts on   ${fmt(D)} ms    what ships after`);
console.log(`     net  A-D = ${(A - D).toFixed(3)} ms  (${(100 * (A - D) / A).toFixed(1)}% of frame)`);

/* ---- what the bandwidth actually does, which is not what it looks like ----
 *
 * The tempting headline is the retired target's own figure — a full-frame
 * RGBA16F at four samples, ~71 MiB a frame at 1080p. That number is wrong as a
 * saving, and the column that gives it away is post.samples: 0 before, 4 after.
 *
 * Four samples on the scene draw are the only antialiasing in the frame and had
 * to be preserved, so they did not go away when this target did — they moved to
 * sceneRT, which used to be a single-sampled blit destination and is now the
 * multisampled scene target. The multisample resolve is paid either way. What is
 * genuinely gone is the *duplicate*: the second full-frame float target that the
 * blit existed to write into, and the blit itself.
 *
 * So the arithmetic below is per-pixel bytes of full-frame target traffic on
 * each side, rather than the size of the thing that was deleted. 8 bytes a
 * sample for RGBA16F colour, plus 4 for the depth texture. */
const bpp = (s) => 8 * Math.max(1, s | 0) + 4;
const pxCount = W * H;
const beforeB = bpp(owned.pass.samples) + bpp(owned.samplesAfter);   // mine + sceneRT
const afterB = bpp(retired.samplesAfter);                            // sceneRT alone
const mib = (b) => +((b * pxCount) / 1048576).toFixed(1);
console.log('\n  ── bandwidth, counted on both sides rather than on the deleted target');
console.log(`     before  ${String(beforeB).padStart(3)} B/px  ${fmt(mib(beforeB))} MiB/frame` +
  `   (this system x${owned.pass.samples} + sceneRT x${owned.samplesAfter || 0})`);
console.log(`     after   ${String(afterB).padStart(3)} B/px  ${fmt(mib(afterB))} MiB/frame` +
  `   (sceneRT x${retired.samplesAfter} only)`);
console.log(`     freed   ${String(beforeB - afterB).padStart(3)} B/px  ` +
  `${fmt(mib(beforeB - afterB))} MiB/frame   plus one full-frame blit pass`);
console.log('     the multisampling relocated rather than went away, so the retired');
console.log(`     target's own ${owned.pass.megabytesPerFrame} MiB is not the saving.\n`);

/* ---- assertions --------------------------------------------------------- */
ok(retired.api.hasRenderShafts, 'atmosphere does not expose renderShafts');
ok(retired.api.hasPassInfo, 'atmosphere does not expose passInfo');
ok(retired.api.sceneDepthOffered, 'post._sceneDepth() is null on the retired path');
ok(retired.api.returnsTexture, 'renderShafts returned null with a valid depth texture');
ok(retired.api.restoresTarget, 'renderShafts left the render target redirected');
ok(retired.api.nullSafe, 'renderShafts threw on a null argument its contract allows');

ok(owned.pass.owned === true, 'the pass was expected to be owned here and was not');
ok(retired.pass.owned === false,
  'THE HANDOVER DID NOT HAPPEN: the full-frame target is still allocated with #handover=1');
ok(retired.pass.megabytesPerFrame === 0, 'retired path still reports target bandwidth');

/* Antialiasing. The sample count moves file when ownership does, so it is
   checked on both sides and must be four on whichever side draws the scene. */
ok(owned.pass.samples >= 4,
  `antialiasing lost on the owned path: atmosphere target samples=${owned.pass.samples}`);
ok(retired.samplesAfter >= 4,
  `ANTIALIASING REGRESSION: post.samples=${retired.samplesAfter} after the handover, ` +
  'so the scene draw is single-sampled and the only multisampling in the frame is gone');

/* The correction is still subtractive, and still says something. */
ok(retired.controls.shaftMax != null, 'could not read the shaft buffer back');
ok(retired.controls.shaftMax <= 1e-4,
  `SIGN CONTROL FAILED: shaft buffer max is ${retired.controls.shaftMax}, above zero. ` +
  'The correction has been made additive. It is a visibility deficit and can only ' +
  'ever remove in-scatter the fog chunk already granted — see the shader comment.');
ok(retired.controls.shaftMin < -1e-4,
  `the shaft buffer is empty (min ${retired.controls.shaftMin}): the march ran and ` +
  'produced nothing, so the shafts are gone even though the API returned a texture');
ok(retired.controls.shaftNonFinite === 0,
  `${retired.controls.shaftNonFinite} non-finite samples in the shaft buffer`);

/* Rung 0 disposes the half-res target; coming back up must not have taken the
   full-frame one with it, in either direction. */
ok(owned.passMid.owned === true, 'shaft quality round-trip lost the owned pass');
ok(retired.passMid.owned === false, 'shaft quality round-trip re-allocated the retired target');

for (const s of [owned, retired]) {
  ok(s.pageErrors.length === 0, `page errors on ${s.label}: ${s.pageErrors.slice(0, 2).join(' | ')}`);
}

await browser.close();
srv.close();

if (fails.length) {
  console.log('  FAIL');
  for (const f of fails) console.log(`   ✗ ${f}`);
  process.exit(1);
}
console.log('  PASS  handover complete, shafts subtractive, antialiasing intact\n');

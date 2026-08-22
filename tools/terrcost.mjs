/* Inside the terrain fragment shader: which block costs the milliseconds?
 *
 *   node tools/terrcost.mjs --w 2560 --h 1440
 *
 * tools/fillcost.mjs establishes that the ground shader is 24.2 ms of a
 * 30.7 ms frame at 1440p — 79% of it, against 1.5 for all the rock, 0.8 for
 * the vegetation and nothing measurable for anything else. That is the answer
 * to "which fill", and it immediately raises the next question, which this
 * answers: the ground shader is nine hundred lines and forty-one texture
 * fetches, and cutting the wrong third of it buys nothing.
 *
 * Method: the material's assembled fragment source is rewritten at runtime,
 * one substitution at a time, and the frame is re-timed. Each substitution
 * turns one block into the identity it computes at weight zero, or replaces a
 * fetch with a constant, so the driver's dead-code elimination removes that
 * block and nothing else. Same geometry, same vertex program, same draw order.
 *
 * A substitution that does not match is reported rather than silently
 * measuring the unmodified shader — CONTRACT.md's standing lesson is that a
 * change which did nothing and a change that was never applied look identical,
 * so `hit` is printed beside every row.
 *
 * These are measurements, not proposals. Several of the blocks priced here are
 * contracted picture and cannot be removed; knowing what they cost is how one
 * decides which of them is worth finding a cheaper form for.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes('--' + k);

const W = Number(getf('w', 1920)), H = Number(getf('h', 1080));
const JSON_OUT = has('json');
const REPS = Number(getf('reps', 24));
const BLOCKS = Number(getf('blocks', 7));

const VIEWS = [
  { name: 'wash_mid', d: 46, yaw: 0, pitch: 0 },
  { name: 'sun_gap', d: 120, yaw: 0, pitch: 6 },
];

/* Each entry is [name, find, replace]. `find` is a literal substring of the
   assembled fragment shader — literal rather than regex so a match is
   unambiguous and a miss is loud. */
const ABLATIONS = [
  /* The four extra shadow taps the footprint filter added, now a bilinear
     4-tap each rather than a full getShadow each. Weighted by `wide`, which is
     zero in the near field, so there they are a no-op that used to be paid for
     anyway. Sixteen comparisons per light. */
  ['shadowWide', 'if (wide > 0.02) {', 'if (false) {'],
  /* The centre tap on its own, and re-read this row before quoting it against
     an old table: it is no longer three's fixed kernel. Since `639309d` /
     `543ea94` it is System 4's blocker-search penumbra — a 12-tap search, then
     either three's 16-tap kernel at contact or up to 28 spiral taps at width,
     hybridised across the changeover, times two cascades. It carries the
     penumbra that took the wall_shade terminator from 3 px to 27, so it cannot
     go; `node tools/bench.mjs --hash hardshadow` is the way to price it against
     the fixed kernel without pretending it is removable. */
  ['shadowCentre', 'float s = getShadow(sm, sz, si, sb, sr, sc);', 'float s = 1.0;'],
  /* Not an ablation — the opposite. This puts the *old* footprint estimator
     back, four full getShadow calls at the offsets, and so reports a negative
     saving. It exists because the penumbra landing under the reduction changes
     what that reduction is worth: when the offsets were three's fixed kernel
     they were 16 comparisons each, and now each one would be a blocker search
     plus a spiral. The row prices that directly instead of multiplying
     shadowCentre by four and calling it an estimate. Pair it with
     tools/shadowpair.mjs, which renders the same substitution for the picture. */
  ['footFull(+)', 'footTap(sm, sz, si, sb, sc', 'getShadow(sm, sz, si, sb, sr, sc'],
  /* Every shadow lookup this material makes at once. Not a proposal — it
     deletes the cast shadows — but it prices the whole shadow term against
     everything else in the shader. */
  ['shadowAll', 'float s = getShadow(sm, sz, si, sb, sr, sc);',
    'return gRake; float s = getShadow(sm, sz, si, sb, sr, sc);'],
  /* The raking grain march: nine fetches, eight of them in a loop. */
  ['rakeMarch', 'if (rakeW * grainF > 0.002) {', 'if (false) {'],
  /* Steep reprojection: six fetches on bank faces. */
  ['steepTri', 'if (steep > 0.006) {', 'if (false) {'],
  /* Sand: three fetches inside a slack-water lobe. */
  ['sandTri', 'if (sandW > 0.0015) {', 'if (false) {'],
  /* Wall rock triplanar: nine fetches plus three normalizes. */
  ['rockTri', 'if (rockW > 0.002) {', 'if (false) {'],
  /* Cut-bank stratification. */
  ['bankStrat', 'if (bankW > 0.004) {', 'if (false) {'],
  /* The midground bedform normal: four band-limited cosines, six envelope
     sines, four fwidths. No texture fetches at all, which is the point of
     pricing it — an ALU block in a shader everyone assumes is fetch-bound. */
  ['bedform', 'if (bedW > 0.004) {', 'if (false) {'],
  /* Every band-limited sine in the shader at once: the ripple train, the
     lineation and the cobble mottle, with their fwidths. */
  ['bsinAll',
    'return sin(ph * 6.2831853) * (1.0 - smoothstep(0.22, 0.55, fwidth(ph)));',
    'return 0.0;'],
  /* The footprint-locked grit: two fetches and an octave crossfade. */
  ['grit',
    'vec4 gr = mix(texture2D(uGrit, gUV * gSc), texture2D(uGrit, gUV * gSc * 0.5), gTw);',
    'vec4 gr = vec4(0.427, 0.5, 0.5, 0.934);'],
  /* The mud-crack fetch and the derivative bump hung off it. */
  ['crack',
    'vec3 ck = texture2D(uCrack, rot2(wxz, 2.10) * 0.3846).rgb;',
    'vec3 ck = vec3(0.30, 0.5, 0.30);'],
  /* The two dirt tiles: six fetches, unconditional, on every ground pixel. */
  ['dirtPair',
    'vec3 dirtA = mix(texture2D(uDirtA, d1, aniso).rgb, texture2D(uDirtA, d2, aniso).rgb, dB);',
    'vec3 dirtA = texture2D(uDirtA, d1, aniso).rgb;'],
  /* The three macro/variance maps, which gate almost everything downstream. */
  ['macro3',
    'vec4 mac  = texture2D(uMacro, wxz * 0.0164);',
    'vec4 mac  = vec4(0.5);'],
];

process.env.RENDER_GPU = '1';
const { serve, LAUNCH_ARGS } = await import('./harness.mjs');

try {
  const lock = new URL('../.renderlock', import.meta.url);
  if (fs.existsSync(lock)) console.log(`\n  ⚠ a capture is running; figures will be pessimistic.`);
} catch (_) {}

const srv = serve();
await new Promise(r => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/#noadapt`;

const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
const out = { w: W, h: H, views: {} };

try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 180_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const adapter = await page.evaluate(() => {
    const gl = window.__game.renderer.getContext();
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
  out.adapter = adapter;
  if (!JSON_OUT) console.log(`\n  ${W}x${H}\n  ${adapter}`);

  await page.evaluate(() => {
    const g = window.__game;
    const t = g._scene.getObjectByName('terrain');
    const mat = t.material;
    /* `seen` outlives the per-view measurement on purpose. A program is cached
       under the ablation's name, so it compiles once for the whole run and the
       second view can only ever observe "onBeforeCompile did not run" — which
       is true and is not a problem, because the program being timed there is
       the same one whose substitution was counted in the first view. Recording
       it once and carrying it is the honest form; re-reading a per-view flag is
       how this column came to print NO beside a 4.44 ms saving. */
    window.__tc = { mat, saved: mat.onBeforeCompile, sub: null, sites: -1, seen: {} };
    mat.onBeforeCompile = function (shader, renderer) {
      window.__tc.saved.call(this, shader, renderer);
      const s = window.__tc.sub;
      if (!s) return;
      const parts = shader.fragmentShader.split(s.find);
      window.__tc.sites = parts.length - 1;
      window.__tc.seen[s.name] = parts.length - 1;
      shader.fragmentShader = parts.join(s.replace);
    };
    /* The stock key is a constant string, so the two variants would otherwise
       share one compiled program and every ablation would measure the first
       one compiled. */
    mat.customProgramCacheKey = () => 'sedona-terrain-v3|tc:' + (window.__tc.sub ? window.__tc.sub.name : '-');
    mat.needsUpdate = true;
  });

  const measure = (view) => page.evaluate(async ([v, abl, reps, blocks]) => {
    const g = window.__game, gl = g.renderer.getContext();
    g.setPaused(true);
    g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);

    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const frame = () => g.renderOnce();
    const time = (n) => {
      for (let i = 0; i < 6; i++) frame();
      sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) frame();
      sync();
      return (performance.now() - t0) / n;
    };
    const med = (a) => +a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(3);

    const set = (s) => {
      window.__tc.sub = s;
      window.__tc.sites = -1;     // "onBeforeCompile did not run", distinct from "ran and matched nothing"
      window.__tc.mat.needsUpdate = true;
      frame();                    // compile, untimed
    };

    const names = ['full', ...abl.map(a => a[0])];
    const acc = {}; for (const n of names) acc[n] = [];
    /* ---- this column read NO for every row, and the rows were fine ----
       customProgramCacheKey carries the ablation's name, which is what stops
       every variant sharing one program — but it also means the program is in
       three's cache from block 0 onward, so onBeforeCompile does not run again
       and a per-block read of the flag reports the *last* block: not compiled,
       therefore not substituted, therefore "NO — CHECK" printed beside a
       perfectly good 4.44 ms saving. The compiled program the later blocks time
       is the substituted one; it is only the flag that went stale. So read the
       run-long record, and print the number of sites rather than a boolean,
       because "matched nothing" and "was never asked" are different failures
       and a bare `false` conflates them. */
    const hits = window.__tc.seen;

    set(null);
    time(12);
    for (let b = 0; b < blocks; b++) {
      set(null);
      acc.full.push(time(reps));
      for (const [name, find, replace] of abl) {
        set({ name, find, replace });
        acc[name].push(time(reps));
      }
    }
    set(null);
    frame();
    g.setPaused(false);

    const res = { view: v.name, hits: { ...hits } };
    for (const n of names) res[n] = med(acc[n]);
    return res;
  }, [view, ABLATIONS, REPS, BLOCKS]);

  for (const v of VIEWS) {
    const r = await measure(v);
    out.views[v.name] = r;
    if (!JSON_OUT) {
      console.log(`\n  ── ${v.name} — full frame ${r.full.toFixed(2)} ms ──`);
      console.log('  block            frame ms    saving   sites substituted');
      const rows = ABLATIONS.map(a => a[0])
        .map(n => [n, r[n], r.full - r[n], r.hits[n]])
        .sort((a, b) => b[2] - a[2]);
      for (const [n, ms, d, sites] of rows) {
        const tag = sites > 0 ? String(sites)
          : sites === 0 ? '0 — MATCHED NOTHING'
          : 'NEVER COMPILED — CHECK';   // no program was ever built for this key

        console.log(`  ${n.padEnd(14)} ${ms.toFixed(2).padStart(9)} ${d.toFixed(2).padStart(9)}   ${tag}`);
      }
    }
  }

  out.errors = [...new Set(errs)].slice(0, 8);
  if (!JSON_OUT) {
    if (out.errors.length) { console.log('\n  ── page errors ──'); out.errors.forEach(e => console.log('   ', e)); }
    console.log('');
  } else {
    console.log(JSON.stringify(out, null, 2));
  }
} catch (e) {
  console.error('\n✗ terrcost failed:', e && e.message || e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  srv.close();
}

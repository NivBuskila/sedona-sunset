/* Which fragment shader costs the milliseconds?
 *
 *   node tools/fillcost.mjs --w 2560 --h 1440
 *   node tools/fillcost.mjs --w 2560 --h 1440 --json
 *
 * ── why this exists, given tools/bench.mjs already runs on the GPU ─────────
 *
 * bench.mjs proved the frame is fill-bound: at 0.7 render scale — 49% of the
 * pixels — `wash_mid` goes 30.49 ms to 19.58, while removing the far ridges,
 * the vegetation, the shadows, the particles and the whole post chain are all
 * inside the noise. That is a strong result and it is only half an answer. It
 * says the cost scales with pixels; it does not say *whose* pixels.
 *
 * Every ablation bench.mjs has is an *object* ablation — it hides a mesh. That
 * is the wrong instrument for this question twice over. Hiding the terrain does
 * not tell you what the terrain shader costs, because whatever is behind it
 * then has to be shaded instead; and the two biggest fragment consumers in the
 * frame, the ground and the sky dome, are exactly the two you cannot hide
 * without changing which pixels exist.
 *
 * So this ablates the *shader* and leaves the object. Each material's fragment
 * program gets an early `gl_FragColor = <constant>; return;` spliced into the
 * top of main, which the driver's dead-code elimination then reduces to a
 * write. Same geometry, same vertex shader, same draw order, same overdraw,
 * same depth and stencil behaviour, same number of shaded pixels — only the
 * per-pixel work is gone. The delta is that material's fragment cost, in
 * milliseconds, at this viewpoint and this resolution.
 *
 * Three things to know before reading the table:
 *
 * · It is an *upper* bound on what optimising that shader can buy, not a
 *   promise. Reducing a shader to one instruction is not an optimisation
 *   anyone can ship.
 * · Deltas do not have to sum to the frame. Removing one shader lets the
 *   others' latency hide better, and the fixed costs — vertex processing, the
 *   MSAA resolve, the post chain — are in every column.
 * · `allScene` neuters every scene material at once. What is left is the floor:
 *   vertex work, the resolve, the shaft march and System 7's chain. If that
 *   floor is large, no amount of shader work reaches the target and the answer
 *   is resolution.
 *
 * The measurement method — paused loop, `readPixels` fence, interleaved blocks,
 * median of seven — is bench.mjs's, for the reasons documented there.
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
  { name: 'wall_lit', d: 46, yaw: 72, pitch: 12 },
];

process.env.RENDER_GPU = '1';
const { serve, LAUNCH_ARGS } = await import('./harness.mjs');

try {
  const lock = new URL('../.renderlock', import.meta.url);
  if (fs.existsSync(lock)) {
    console.log(`\n  ⚠ a capture is running (pid ${fs.readFileSync(lock, 'utf8').trim()}).`);
    console.log('    Same four-core budget, so these figures will be pessimistic.');
  }
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
  out.software = /swiftshader|llvmpipe|software|basic render/i.test(adapter);
  if (!JSON_OUT) {
    console.log(`\n  ${W}x${H}`);
    console.log(`  ${adapter}`);
    if (out.software) console.log('\n  ⚠ software rasteriser — these numbers mean nothing.');
  }

  const groups = await page.evaluate(() => {
    /* Classification, once, so the same sets are used at every viewpoint.
       Names come from the modules that build the meshes; the clast scatter is
       the only large population with no names on it, so it is what is left. */
    const g = window.__game, scene = g._scene;
    const buckets = {};
    const put = (k, o) => { (buckets[k] = buckets[k] || []).push(o); };
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      const n = o.name || '';
      if (n === 'terrain') put('ground', o);
      else if (n === 'sky') put('sky', o);
      else if (/^(wall|apron|butte|talus)/.test(n)) put('rock', o);
      else if (/^farridge/.test(n)) put('far', o);
      else if (/^(veg-|juniper-)/.test(n)) put('veg', o);
      else if (/^(dust|saltation)/.test(n)) put('particles', o);
      else if (o.isInstancedMesh) put('clasts', o);
      else put('other', o);
    });
    window.__fc = { buckets };
    const rep = {};
    for (const k of Object.keys(buckets)) {
      rep[k] = { meshes: buckets[k].length, names: buckets[k].map(o => o.name || '(unnamed)').slice(0, 4) };
    }
    return rep;
  });
  out.groups = groups;
  if (!JSON_OUT) {
    console.log('\n  ── groups ──');
    for (const [k, v] of Object.entries(groups)) {
      console.log(`  ${k.padEnd(10)} ${String(v.meshes).padStart(4)} meshes   ${v.names.join(', ')}`);
    }
  }

  const measure = (view) => page.evaluate(async ([v, reps, blocks]) => {
    const g = window.__game;
    const r = g.renderer;
    const gl = r.getContext();
    const atmo = g._atmo, post = g._post;
    const buckets = window.__fc.buckets;

    g.setPaused(true);
    g.walkTo(v.d);
    g.lookAt(v.yaw, v.pitch);

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
    const frame = () => g.renderOnce();

    /* ---- the shader ablation ----
       Splice an early return into the top of main. The material keeps its
       uniforms, its blending, its depth state and its vertex program; only the
       per-pixel arithmetic goes. customProgramCacheKey is extended so the two
       variants do not share a compiled program, and needsUpdate forces the
       lookup to run again. */
    function setCheap(mat, on) {
      if (!mat || !!mat.__cheap === !!on) return;
      if (!('__savedOBC' in mat)) {
        mat.__savedOBC = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile')
          ? mat.onBeforeCompile : null;
        mat.__savedKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey')
          ? mat.customProgramCacheKey : null;
        mat.customProgramCacheKey = function () {
          const base = mat.__savedKey ? mat.__savedKey.call(this) : '';
          return base + (mat.__cheap ? '|fc-cheap' : '');
        };
      }
      mat.__cheap = !!on;
      if (on) {
        mat.onBeforeCompile = function (shader, renderer) {
          if (mat.__savedOBC) mat.__savedOBC.call(this, shader, renderer);
          const src = shader.fragmentShader;
          /* Every material in this project compiles as GLSL ES 1.00, so
             gl_FragColor is the write. Detect an explicit out variable anyway
             rather than assume it, because being wrong here fails to link and
             the frame silently draws nothing — the exact failure CONTRACT.md
             spends a section on. */
          const m = src.match(/\bout\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+(\w+)\s*;/);
          const dst = m ? m[1] : 'gl_FragColor';
          shader.fragmentShader = src.replace(/void\s+main\s*\(\s*\)\s*\{/,
            `void main() {\n  ${dst} = vec4(0.35, 0.26, 0.20, 1.0);\n  return;\n`);
        };
      } else if (mat.__savedOBC) {
        mat.onBeforeCompile = mat.__savedOBC;
      } else {
        delete mat.onBeforeCompile;
      }
      mat.needsUpdate = true;
    }
    const forGroup = (keys, on) => {
      for (const k of keys) for (const o of (buckets[k] || [])) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) setCheap(m, on);
      }
    };

    const sceneKeys = Object.keys(buckets);
    const shaftQ = 2;
    const postLevel = post ? post.level : null;
    const postSamples = post && post.samples ? post.samples : 0;

    const variants = {
      full: { on: () => {}, off: () => {} },
      ground: { on: () => forGroup(['ground'], 1), off: () => forGroup(['ground'], 0) },
      rock: { on: () => forGroup(['rock'], 1), off: () => forGroup(['rock'], 0) },
      sky: { on: () => forGroup(['sky'], 1), off: () => forGroup(['sky'], 0) },
      clasts: { on: () => forGroup(['clasts'], 1), off: () => forGroup(['clasts'], 0) },
      veg: { on: () => forGroup(['veg'], 1), off: () => forGroup(['veg'], 0) },
      parts: { on: () => forGroup(['particles'], 1), off: () => forGroup(['particles'], 0) },
      allScene: { on: () => forGroup(sceneKeys, 1), off: () => forGroup(sceneKeys, 0) },
      /* Not a shader ablation: the marched in-scatter is its own full-screen
         pass at half resolution with a 28-step loop. Zero is not a shippable
         setting — it removes a subtractive term and the canyon gets brighter —
         but it is a legitimate thing to price. */
      shafts: {
        on: () => { if (atmo.setShaftQuality) atmo.setShaftQuality(0); },
        off: () => { if (atmo.setShaftQuality) atmo.setShaftQuality(shaftQ); },
      },
      /* The multisampled half-float target the whole scene is drawn into. */
      msaa: {
        on: () => { if (post && post.setSamples) post.setSamples(0); },
        off: () => { if (post && post.setSamples) post.setSamples(postSamples); },
      },
      postopt: {
        on: () => { if (post) post.setLevel({ bloom: 0, dofTaps: 0, flare: 0 }); },
        off: () => { if (post) post.setLevel(postLevel); },
      },
      res85: {
        on: () => { if (g.perf) g.perf.setScale(0.85); },
        off: () => { if (g.perf) g.perf.setScale(0); },
      },
      res70: {
        on: () => { if (g.perf) g.perf.setScale(0.70); },
        off: () => { if (g.perf) g.perf.setScale(0); },
      },
      res58: {
        on: () => { if (g.perf) g.perf.setScale(0.58); },
        off: () => { if (g.perf) g.perf.setScale(0); },
      },
    };

    const names = Object.keys(variants);
    const acc = {}; for (const n of names) acc[n] = [];

    time(frame, 12);
    for (let b = 0; b < blocks; b++) {
      for (const n of names) {
        const V = variants[n];
        V.on();
        /* One untimed frame after a state change, so a shader recompile or a
           render-target reallocation is not charged to the first block. */
        frame();
        acc[n].push(time(frame, reps));
        V.off();
        frame();
      }
    }

    frame();
    const info = g.info();
    g.setPaused(false);
    const res = { view: v.name, info };
    for (const n of names) res[n] = med(acc[n]);
    return res;
  }, [view, REPS, BLOCKS]);

  const cols = ['full', 'ground', 'rock', 'sky', 'clasts', 'veg', 'parts', 'allScene',
    'shafts', 'msaa', 'postopt', 'res85', 'res70', 'res58'];

  if (!JSON_OUT) {
    console.log('\n  ── fragment cost by shader, milliseconds, median of ' +
      BLOCKS + ' blocks of ' + REPS + ' ──');
    console.log('  each column is the frame with that one thing neutered; the delta from');
    console.log('  `full` is what it costs.\n');
    console.log('  view      ' + cols.map(c => c.padStart(8)).join(''));
  }
  for (const v of VIEWS) {
    const r = await measure(v);
    out.views[v.name] = r;
    if (!JSON_OUT) {
      console.log('  ' + v.name.padEnd(10) + cols.map(c => r[c].toFixed(2).padStart(8)).join(''));
      console.log('  ' + ' '.repeat(10) + cols.map(c =>
        (c === 'full' ? '' : '-' + (r.full - r[c]).toFixed(2)).padStart(8)).join(''));
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
  console.error('\n✗ fillcost failed:', e && e.message || e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  srv.close();
}

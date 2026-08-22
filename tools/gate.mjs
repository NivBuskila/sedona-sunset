/* The pre-delivery gate. One command that refuses to bless a build that is not
 * shippable, and exits non-zero when it refuses.
 *
 *   node tools/gate.mjs                 gate the tree as it stands
 *   node tools/gate.mjs --allow-dirty   gate the working copy, uncommitted files and all
 *   node tools/gate.mjs --bless         rewrite tools/gate.ref.json from this build
 *   node tools/gate.mjs --injure        prove every render check by breaking the page
 *
 * ── why this exists ───────────────────────────────────────────────────────
 *
 * Three times in one night this tree rendered something that was not a
 * photograph of Sedona, and each one got past everything the project had:
 *
 *   - An undeclared uniform in `rock.js` made every rock program fail to link,
 *     so the walls, both aprons and all ten buttes drew *nothing*. A colour
 *     probe then measured the sky standing behind the missing wall and reported
 *     sunlit sandstone at hue -147 degrees with a one-degree spread. The page
 *     error was in the capture manifest the whole time; nobody read it.
 *   - A debug line painted the ground white. Zero console errors, zero
 *     warnings, shader compiled perfectly. Nothing in the project could see it.
 *   - An unclosed comment in `terrain.js` blew the wash floor near-white and
 *     cost two agents their measurements.
 *
 * Two of those three are invisible to every static check, because the code is
 * valid and the shader is valid and the *picture* is wrong. So the core of this
 * tool is a picture measured against what a picture of this scene has to look
 * like, and the two broken states are the calibration: they read `groundAvg`
 * 155.8 and 124.5 against a golden-hour frame that sits in the sixties.
 *
 * ── the shape of it ───────────────────────────────────────────────────────
 *
 * Two layers, and the distinction is the whole design.
 *
 *   FLOOR   Absolute limits on what this scene can physically be. Hard-coded
 *           here, never derived from a build, and `--bless` cannot move them.
 *           A build that fails one of these is broken, not different. This is
 *           the layer that catches tonight's three.
 *   DRIFT   Bands around a reference taken from a known-good build, in
 *           `tools/gate.ref.json`. Catches the slow regression that is still
 *           inside the physical limits. `--bless` rewrites these, and only if
 *           every FLOOR check passes first — you cannot bless a white desert.
 *
 * ── the rule this tool is held to hardest ─────────────────────────────────
 *
 * Four instruments in this project have printed a confident number about
 * nothing. CONTRACT.md's rule is that a tool which measures nothing must not
 * print a number and must exit non-zero, and a gate is the last place that may
 * be got wrong — a gate that passes because it measured no pixels is worse than
 * no gate, because it is trusted. So every measurement is checked for being
 * finite and for having a population before it is compared to anything, the
 * expected number of views is asserted, the views are required to have produced
 * *different* frames from each other, and `probe()` is called twice per view and
 * required to agree. If any of that fails the verdict is `NO MEASUREMENT` and
 * nothing else is reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './harness.mjs';
import { settle } from './settle.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = path.join(DIR, 'tools', 'gate.ref.json');

const args = process.argv.slice(2);
const FLAGS = ['--allow-dirty', '--bless', '--injure', '--w', '--h'];
for (let i = 0; i < args.length; i++) {
  if (!FLAGS.includes(args[i])) {
    console.error(`gate: unknown argument "${args[i]}"\n  known: ${FLAGS.join(' ')}`);
    process.exit(2);
  }
  if (args[i] === '--w' || args[i] === '--h') i++;
}
const has = (f) => args.includes(f);
const numArg = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : +args[i + 1]; };
const ALLOW_DIRTY = has('--allow-dirty');
const BLESS = has('--bless');
const INJURE = has('--injure');
const W = numArg('--w', 1024), H = numArg('--h', 576);

/* Pinned tier, so two runs of the gate measure the same renderer. The adaptive
   governor is a moving target by design and a reference band cannot be drawn
   around one. */
const HASH = 'high';

/* ── the framings the gate reads ───────────────────────────────────────────
 *
 * Five, chosen for what each one can *fail* rather than for being pretty.
 * `floor` is nearly all wash floor at a steep pitch, which is the framing the
 * white-ground failures would have screamed in. `up` and `gap` look up the wash
 * into the sun and carry the sky/ground relationship. `lit` and `shade` are the
 * two wall aspects, which is where a rock program that failed to link leaves a
 * hole. `far` is the last third of the walk, which for most of this project's
 * life no capture visited at all. */
const VIEWS = [
  { name: 'floor', d: 30,  yaw: 10,   pitch: -38 },
  { name: 'up',    d: 46,  yaw: 0,    pitch: 0 },
  { name: 'lit',   d: 46,  yaw: 72,   pitch: 12 },
  { name: 'shade', d: 46,  yaw: -104, pitch: 10 },
  { name: 'gap',   d: 120, yaw: 0,    pitch: 6 },
  { name: 'far',   d: 320, yaw: 0,    pitch: 4 },
];

/* ── FLOOR: what this scene physically is ──────────────────────────────────
 *
 * **These are empirical bounds, not bounds computed from solar geometry, and the
 * distinction is load-bearing.** An earlier version of this comment justified
 * them as "what a dry wash at an eleven-degree sun can physically be", which
 * was wrong in a specific and dangerous way: the sun has shipped at 15° since
 * `b775e33` and every number in this file was measured after that, so the bounds
 * were right and the reason given for them was not. A bound whose stated
 * derivation is a formula invites a future reader to re-run the formula and move
 * the bound. Nobody can re-derive these from an angle, because they never came
 * from one.
 *
 * Each bound has one of two provenances, and it is named:
 *
 *   MEASURED  read off the shipped scene across the six framings below. The
 *             blessed reference in `tools/gate.ref.json` is that measurement.
 *   FAILURE   set from a state this project actually shipped past itself, so
 *             the bound is on the wrong side of a known defect rather than on
 *             the comfortable side of a healthy build.
 *
 * FAILURE bounds are the only ones the sun elevation could touch, because the
 * two white-desert readings of 124.5 and 155.8 may predate the move to 15°.
 * They survive it, and in the safe direction: a higher sun puts more irradiance
 * on a horizontal floor, `sin 15° / sin 11°` being about 1.36, so the same
 * failure at 15° reads *brighter* than it did and sits further outside the
 * ceiling, not nearer it. The healthy side of the same bound is measured at 15°
 * directly. Both sides check out, which is why nothing here moved.
 *
 * `MEASURED_AT_SUN_DEG` below turns this from a comment into a check. If the sun
 * moves again the gate refuses and says to re-derive, so the next person to read
 * this cannot be misled by it the way the audit caught me misleading them. */

/* The sun the bounds and the reference were measured under. Not an input to any
   of them — a record of the scene they describe, checked so it cannot go stale
   silently. */
const MEASURED_AT_SUN_DEG = 15.0;
const FLOOR = {
  /* MEASURED below, FAILURE above. Across the six framings on a good build the
     ground runs 23.5 to 90.0, the top of it being `floor` — a steep down-pitch
     filling the frame with sunlit wash floor, which is the brightest ground this
     scene can produce. The two white-desert states read 124.5 and 155.8.
     The margin here is thinner than the others and it is deliberately not the
     primary detector: an indirect-light lift is landing while this is written
     and it moves ground values up, so a ceiling tight enough to be a good
     detector would also be tight enough to cry wolf. `floorRG` and
     `skyOverGround` below are the checks doing that work, and they are
     exposure-invariant, so they do not have this problem. */
  groundAvg: [6, 118],
  /* MEASURED. The bottom third of the frame is wash floor in every framing
     above. Measured 26.4 to 99.6. */
  floorL: [6, 122],
  /* MEASURED, and **the most valuable single number in this file**. It does not
     care what the exposure is doing: white is achromatic, so R/G collapses
     toward 1.0 whether the frame got brighter or not, and a debug line painting
     the ground white is caught by this on its own with no reference build and no
     console error. Measured 1.557 to 1.831.
     This is also the bound the sun elevation has least purchase on of anything
     here, which is worth saying while re-deriving: raising the sun changes how
     much light lands on the floor and barely touches the ratio between the
     channels reflected off it. */
  floorRG: [1.20, 2.40],
  /* MEASURED. Something has to be darker than something else; a frame with no
     spread is a frame of one flat thing, which is every version of this
     failure. Measured 88 to 207. */
  contrast: [40, 250],           // p99 - median
  /* MEASURED. Blown highlights are the sun's aureole and a few specular grains,
     not a surface. Measured 0.00-0.36%. Crushed blacks were a real defect here
     and are being fixed upward, so that ceiling is generous rather than tight;
     measured 0.00-1.08%. */
  whiteFrac: [0, 0.10],
  blackFrac: [0, 0.32],
  /* FAILURE, and the second exposure-invariant check. Sky over ground measures
     2.74 to 7.59 across the framings that contain sky, whose skies run 139.9 to
     189.0. The floor of 2.0 is what refuses a white desert on this route: a
     ground at 124.5 under a sky at 190 reads 1.53. My first instinct was 1.15 —
     safely below anything observed — and it would have let *both* known failures
     through, which is the whole reason this bound is set from the failures and
     labelled as such. */
  skyOverGround: [2.0, 14.0],
  /* MEASURED. Geometry being drawn at all. Note what this does *not* catch: hiding all
     eighteen rock meshes at the `floor` framing changed nothing here, because
     at a steep down-pitch the rock is mostly outside the frustum anyway. That
     is what `rockTris` is for — see below. Measured 1647k to 4008k. */
  triangles: [1_400_000, 6_500_000],
  calls: [20, 150],
  /* MEASURED. Rock in the scene, asked of the scene graph rather than of the frame, so it
     is the same answer from every framing. The undeclared-uniform failure took
     the walls, both aprons and all ten buttes out of every view; nothing that
     looks at one framing's triangle count can see that reliably, and a colour
     probe pointed at the hole measured the sky and believed it.
     Measured 569k. The floor is set low, at "the rock is essentially gone",
     because the precise detector for a partial loss is the drift band around
     the reference and a hard bound tight enough to catch a partial loss would
     also refuse a legitimate change to wall tessellation. Hiding all eighteen
     meshes reads 0. */
  rockTris: [200_000, 8_000_000],
};

/* ── DRIFT: tolerance around the reference ─────────────────────────────────
 *
 * Wide on purpose. Several systems are still moving the look — an indirect
 * light lift, ground self-shadowing, cliff work — and a gate that cries wolf
 * every time a tuning lands is a gate that gets bypassed, which is worse than
 * not having one. These are sized to catch a *failure*, not a tuning. */
const DRIFT = {
  groundAvg: { rel: 0.30, abs: 14 },
  skyAvg:    { rel: 0.20, abs: 12 },
  median:    { rel: 0.35, abs: 14 },
  p99:       { rel: 0.15, abs: 12 },
  floorL:    { rel: 0.30, abs: 14 },
  floorRG:   { rel: 0.14, abs: 0.10 },
  triangles: { rel: 0.25, abs: 200_000 },
  rockTris:  { rel: 0.25, abs: 100_000 },
};

/* ── verdict plumbing ──────────────────────────────────────────────────────
 *
 * `fail` is a refusal. `blank` is worse: it means the gate could not measure,
 * and it suppresses every number so nothing downstream can quote one. */
const fails = [], blanks = [], warns = [];
const fail = (what, why) => fails.push(`${what}: ${why}`);
const blank = (why) => blanks.push(why);

function checkRange(view, key, value, [lo, hi], unit = '') {
  if (!Number.isFinite(value)) { blank(`${view}.${key} is ${value}`); return false; }
  if (value < lo || value > hi) {
    fail(`${view}.${key}`, `${fmt(value)}${unit} outside the floor [${fmt(lo)}, ${fmt(hi)}]`);
    return false;
  }
  return true;
}

const fmt = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k'
  : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3));

/* ── preflight: the cheap checks, and the tree ─────────────────────────────
 *
 * All of these run without a browser and most run without a render, so a build
 * that cannot pass them never costs a page load. They are the project's
 * existing instruments, driven from one place rather than from four terminals —
 * which is the actual reason a delivery ships broken: not that the tool did not
 * exist, but that nobody ran it. */
async function preflight() {
  console.log('preflight\n');

  /* The sun the FLOOR bounds and the reference were measured under. An audit
     caught this file justifying its bounds by a sun elevation four degrees off
     the shipped one; the bounds were fine and the reason given for them was not,
     and the reason is what gets quoted later to justify moving them. A comment
     cannot notice going stale, so this does. */
  try {
    const { SUN_EL_DEG } = await import('../src/atmos.js');
    if (Math.abs(SUN_EL_DEG - MEASURED_AT_SUN_DEG) > 0.01) {
      fail('sun elevation', `the scene ships at ${SUN_EL_DEG}° and the FLOOR bounds and the ` +
        `reference were measured at ${MEASURED_AT_SUN_DEG}°.\n` +
        `           The bounds are empirical, so this is not automatically a defect — but it means ` +
        `nobody has\n           looked. Re-measure, confirm or adjust the bounds, update ` +
        `MEASURED_AT_SUN_DEG, and re-bless.`);
      console.log(`  FAIL  sun elevation        ships ${SUN_EL_DEG}°, bounds measured at ${MEASURED_AT_SUN_DEG}°`);
    } else {
      console.log(`  ok    sun elevation        ${SUN_EL_DEG}°, matching the bounds and the reference`);
    }
  } catch (e) {
    blank(`could not read SUN_EL_DEG from src/atmos.js: ${e.message}`);
  }

  /* The tree first, because everything below measures the working copy and a
     working copy is not what ships. This is the check that answers "is the tree
     clean" — the question this whole tool exists to be able to ask. */
  let dirty = '';
  try {
    dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'index.html', 'package.json'],
      { cwd: DIR, encoding: 'utf8' }).trim();
  } catch (e) {
    blank(`git status failed: ${e.message}`);
  }
  if (dirty) {
    const files = dirty.split('\n').map((l) => l.trim()).join('\n           ');
    if (ALLOW_DIRTY) {
      warns.push(`the working copy is not clean — measuring uncommitted source:\n           ${files}`);
      console.log(`  warn  clean tree            ${dirty.split('\n').length} uncommitted, --allow-dirty given`);
    } else {
      fail('clean tree', `uncommitted source, so this is not the build that ships:\n           ${files}` +
        '\n           commit it, or pass --allow-dirty to gate the working copy anyway');
      console.log(`  FAIL  clean tree            ${dirty.split('\n').length} uncommitted source file(s)`);
    }
  } else {
    console.log('  ok    clean tree            src, index.html and package.json all committed');
  }

  /* Every source file parses. Four outages tonight began as somebody's
     half-written file, and this answers in a second whose it is. */
  const bad = [];
  for (const f of fs.readdirSync(path.join(DIR, 'src')).filter((f) => f.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', path.join('src', f)], { cwd: DIR, encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${(r.stderr || '').split('\n').find((l) => l.includes('Error')) || 'parse error'}`);
  }
  if (bad.length) { fail('node --check', bad.join('\n           ')); console.log(`  FAIL  node --check          ${bad.length} file(s)`); }
  else console.log('  ok    node --check          every src/*.js parses');

  /* The project's own instruments. Each is the answer to a specific outage that
     has already happened here, which is why the gate runs all of them rather
     than choosing. */
  for (const [tool, what] of [
    ['tools/_p7pre.mjs', 'every module evaluates'],
    ['tools/glslcheck.mjs', 'shader sources are well formed'],
    ['tools/_bootprobe.mjs', 'the scene builds'],
    ['tools/_walktest.mjs', 'the corridor is still not felt'],
  ]) {
    const r = spawnSync(process.execPath, [tool], { cwd: DIR, encoding: 'utf8' });
    const name = path.basename(tool);
    if (r.status !== 0) {
      const out = ((r.stdout || '') + (r.stderr || '')).split('\n')
        .filter((l) => /FAIL|Error|error/.test(l)).slice(0, 6).join('\n           ');
      fail(name, `exit ${r.status}\n           ${out || '(no output)'}`);
      console.log(`  FAIL  ${name.padEnd(20)} ${what}`);
    } else {
      console.log(`  ok    ${name.padEnd(20)} ${what}`);
    }
  }
  console.log('');
}

/* ── the in-page measurement ───────────────────────────────────────────────
 *
 * One function, sent whole, so the frame that is measured is the frame the
 * harness would capture: `setPaused(true)`, `renderOnce()`, read. It takes its
 * own pixels rather than only trusting `probe()` for two reasons. The contract
 * probe gives the sky/ground split, which is the thing a hand-rolled row test
 * would get wrong; but it gives no chroma, and chroma is the one measure that
 * catches a white ground without caring what the exposure is doing.
 */
const MEASURE = () => {
  const g = window.__game;
  g.setPaused(true);
  g.renderOnce();
  const gl = g.renderer.getContext();
  const cv = g.renderer.domElement;
  const w = cv.width, h = cv.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const hist = new Uint32Array(256);
  let white = 0, black = 0, n = 0;
  /* readPixels is bottom-up, so rows 0..h/3 are the bottom third of the screen
     — wash floor in every framing the gate uses. */
  const floorTop = Math.max(1, (h / 3) | 0);
  let fr = 0, fg = 0, fb = 0, fl = 0, fn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      const l = (r * 0.2126 + gg * 0.7152 + b * 0.0722) | 0;
      hist[l]++; n++;
      if (r >= 250 && gg >= 250 && b >= 250) white++;
      if (r <= 2 && gg <= 2 && b <= 2) black++;
      if (y < floorTop) { fr += r; fg += gg; fb += b; fl += l; fn++; }
    }
  }
  const pct = (p) => { let a = 0; const want = n * p; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= want) return i; } return 255; };

  /* Rock present in the scene graph, counted in triangles over the meshes
     src/rock.js names. Framing-independent on purpose: this is the check that
     the walls exist, and the failure it exists for made them exist in the file
     and draw nothing on the screen. */
  let rockTris = 0, rockMeshes = 0;
  g._scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !/^(wall|apron|butte|talus)/i.test(o.name || '')) return;
    let vis = o;
    while (vis) { if (!vis.visible) return; vis = vis.parent; }
    const gm = o.geometry;
    if (!gm) return;
    const tris = (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
    rockTris += tris * (o.isInstancedMesh ? o.count : 1);
    rockMeshes++;
  });

  /* Two probes, and they must agree. A probe that is not a function of the
     frame would pass every band forever. */
  const probe1 = g.probe();
  g.renderOnce();
  const probe2 = g.probe();
  const info = g.info();

  /* Did every program actually link? This is the missing-rock failure, asked of
     the driver instead of inferred from a colour. `renderer.info.programs`
     holds one entry per compiled material variant. */
  const progs = g.renderer.info.programs || [];
  let linked = 0, unlinked = [];
  for (const p of progs) {
    const ok = p.program ? gl.getProgramParameter(p.program, gl.LINK_STATUS) : null;
    if (ok === false) unlinked.push(p.cacheKey ? String(p.cacheKey).slice(0, 60) : 'unnamed');
    else if (ok) linked++;
  }

  /* Non-finite anything in the scene graph. A NaN vertex collapses a bounding
     sphere and a NaN uniform poisons a whole material, and both draw as
     something rather than as an error. */
  const nan = [];
  const finite = (v) => typeof v !== 'number' || Number.isFinite(v);
  g._scene.traverse((o) => {
    if (!o.visible) return;
    const gm = o.geometry;
    if (gm) {
      if (!gm.boundingSphere) gm.computeBoundingSphere();
      const bs = gm.boundingSphere;
      if (bs && (!Number.isFinite(bs.radius) || !Number.isFinite(bs.center.x) ||
                 !Number.isFinite(bs.center.y) || !Number.isFinite(bs.center.z))) {
        nan.push(`${o.name || o.type}.boundingSphere`);
      }
    }
    for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) {
      const u = (m.userData && m.userData.uniforms) || m.uniforms;
      if (!u) continue;
      for (const k in u) {
        const v = u[k] && u[k].value;
        if (v == null) continue;
        if (!finite(v)) { nan.push(`${o.name || o.type}.${k}`); continue; }
        if (typeof v === 'object') {
          for (const c of ['x', 'y', 'z', 'w', 'r', 'g', 'b']) {
            if (c in v && !Number.isFinite(v[c])) { nan.push(`${o.name || o.type}.${k}.${c}`); break; }
          }
        }
      }
    }
  });

  g.setPaused(false);
  return {
    w, h, pixels: n,
    median: pct(0.5), p99: pct(0.99),
    rockTris, rockMeshes,
    whiteFrac: white / n, blackFrac: black / n,
    floorL: fl / fn, floorRG: fg ? fr / fg : NaN, floorBG: fg ? fb / fg : NaN, floorN: fn,
    probe: probe1,
    probeStable: JSON.stringify(probe1) === JSON.stringify(probe2),
    triangles: info.triangles, calls: info.calls, textures: info.textures,
    programs: progs.length, linked, unlinked,
    nan: nan.slice(0, 8),
    body: [...document.body.children].map((e) => e.tagName),
  };
};

/* ── injuries ──────────────────────────────────────────────────────────────
 *
 * A gate nobody has seen fail is not a gate, and this project has paid for that
 * lesson twice. Each entry breaks the page in the shape of a real failure,
 * names the check that must catch it, and puts it back. They run inside one
 * page load because a boot is forty seconds and six boots is not a thing anyone
 * will wait for before a delivery.
 *
 * These reproduce the *observable* of each failure, not its cause — the point
 * is to prove the check fires, and a check that fires on a white ground fires
 * whether the white came from a debug line or from here.
 *
 * **Each injury names the framing it is visible in, and that turned out to be
 * the load-bearing part.** Run at `floor` alone, hiding all eighteen rock
 * meshes fired nothing at all: at a steep down-pitch the rock is largely
 * outside the frustum, so the triangle count barely moves and the ground is
 * terrain either way. The check was not weak — it was being asked from a
 * viewpoint that could not see the answer. That is the same mistake as
 * measuring lit sandstone in a rectangle with no sandstone in it, which this
 * project has already paid for once, and it is why the fix was both a new
 * framing-independent check (`rockTris`) and a per-injury viewpoint.
 */
const INJURIES = [
  ['white ground', 'floor', 'floorRG / groundAvg / floorL', () => {
    const g = window.__game;
    const t = g._scene.getObjectByName('terrain') ||
      g._scene.children.find((c) => c.isMesh && c.geometry && c.geometry.attributes.position.count > 100000);
    window.__hurt = { obj: t, mat: t.material };
    t.material = new g._three.MeshBasicMaterial({ color: 0xffffff, fog: false });
  }, () => { window.__hurt.obj.material = window.__hurt.mat; }],

  /* Asked from `shade`, a wall face with no sky in it at all. Remove the wall
     and the framing becomes sky, which is exactly what the real failure did and
     exactly what the colour probe then measured. */
  ['rock missing', 'shade', 'rockTris / groundAvg / skyOverGround', () => {
    const g = window.__game;
    window.__hurt = { hid: [] };
    g._scene.traverse((o) => {
      if (o.isMesh && o.visible && /^(wall|apron|butte|talus)/i.test(o.name || '')) {
        o.visible = false; window.__hurt.hid.push(o);
      }
    });
    return `${window.__hurt.hid.length} meshes hidden`;
  }, () => { for (const o of window.__hurt.hid) o.visible = true; }],

  ['black frame', 'floor', 'floorL / contrast / groundAvg', () => {
    const g = window.__game;
    window.__hurt = { exp: g.renderer.toneMappingExposure };
    g.renderer.toneMappingExposure = 0;
  }, () => { window.__game.renderer.toneMappingExposure = window.__hurt.exp; }],

  ['NaN uniform', 'up', 'nan', () => {
    const g = window.__game;
    let hit = null;
    g._scene.traverse((o) => {
      if (hit || !o.visible || !o.material) return;
      const u = (o.material.userData && o.material.userData.uniforms) || o.material.uniforms;
      if (!u) return;
      for (const k in u) {
        if (typeof (u[k] && u[k].value) === 'number') { hit = { u, k, was: u[k].value }; break; }
      }
    });
    if (!hit) return 'no scalar uniform found';
    window.__hurt = hit;
    hit.u[hit.k].value = NaN;
    return `${hit.k} := NaN`;
  }, () => { const h = window.__hurt; if (h && h.u) h.u[h.k].value = h.was; }],

  ['HUD in the frame', 'up', 'body', () => {
    const d = document.createElement('div');
    d.id = '__hurt_hud'; d.textContent = 'fps 137';
    document.body.appendChild(d);
  }, () => { const d = document.getElementById('__hurt_hud'); if (d) d.remove(); }],

  /* Failure #1, reproduced by its cause rather than its symptom: an identifier
     the shader never declares, injected into a wall material and recompiled.
     Asked from `lit`, a wall face, so a miss could not hide behind a frame that
     still looked right.
     **Last on purpose, and it is the only one that is.** Restoring
     `onBeforeCompile` and setting `needsUpdate` compiles a good program but the
     failed one stays in `renderer.info.programs`, so `programs` kept firing on
     whichever injury ran after it — a false positive in this table, reported
     against an injury that had nothing to do with shaders. Nothing that follows
     it can be trusted, so nothing follows it. */
  ['undeclared uniform', 'lit', 'programs / page errors', () => {
    const g = window.__game;
    let t = null;
    g._scene.traverse((o) => { if (!t && o.isMesh && /^wall/.test(o.name || '')) t = o; });
    if (!t) return 'no wall mesh found';
    window.__hurt = { m: t.material, obc: t.material.onBeforeCompile };
    t.material.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(/void main\(\s*\)\s*\{/,
        'void main() {\n  float _hurt = uThisWasNeverDeclared;');
    };
    t.material.needsUpdate = true;
    return `${t.name} fragment shader`;
  }, () => {
    const h = window.__hurt;
    h.m.onBeforeCompile = h.obc; h.m.needsUpdate = true;
  }],
];

/* ── run ───────────────────────────────────────────────────────────────────*/

await preflight();

/* If the preflight already refused, stop here. Everything below measures a page,
   and there is no sense spending ninety seconds photographing a build that has
   already been established as not the one that ships — which is exactly the
   ninety seconds somebody will not spend at five to twelve. */
if (fails.length) {
  console.error(`\n  ${fails.length} REFUSAL${fails.length > 1 ? 'S' : ''} in preflight, ` +
    `so the page was never loaded:`);
  for (const f of fails) console.error(`    · ${f}`);
  console.error('\nGATE: FAILED — do not deliver this build.\n');
  process.exit(1);
}

const ref = fs.existsSync(REF) ? JSON.parse(fs.readFileSync(REF, 'utf8')) : null;
if (!ref && !BLESS) {
  warns.push(`no reference at tools/gate.ref.json — drift checks skipped. ` +
             `Run "node tools/gate.mjs --bless" on a build you have looked at.`);
}

const measured = {};
let injuries = [];
/* How many page errors the build itself produced, fixed before any injury is
   allowed to add one. */
let errsBefore = Infinity;

await run({ width: W, height: H, waitReady: false, hash: HASH }, async ({ page, errs }) => {
  const t0 = Date.now();
  /* Boot is forty seconds of blocked main thread, so the wait has to be long.
     But `waitForFunction` alone waits the whole seven minutes even when the page
     threw at second forty-five and is never going to define `__game` — which is
     what it did the first time this gate met a broken tree, and seven minutes is
     a long time to spend learning something the console already knew. Watch both
     and stop on whichever happens. */
  let bootS = 0;
  for (;;) {
    if (await page.evaluate(() => !!window.__game).catch(() => false)) break;
    if (errs.length) {
      throw new Error(`the page threw during boot, after ${((Date.now() - t0) / 1000).toFixed(0)}s:\n  ` +
        [...new Set(errs)].slice(0, 4).join('\n  '));
    }
    if (Date.now() - t0 > 420_000) throw new Error('window.__game never appeared within 420s');
    await new Promise((r) => setTimeout(r, 500));
  }
  bootS = (Date.now() - t0) / 1000;
  await page.evaluate(() => window.__game.begin());
  console.log(`render checks   #${HASH}  ${W}x${H}  boot ${bootS.toFixed(0)}s\n`);

  /* One warmup so procedural textures and deferred geometry are resident. */
  await page.evaluate(() => new Promise((r) => {
    let n = 0; const tick = () => (++n < 180 ? requestAnimationFrame(tick) : r());
    requestAnimationFrame(tick);
  }));

  console.log('  view   median  p99   sky    gnd   floorL  R/G   white  black   tris  rockT  calls');
  for (const v of VIEWS) {
    await page.evaluate(([d, y, p]) => {
      window.__game.walkTo(d); window.__game.lookAt(y, p);
    }, [v.d, v.yaw, v.pitch]);
    const s = await settle(page, { minFrames: 60, maxMs: 8000 });
    const m = await page.evaluate(MEASURE);
    m.settle = s;
    measured[v.name] = m;
    console.log(`  ${v.name.padEnd(6)} ${String(m.median).padStart(6)} ${String(m.p99).padStart(4)} ` +
      `${m.probe.skyAvg.toFixed(1).padStart(6)} ${m.probe.groundAvg.toFixed(1).padStart(6)} ` +
      `${m.floorL.toFixed(1).padStart(7)} ${m.floorRG.toFixed(3).padStart(6)} ` +
      `${(m.whiteFrac * 100).toFixed(2).padStart(6)}% ${(m.blackFrac * 100).toFixed(2).padStart(5)}% ` +
      `${(m.triangles / 1000).toFixed(0).padStart(5)}k ${(m.rockTris / 1000).toFixed(0).padStart(5)}k ` +
      `${String(m.calls).padStart(5)}`);
  }

  if (INJURE) {
    console.log('\ninjuries — each must be refused by the check named\n');
    /* Some injuries are meant to log. Everything the page said *before* this
       point is the build's own, and only that counts toward the verdict —
       otherwise `--injure` could never report anything but failure and the mode
       would be useless for the thing it is for. */
    errsBefore = errs.length;
    for (const [name, viewName, expect, apply, revert] of INJURIES) {
      const v = VIEWS.find((x) => x.name === viewName);
      await page.evaluate(([d, y, p]) => {
        window.__game.walkTo(d); window.__game.lookAt(y, p);
      }, [v.d, v.yaw, v.pitch]);
      await settle(page, { minFrames: 60, maxMs: 8000 });
      const note = await page.evaluate(apply);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const errsAt = errs.length;
      const m = await page.evaluate(MEASURE);
      m.newErrs = errs.slice(errsAt);
      await page.evaluate(revert);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      injuries.push({ name, view: viewName, expect, note, m, base: measured[viewName] });
    }
  }

  measured._page = {
    errs: [...new Set(errs.slice(0, errsBefore))],
    bootS,
    body: await page.evaluate(() => [...document.body.children].map((e) => e.tagName)),
  };
});

if (!Object.keys(measured).length || !measured._page) {
  console.error('\ngate: the page never produced a measurement.\n' +
    '  NO MEASUREMENT — nothing above may be quoted, and this is a refusal.\n');
  process.exit(2);
}

/* ── the checks ────────────────────────────────────────────────────────────*/

/* Anti-empty-measurement, first, because everything below is meaningless
   without it. */
const names = VIEWS.map((v) => v.name);
const got = names.filter((n) => measured[n]);
if (got.length !== names.length) {
  blank(`${got.length} of ${names.length} framings measured (missing ${names.filter((n) => !measured[n]).join(', ')})`);
}
{
  const sigs = new Set(got.map((n) => `${measured[n].median}/${measured[n].p99}/${measured[n].probe.groundAvg}`));
  if (got.length > 1 && sigs.size < 2) {
    blank(`all ${got.length} framings measured the same numbers — the probe is not a function of the frame`);
  }
  for (const n of got) {
    const m = measured[n];
    if (!m.pixels || !m.floorN) blank(`${n}: read ${m.pixels} pixels, ${m.floorN} in the floor band`);
    if (!m.probeStable) fail(`${n}.probe`, 'two calls disagreed — walkTo/lookAt has not fully settled');
    if (!m.probe || !Number.isFinite(m.probe.groundAvg) || !Number.isFinite(m.probe.skyAvg)) {
      blank(`${n}: probe() returned ${JSON.stringify(m.probe)}`);
    }
  }
}

if (!blanks.length) {
  /* FLOOR, per framing. */
  for (const n of got) {
    const m = measured[n];
    checkRange(n, 'groundAvg', m.probe.groundAvg, FLOOR.groundAvg);
    checkRange(n, 'floorL', m.floorL, FLOOR.floorL);
    checkRange(n, 'floorRG', m.floorRG, FLOOR.floorRG);
    checkRange(n, 'contrast', m.p99 - m.median, FLOOR.contrast);
    checkRange(n, 'whiteFrac', m.whiteFrac, FLOOR.whiteFrac);
    checkRange(n, 'blackFrac', m.blackFrac, FLOOR.blackFrac);
    checkRange(n, 'triangles', m.triangles, FLOOR.triangles);
    checkRange(n, 'calls', m.calls, FLOOR.calls);
    checkRange(n, 'rockTris', m.rockTris, FLOOR.rockTris);
    if (!m.rockMeshes) fail(`${n}.rockTris`, 'no wall, apron, butte or talus mesh is in the visible scene');
    /* The sky is only in some framings, and a framing with no sky in it must
       not be silently passed as though it had one. */
    if (m.probe.skyAvg > 1) {
      checkRange(n, 'skyOverGround', m.probe.skyAvg / Math.max(1, m.probe.groundAvg), FLOOR.skyOverGround);
    }
    if (m.unlinked.length) fail(`${n}.programs`, `${m.unlinked.length} failed to link: ${m.unlinked.join(', ')}`);
    if (!m.linked) blank(`${n}: no linked programs found, so the link check measured nothing`);
    if (m.nan.length) fail(`${n}.nan`, `non-finite: ${m.nan.join(', ')}`);
  }
  /* At least one framing has to have had sky in it, or the whole
     sky-over-ground family measured nothing. */
  if (!got.some((n) => measured[n].probe.skyAvg > 1)) {
    blank('no framing contained sky, so the sky/ground relationship was never tested');
  }

  /* FLOOR, whole page. */
  const p = measured._page;
  if (p.errs.length) {
    fail('page errors', `${p.errs.length} logged — this is the check that was already in the manifest ` +
      `and went unread:\n           ${p.errs.slice(0, 6).join('\n           ')}`);
  }
  const bodyOk = p.body.length === 2 && p.body[0] === 'SCRIPT' && p.body[1] === 'CANVAS';
  if (!bodyOk) fail('document.body', `[${p.body.join(', ')}] — the shipped frame carries no HUD`);

  /* DRIFT. */
  if (ref) {
    for (const n of got) {
      const r = ref.views && ref.views[n];
      if (!r) { warns.push(`no reference for framing "${n}"`); continue; }
      const m = measured[n];
      const now = { groundAvg: m.probe.groundAvg, skyAvg: m.probe.skyAvg, median: m.median,
                    p99: m.p99, floorL: m.floorL, floorRG: m.floorRG,
                    triangles: m.triangles, rockTris: m.rockTris };
      for (const k in DRIFT) {
        if (!(k in r) || !Number.isFinite(r[k])) continue;
        const tol = Math.max(DRIFT[k].abs, Math.abs(r[k]) * DRIFT[k].rel);
        const d = now[k] - r[k];
        if (Math.abs(d) > tol) {
          fail(`${n}.${k}`, `${fmt(now[k])} against a reference of ${fmt(r[k])}, ` +
            `${d > 0 ? '+' : ''}${fmt(d)} outside a tolerance of ${fmt(tol)}` +
            ` — if this is intended, re-bless`);
        }
      }
    }
  }
}

/* ── injuries: report, and require each to have been refused ───────────────*/
if (INJURE) {
  console.log('');
  let unrefused = 0;
  for (const inj of injuries) {
    const m = inj.m;
    const saved = [fails.length, blanks.length];
    const probe = [];
    const c = (k, v, band) => { if (Number.isFinite(v) && (v < band[0] || v > band[1])) probe.push(k); };
    c('groundAvg', m.probe.groundAvg, FLOOR.groundAvg);
    c('floorL', m.floorL, FLOOR.floorL);
    c('floorRG', m.floorRG, FLOOR.floorRG);
    c('contrast', m.p99 - m.median, FLOOR.contrast);
    c('whiteFrac', m.whiteFrac, FLOOR.whiteFrac);
    c('blackFrac', m.blackFrac, FLOOR.blackFrac);
    c('triangles', m.triangles, FLOOR.triangles);
    c('rockTris', m.rockTris, FLOOR.rockTris);
    if (m.probe.skyAvg > 1) c('skyOverGround', m.probe.skyAvg / Math.max(1, m.probe.groundAvg), FLOOR.skyOverGround);
    if (m.nan.length) probe.push('nan');
    if (m.unlinked.length) probe.push('programs');
    if ((m.newErrs || []).length) probe.push('page errors');
    if (!m.rockMeshes) probe.push('rockMeshes');
    if (!(m.body.length === 2 && m.body[0] === 'SCRIPT' && m.body[1] === 'CANVAS')) probe.push('body');
    fails.length = saved[0]; blanks.length = saved[1];

    const ok = probe.length > 0;
    if (!ok) unrefused++;
    /* The healthy reading beside the injured one, so the margin each check is
       working with is visible rather than asserted. */
    const b = inj.base;
    const pair = (k, v, bv, dp = 1) =>
      `${k} ${Number(v).toFixed(dp)} (was ${Number(bv).toFixed(dp)})`;
    console.log(`  ${ok ? 'refused' : 'MISSED '}  ${inj.name.padEnd(18)} @${inj.view.padEnd(6)} ` +
      `want ${inj.expect.padEnd(34)} fired: ${probe.join(', ') || 'NOTHING'}`);
    console.log(`               ${inj.note ? inj.note + '  ' : ''}` +
      `${pair('gnd', m.probe.groundAvg, b.probe.groundAvg)}  ` +
      `${pair('R/G', m.floorRG, b.floorRG, 3)}  ` +
      `${pair('contrast', m.p99 - m.median, b.p99 - b.median, 0)}  ` +
      `${pair('rockTris', m.rockTris / 1000, b.rockTris / 1000, 0)}k`);
  }
  if (unrefused) fail('injuries', `${unrefused} deliberate breakage(s) were not refused — those checks do not work`);
}

/* ── bless ─────────────────────────────────────────────────────────────────*/
if (BLESS) {
  if (fails.length || blanks.length) {
    console.error('\ngate: refusing to bless — this build does not pass its own floor checks.\n');
  } else {
    const out = { blessed: new Date().toISOString(), hash: HASH, w: W, h: H,
                  sunElDeg: MEASURED_AT_SUN_DEG, views: {} };
    for (const n of got) {
      const m = measured[n];
      out.views[n] = {
        groundAvg: +m.probe.groundAvg.toFixed(1), skyAvg: +m.probe.skyAvg.toFixed(1),
        median: m.median, p99: m.p99,
        floorL: +m.floorL.toFixed(1), floorRG: +m.floorRG.toFixed(3),
        triangles: m.triangles, rockTris: m.rockTris,
      };
    }
    try {
      out.commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: DIR, encoding: 'utf8' }).trim();
    } catch { /* not fatal; the reference is still usable */ }
    fs.writeFileSync(REF, JSON.stringify(out, null, 2) + '\n');
    console.log(`\nblessed → tools/gate.ref.json  (${out.commit || 'no commit'})`);
  }
}

/* ── verdict ───────────────────────────────────────────────────────────────*/
console.log('');
for (const w of warns) console.log(`  warn  ${w}`);
if (blanks.length) {
  console.error('\n  NO MEASUREMENT — the gate could not measure, so it cannot pass:');
  for (const b of blanks) console.error(`    · ${b}`);
  console.error('\n  Nothing printed above may be quoted as a figure.');
  console.error('\nGATE: NO MEASUREMENT\n');
  process.exit(2);
}
if (fails.length) {
  console.error(`\n  ${fails.length} REFUSAL${fails.length > 1 ? 'S' : ''}:`);
  for (const f of fails) console.error(`    · ${f}`);
  console.error('\nGATE: FAILED — do not deliver this build.\n');
  process.exit(1);
}
console.log(`\nGATE: PASSED — ${got.length} framings, ${measured._page.errs.length} page errors, ` +
            `body [${measured._page.body.join(', ')}]${warns.length ? `, ${warns.length} warning(s)` : ''}\n`);

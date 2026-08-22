/* Does transmission close the hero crown's lit/shade split, and what does it cost?
 *
 *   node tools/herotrans.mjs
 *   node tools/herotrans.mjs --sweep 0:0:0,0.2:0:0,0.35:0:0.6 --width 2560 --height 1440
 *
 * The complaint is "a hard lit/shade split within each spray", and the crown
 * carries no transmission at all — `uTransAmt` and `uTransIso` are both zero by
 * default, from a deliberate choice made hours before a delivery. An internal
 * contrast of 8.9:1 against a real juniper's 2.4:1 is the size of gap a *missing*
 * term makes rather than a mistuned one, so the term is worth a round.
 *
 * Everything here is one page load. Sweeping uniforms in place is the only way to
 * get arms that differ by nothing else: `sky.js` moved between two captures
 * earlier today and made a before and an after into two afters, and three agents
 * lost measurements to files landing mid-pair. A rebuild per arm reopens that.
 *
 * POPULATIONS, quoted because five population errors landed in one night here:
 *
 *   crown   pixels whose coverage mask is set for `juniper-foliage`, in the
 *           graded frame. Masked the way tools/bole.mjs and tools/vegval.mjs
 *           mask: an emissive-white override on that mesh alone, alpha map kept
 *           so the cutout still cuts, atmosphere and both post chains off. Not a
 *           rectangle — a rectangle around this crown is 60% sandstone, and the
 *           first version of the contrast figure quoted below was taken on one
 *           with a g>=r filter standing in for the mask.
 *   rest    every unmasked pixel in the frame. A control: this term is gated to
 *           the crown's own material, so `rest` moving at all means the arm
 *           differs by something other than the uniform, and the sweep is void.
 *
 * The statistic for the split is crown p90/p10, because that is what a two-tone
 * population looks like from the outside: mass at the top, mass at the bottom,
 * and the ratio between them large. Hue and saturation are carried alongside
 * because `uTrans` is warm at (1.35, 1.12, 0.58) and the crown's 63.2 degree hue
 * is a settled, defended figure that a critic verified against the atlas to
 * within 1.1 degrees. A term that fixes the split by turning the crown orange has
 * not fixed anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from './harness.mjs';
import { byName } from './views.mjs';
import { encodeRGB } from './png.mjs';

const argv = process.argv.slice(2);
const FLAGS = { sweep: 1, width: 1, height: 1, view: 1, save: 1 };
const die = (m) => { console.error(`herotrans: ${m}`); process.exit(2); };
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) die(`unexpected argument "${argv[i]}"`);
  const k = argv[i].slice(2);
  if (!(k in FLAGS)) die(`unknown flag "--${k}". Known: ${Object.keys(FLAGS).join(' ')}`);
  if (FLAGS[k]) { if (i + 1 >= argv.length) die(`"--${k}" needs a value`); i++; }
}
const getf = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const W = +getf('width', 1600), H = +getf('height', 900);
/* Written into shots/sys7look/, never tmp/: another agent's tooling wiped tmp
   mid-run today and cost the capture agent two re-runs.
   Both arms come out of one page load, which is the point. A visual pair shot as
   two processes can differ by any file that landed between them, and one did
   today. */
const SAVE = getf('save', '');
const VIEW = getf('view', 'juniper');
const v = byName(VIEW);
if (!v) die(`no view "${VIEW}"`);

const TARGET = ['juniper-foliage'];

/* amt:iso:rim triples. The knee stays where it shipped: it was tested this round
   in irradiance space and took the contrast the wrong way, so it is not a free
   variable here. */
const SWEEP = (getf('sweep', '0:0:0,0.20:0:0,0.35:0:0,0.35:0:0.7,0.55:0:0.7,0.35:0.10:0.7')
).split(',').filter(Boolean).map(s => {
  const t = s.split(':').map(Number);
  if ((t.length !== 3 && t.length !== 6) || t.some(n => !isFinite(n)))
    die(`sweep entry "${s}" must be amt:iso:rim or amt:iso:rim:r:g:b`);
  /* The tint defaults to the near field's straw, which is what the crown
     inherited. It is a variable here because transmitted light is filtered by the
     pigment it passes through, so a dry cream grass blade and a juniper's scale
     foliage should not share one. */
  return { amt: t[0], iso: t[1], rim: t[2],
    tint: t.length === 6 ? [t[3], t[4], t[5]] : null };
});

const PAGE = /* js */`
  window.__ht = (() => {
    const g = window.__game;
    const THREE = g._three;
    const r = g.renderer;
    const w = r.domElement.width, h = r.domElement.height;
    const gl = r.getContext();

    const readback = () => {
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    };
    /* Chunked only because String.fromCharCode.apply has an argument limit; the
       whole binary string is encoded in one btoa call, so no padding lands in the
       middle of the stream. Chunking the btoa instead would need a multiple of
       three — 4096 % 3 == 1, and a decoder that stops at padding then returns
       only the first 4096 bytes of the frame, which reads as a plausible dark
       image rather than as an error. */
    const b64 = (bytes) => {
      let s = '';
      for (let i = 0; i < bytes.length; i += 4096)
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
      return btoa(s);
    };
    const isTarget = (name, pre) =>
      pre.some(p => name === p || name.indexOf(p + '-') === 0);

    return {
      dims: () => ({ w, h }),

      beauty: () => {
        g.setPaused(true);
        g.renderOnce();
        const b = readback();
        g.setPaused(false);
        const rgb = new Uint8Array(w * h * 3);
        for (let y = 0; y < h; y++) {
          const sy = h - 1 - y;               // readPixels is bottom-up
          for (let x = 0; x < w; x++) {
            const s = (sy * w + x) * 4, d = (y * w + x) * 3;
            rgb[d] = b[s]; rgb[d + 1] = b[s + 1]; rgb[d + 2] = b[s + 2];
          }
        }
        return b64(rgb);
      },

      mask: (pre) => {
        g.setPaused(true);
        const saved = [];
        g._scene.traverse(o => {
          if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
          saved.push({ o, vis: o.visible, mat: o.material });
          if (!isTarget(o.name || '', pre)) { o.visible = false; return; }
          const src = Array.isArray(o.material) ? o.material[0] : o.material;
          /* The map has to stay bound, because the alpha test is the cutout and
             the cutout is the coverage. But a MeshBasicMaterial carrying a map
             outputs that map's *colour*, not the material's, so "colour white,
             map the atlas" renders the albedo. On a pale cream shrub atlas most
             texels still clear a mask threshold and it passes for white; on this
             crown's dark olive atlas, mean 0.355 in sRGB, almost none do. The
             first run of this tool reported a crown of 1176 px against a crown
             spanning some hundreds across, and gave itself away by moving the
             control population, because the crown it failed to mask was still in
             the frame and had landed in the control.
             So the RGB is forced after the map is sampled and the alpha is left
             exactly as it was, and tone mapping is off so white arrives as
             white rather than as whatever the curve does to 1.0. */
          const mm = new THREE.MeshBasicMaterial({
            color: 0xffffff, map: src.map || null,
            alphaTest: src.alphaTest || 0, side: THREE.DoubleSide, fog: false,
            toneMapped: false,
          });
          mm.onBeforeCompile = (sh) => {
            const MARK = '#include <map_fragment>';
            if (sh.fragmentShader.indexOf(MARK) < 0)
              throw new Error('herotrans: no map_fragment in MeshBasicMaterial; '
                + 'the coverage mask needs rewriting');
            sh.fragmentShader = sh.fragmentShader.replace(MARK,
              MARK + '\\n\\tdiffuseColor.rgb = vec3( 1.0 );');
          };
          mm.customProgramCacheKey = () => 'herotrans-mask';
          o.material = mm;
        });
        const prevBg = g._scene.background, prevFog = g._scene.fog;
        g._scene.background = new THREE.Color(0x000000);
        g._scene.fog = null;
        if (g._atmo && g._atmo.setHidden) g._atmo.setHidden(true);
        if (g._atmo && g._atmo.setShimmer) g._atmo.setShimmer(false);
        if (g._post && g._post.setEnabled) g._post.setEnabled(false);
        g.renderOnce();
        const mb = readback();
        if (g._atmo && g._atmo.setShimmer) g._atmo.setShimmer(true);
        if (g._post && g._post.setEnabled) g._post.setEnabled(true);
        for (const s of saved) {
          if (s.o.material !== s.mat) s.o.material.dispose();
          s.o.material = s.mat; s.o.visible = s.vis;
        }
        g._scene.background = prevBg;
        g._scene.fog = prevFog;
        if (g._atmo && g._atmo.setHidden) g._atmo.setHidden(false);
        g.setPaused(false);

        const bytes = new Uint8Array((w * h + 7) >> 3);
        for (let y = 0; y < h; y++) {
          const sy = h - 1 - y;
          for (let x = 0; x < w; x++) {
            if (mb[(sy * w + x) * 4] > 96) {
              const i = y * w + x;
              bytes[i >> 3] |= 1 << (i & 7);
            }
          }
        }
        return b64(bytes);
      },

      /* Returns the meshes it reached. A sweep that silently touched nothing
         prints a flat table, and a flat table reads as "this lever does nothing",
         which is a conclusion rather than a null result. */
      setTrans: (pre, t) => {
        const hit = [];
        g._scene.traverse(o => {
          if (!o.isMesh || !isTarget(o.name || '', pre)) return;
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          const u = m && m.userData && m.userData.uniforms;
          if (!u || !u.uTransAmt) return;
          u.uTransAmt.value = t.amt;
          u.uTransIso.value = t.iso;
          u.uTransRim.value = t.rim;
          if (t.tint) u.uTrans.value.setRGB(t.tint[0], t.tint[1], t.tint[2]);
          hit.push(o.name);
        });
        return hit;
      },
    };
  })();
`;

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/* Hue in degrees and HSV saturation, on the same convention as every other
   colour figure in this project's record. */
function hs(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx > 0 ? d / mx : 0, v: mx / 255 };
}

const med = (a) => {
  if (!a.length) return NaN;
  a.sort((x, y) => x - y);
  return a[a.length >> 1];
};

/* `pop` is the chroma-carrying population of the *first* arm, and it is the whole
   reason this function returns two hues.
   Transmission raises value. A population gated on v>0.10 therefore grows when
   the term is switched on, as fragments that were too dark to have a meaningful
   hue cross the threshold — and they arrive carrying the transmission's own warm
   tint, so the median moves warm without a single pixel changing colour. That is
   a population artefact and it is indistinguishable from a colour regression
   unless the two are separated. `hueF` is over the fixed first-arm population and
   answers "did these pixels get warmer"; `hue` is over each arm's own population
   and answers "is the crown, as measured, warmer". Five colour findings on this
   project turned out to be measuring the wrong population. */
function measure(rgb, mask, w, h, pop) {
  const L = [], hue = [], sat = [], hueF = [], satF = [], rest = [];
  const mine = pop ? null : new Uint8Array(w * h);
  let clip = 0;
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    if (!((mask[i >> 3] >> (i & 7)) & 1)) { rest.push(lum(r, g, b)); continue; }
    L.push(lum(r, g, b));
    if (r > 253 || g > 253 || b > 253) clip++;
    const c = hs(r, g, b);
    const ok = c.v > 0.10 && c.s > 0.10;
    if (ok) { hue.push(c.h); sat.push(c.s); if (mine) mine[i] = 1; }
    if (pop && pop[i]) { hueF.push(c.h); satF.push(c.s); }
  }
  if (!L.length) return null;
  L.sort((a, b) => a - b);
  const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
  const mid = L.filter(x => x > 0.15 && x < 0.55).length;
  return {
    n: L.length, p10: q(0.10), p50: q(0.50), p90: q(0.90), p99: q(0.99),
    max: q(1), ratio: q(0.90) / Math.max(q(0.10), 1e-4),
    mid: 100 * mid / L.length, clip,
    hue: med(hue), sat: med(sat), nhue: hue.length,
    hueF: pop ? med(hueF) : med(hue), satF: pop ? med(satF) : med(sat),
    nhueF: pop ? hueF.length : hue.length,
    rest: med(rest), pop: mine,
  };
}

const rows = [];
let basePop = null;
await run({ width: W, height: H, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);
  await page.evaluate(PAGE);
  const { w, h } = await page.evaluate(() => window.__ht.dims());

  await page.evaluate(([d, yaw, pitch]) => {
    const g = window.__game;
    g.walkTo(d); g.lookAt(yaw, pitch);
  }, [v.d, v.yaw, v.pitch]);
  await page.waitForTimeout(900);

  /* Once. The coverage mask cannot depend on a shading term. */
  const mb = Buffer.from(await page.evaluate(p => window.__ht.mask(p), TARGET),
    'base64');

  for (const t of SWEEP) {
    const hit = await page.evaluate(([p, tt]) => window.__ht.setTrans(p, tt),
      [TARGET, t]);
    if (!hit.length) die('setTrans reached no material carrying uTransAmt');
    const rgb = Buffer.from(await page.evaluate(() => window.__ht.beauty()),
      'base64');
    const m = measure(rgb, mb, w, h, basePop);
    if (m && !basePop) basePop = m.pop;
    rows.push({ t, hit: hit.length, ...m });
    if (SAVE) {
      const dir = path.resolve(new URL('..', import.meta.url).pathname
        .replace(/^\//, ''), 'shots', 'sys7look');
      fs.mkdirSync(dir, { recursive: true });
      /* The tint has to be in the name. It was not, and four arms of one sweep
         each overwrote the last, leaving one file labelled as the whole sweep. */
      const tag = `${t.amt}_${t.iso}_${t.rim}`
        + (t.tint ? '_' + t.tint.join('_') : '_straw');
      const f = path.join(dir, `${SAVE}_${VIEW}_${tag}.png`);
      fs.writeFileSync(f, encodeRGB(w, h, rgb));
      console.log(`  wrote ${f}`);
    }
  }
});

console.log(`\nhero crown transmission, ${VIEW} at ${W}x${H}, one page load`);
console.log('  crown = coverage mask of juniper-foliage. rest = every other pixel,');
console.log('          a control: it must not move, or the arm differs by something');
console.log('          other than the uniform.');
console.log('  ratio = crown p90/p10, the two-tone statistic. Real juniper 2.4:1,');
console.log('          this crown 8.9:1 before the term. A direction, not a target.\n');
console.log('  hue/sat  = each arm\'s own chroma-carrying population');
console.log('  hueF/satF= the first arm\'s population, held fixed. The pair'
  + ' separates a colour');
console.log('             change from a population that grew as dark pixels'
  + ' crossed v>0.10.\n');
console.log('  amt   iso   rim  uTrans        |    p10    p50    p90    p99    max |'
  + '  ratio   mid%  clip |   hue    sat |  hueF   satF     n |  rest');
for (const r of rows) {
  if (!r.n) { console.log('  no crown pixels in frame'); continue; }
  const f = (x, d = 3) => x.toFixed(d).padStart(d + 3);
  console.log(`  ${r.t.amt.toFixed(2)}  ${r.t.iso.toFixed(2)}  ${r.t.rim.toFixed(2)}`
    + ` ${(r.t.tint ? r.t.tint.map(x => x.toFixed(2)).join(',') : 'as-built').padEnd(14)}|`
    + ` ${f(r.p10)} ${f(r.p50)} ${f(r.p90)} ${f(r.p99)} ${f(r.max)} |`
    + ` ${r.ratio.toFixed(2).padStart(6)} ${r.mid.toFixed(1).padStart(6)}`
    + ` ${String(r.clip).padStart(5)} |`
    + ` ${r.hue.toFixed(1).padStart(5)} ${r.sat.toFixed(3)} |`
    + ` ${r.hueF.toFixed(1).padStart(5)} ${r.satF.toFixed(3)}`
    + ` ${String(r.nhue).padStart(6)} |`
    + ` ${r.rest.toFixed(4)}`);
}
console.log(`\n  crown n = ${rows[0] ? rows[0].n : 0} px`
  + `, hue and sat over the ${rows[0] ? rows[0].nhue : 0} carrying chroma`
  + ` (v>0.10, s>0.10)`);
console.log('  mid%  = share of crown pixels with L in 0.15..0.55\n');

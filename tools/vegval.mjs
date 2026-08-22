/* How bright are the near-field plants, and do they have a midtone?
 *
 *   node tools/vegval.mjs
 *   node tools/vegval.mjs --view wash_low --width 2560 --height 1440 --keep
 *
 * A critic failed the shipping build with the near shrubs as its sixth-most
 * damaging finding: "clipped to pure white against a dark cliff", "flat two-tone
 * cutout blades", "black silhouette leaves interleaved behind with no midtone
 * between". Two separate claims — a level claim and a distribution claim — and
 * both are measurable, but only against a population that says what a shrub
 * pixel *is*. Sampling a rectangle around a shrub measures the cliff behind it.
 *
 * So the plants are masked the way tools/bole.mjs masks the hero: force an
 * emissive-white override on the named instanced meshes, keep their alpha maps
 * so the cutout still cuts, and render straight to the framebuffer with both
 * post chains and the atmosphere off. That never touches System 5's composite
 * or System 7's grade, so what comes back is coverage and nothing else. The
 * beauty frame is then read through that mask.
 *
 * POPULATIONS, quoted with every number below because five population errors
 * landed in one night on this project:
 *
 *   plant   pixels whose coverage mask is set for veg-grass or veg-shrub, in the
 *           graded frame at the stated resolution. Not a rectangle.
 *   floor   the brightest 40% of *unmasked* pixels in the bottom 22% of the
 *           frame, by max channel, discarding max channel under 12 code values.
 *
 * The floor population is defined by a fixed band rather than by detecting a
 * horizon, because the first version of this tool detected one and the number it
 * produced was fiction. It called a pixel "ground" when red exceeded blue, which
 * is true of the warm aureole as well as of rock, so the horizon landed hundreds
 * of rows into the sky, `bend` detected row 0 and took the whole frame, and the
 * brightest 40% of that was mostly haze: it reported sunlit sandstone at L 0.924
 * against a contract figure of 0.687. The bottom 22% of every framing in this
 * set is near-field ground and cannot contain sky, which is the property worth
 * having. It is the sunlit wash floor rather than a cliff face, so it is named
 * for what it is.
 *
 * The level claim is `plant p99 / rock p50` and the clip fraction. The
 * distribution claim is the midtone share: a Lambertian cutout with no
 * transmission puts every pixel either in full key or in ambient alone and
 * leaves the middle of the range empty, which is what "two-tone" means and what
 * a histogram can show without any judgement of taste.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from './harness.mjs';
import { encodeRGB } from './png.mjs';

const argv = process.argv.slice(2);
const FLAGS = { view: 1, width: 1, height: 1, keep: 0, sweep: 1 };
const die = (m) => { console.error(`vegval: ${m}`); process.exit(2); };
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
const KEEP = argv.includes('--keep');
const DIR = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\//, ''));

/* Every framing that carries near-field plants in the critique. */
const VIEWS = [
  { name: 'wash_low', d: 8, yaw: 0, pitch: -4 },
  { name: 'wash_mid', d: 46, yaw: 0, pitch: 0 },
  { name: 'bend', d: 92, yaw: -22, pitch: 2 },
  { name: 'far_170', d: 170, yaw: 0, pitch: 2 },
];
const only = getf('view', '');
const views = only ? VIEWS.filter(v => v.name === only) : VIEWS;
if (!views.length) die(`no view "${only}"; have ${VIEWS.map(v => v.name).join(', ')}`);

/* Tier *prefixes*, because a tier is several draw calls now: the near shrub is
   split across three silhouettes named `veg-shrub-a` and so on. Matching whole
   names here would have quietly measured a third of the population. */
const PLANTS = ['veg-grass', 'veg-shrub'];

/* Candidate `cap:amt:iso` triples for the foliage BRDF, swept in one page load —
   the direct-diffuse knee, the forward-scatter amount and the isotropic leak.
   Sizing these by reasoning does not work: they act on linear radiance before
   tone mapping and the statistic is a post-tonemap code value, so the mapping
   between them runs through the whole grade and is not available on paper. The
   first attempt swept the knee alone over a 7.5x range and moved the level by
   14%, because with the knee clamped the brightness had simply moved into the
   transmission term, which is added *after* it by design. Sweeping one parameter
   of three is how you conclude a lever does nothing when what it does is hand
   the energy to its neighbour.
   The coverage mask does not depend on any of them, so it is taken once. */
const SWEEP = (getf('sweep', '') || '').split(',').filter(Boolean).map(s => {
  const t = s.split(':').map(Number);
  if (t.length !== 4 || t.some(n => !isFinite(n)))
    die(`sweep entry "${s}" must be cap:amt:iso:amb, four finite numbers`);
  return { cap: t[0], amt: t[1], iso: t[2], amb: t[3] };
});

/* Coverage mask for a set of named objects, plus the beauty frame, from one
   page state. Returned as a packed bitset and a raw RGB buffer, both base64:
   a 2560x1440 mask is 3.7M booleans and serialising that as JSON numbers across
   CDP takes appreciably longer than the render does. */
const PAGE = /* js */`
  window.__vv = (() => {
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
    const b64 = (bytes) => {
      let s = '';
      for (let i = 0; i < bytes.length; i += 4096)
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
      return btoa(s);
    };
    /* A tier is several draw calls, so match the prefix. */
    const isPlant = (name, pre) => pre.some(p => name === p || name.indexOf(p + '-') === 0);

    return {
      dims: () => ({ w, h }),

      /* The beauty frame, exactly as shipped. The loop has to stop first:
         begin() has already run, so a rAF tick can land between a render and its
         pixel read, rebind the default framebuffer and draw the real frame into
         it. */
      beauty: () => {
        g.setPaused(true);
        g.renderOnce();
        const b = readback();
        g.setPaused(false);
        const rgb = new Uint8Array(w * h * 3);
        for (let y = 0; y < h; y++) {
          const sy = h - 1 - y;          // readPixels is bottom-up
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
          if (!isPlant(o.name || '', pre)) { o.visible = false; return; }
          const src = Array.isArray(o.material) ? o.material[0] : o.material;
          /* The map stays bound because the alpha test is the cutout and the
             cutout is the coverage. But a MeshBasicMaterial carrying a map
             outputs that map's *colour*, not the material's, so this override was
             rendering the atlas and its threshold was discarding the atlas's
             darkest texels — the outer, darker pass of every blade and leaf, and
             the scrub stems. Every plant figure taken before this was therefore
             over the brighter part of the population rather than over the
             population named in the header. Caught on the hero crown, whose
             atlas is dark enough that the same code undercounted it 94-fold,
             1176 px against 110368; see tools/herotrans.mjs. So the RGB is forced
             after the map is sampled, alpha is left exactly as it was, and tone
             mapping is off so white arrives as white. */
          const mm = new THREE.MeshBasicMaterial({
            color: 0xffffff, map: src.map || null,
            alphaTest: src.alphaTest || 0, side: THREE.DoubleSide, fog: false,
            toneMapped: false,
          });
          mm.onBeforeCompile = (sh) => {
            const MARK = '#include <map_fragment>';
            if (sh.fragmentShader.indexOf(MARK) < 0)
              throw new Error('vegval: no map_fragment in MeshBasicMaterial; '
                + 'the coverage mask needs rewriting');
            sh.fragmentShader = sh.fragmentShader.replace(MARK,
              MARK + '\\n\\tdiffuseColor.rgb = vec3( 1.0 );');
          };
          mm.customProgramCacheKey = () => 'vegval-mask';
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

      /* Set the three foliage BRDF terms on the plant tiers, so they can be
         swept without a rebuild. Returns the meshes it actually touched, because
         a sweep that silently reached nothing prints a flat table and reads as
         "these levers do nothing" — which is a conclusion, not a null result. */
      setBrdf: (pre, t) => {
        const hit = [];
        g._scene.traverse(o => {
          if (!o.isMesh || !isPlant(o.name || '', pre)) return;
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          const u = m && m.userData && m.userData.uniforms;
          if (!u || !u.uDirCap) return;
          u.uDirCap.value = t.cap;
          u.uTransAmt.value = t.amt;
          u.uTransIso.value = t.iso;
          u.uAmbScale.value = t.amb;
          hit.push(o.name);
        });
        return hit;
      },
    };
  })();
`;

/* Rec.709 relative luminance on normalised code values. Stated rather than
   assumed: this project has three tools that each meant something different by
   "L", and one of them cost an hour. */
const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function stats(list) {
  if (!list.length) return null;
  list.sort((a, b) => a - b);
  const q = (p) => list[Math.min(list.length - 1, Math.floor(p * list.length))];
  return { n: list.length, p01: q(0.01), p10: q(0.10), p50: q(0.50),
    p90: q(0.90), p99: q(0.99), max: q(1) };
}

function measure(rgb, mb, w, h) {
  const isPlant = (i) => (mb[i >> 3] >> (i & 7)) & 1;
  const floorTop = Math.floor(h * 0.78);
    const plantL = [], floorCand = [];
    let clip = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, s = i * 3;
        const R = rgb[s], G = rgb[s + 1], B = rgb[s + 2];
        if (isPlant(i)) {
          plantL.push(lum(R, G, B));
          if (Math.max(R, G, B) >= 254) clip++;
        } else if (y >= floorTop) {
          if (Math.max(R, G, B) >= 12) floorCand.push(lum(R, G, B));
        }
      }
    }
    floorCand.sort((a, b) => a - b);
    const flr = stats(floorCand.slice(Math.floor(floorCand.length * 0.60)));
    const plant = stats(plantL);

    /* The two-tone claim is about *shape*, not spread, so it needs a histogram
       rather than three buckets. A cutout lit as a Lambertian sheet with no
       transmission puts each pixel either in full key or in ambient alone, so
       its histogram is two piles with a trough between them. Normalised to the
       population's own p99 so this cannot turn into a brightness test by the
       back door — a uniformly dim plant and a uniformly bright one both have a
       midtone if their pixels spread across their own range. */
    const HB = 10;
    const hist = new Array(HB).fill(0);
    if (plant) {
      const top = Math.max(plant.p99, 1e-6);
      for (const L of plantL)
        hist[Math.min(HB - 1, Math.floor(L / top * HB))]++;
    }

  return { plant, flr, clip, hist };
}

const rows = [];
await run({ width: W, height: H, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);
  await page.evaluate(PAGE);
  const { w, h } = await page.evaluate(() => window.__vv.dims());

  for (const v of views) {
    await page.evaluate(([d, yaw, pitch]) => {
      const g = window.__game;
      g.walkTo(d); g.lookAt(yaw, pitch);
    }, [v.d, v.yaw, v.pitch]);
    await page.waitForTimeout(600);

    /* Once per view: the knee does not move it. */
    const mb = Buffer.from(await page.evaluate(p => window.__vv.mask(p), PLANTS),
      'base64');

    if (!SWEEP.length) {
      const rgb = Buffer.from(await page.evaluate(() => window.__vv.beauty()), 'base64');
      rows.push({ view: v.name, t: null, ...measure(rgb, mb, w, h) });
    } else {
      for (const t of SWEEP) {
        const hit = await page.evaluate(([p, tt]) => window.__vv.setBrdf(p, tt),
          [PLANTS, t]);
        if (!hit.length) die('setBrdf reached no material with a uDirCap uniform' +
          ' — a sweep that touches nothing prints a flat table');
        const rgb = Buffer.from(await page.evaluate(() => window.__vv.beauty()), 'base64');
        rows.push({ view: v.name, t, tiers: hit.length, ...measure(rgb, mb, w, h) });
      }
    }

    if (KEEP) {
      const vis = Buffer.alloc(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const on = (mb[i >> 3] >> (i & 7)) & 1 ? 255 : 0;
        vis[i * 3] = on; vis[i * 3 + 1] = on; vis[i * 3 + 2] = on;
      }
      fs.mkdirSync(path.join(DIR, 'tmp'), { recursive: true });
      fs.writeFileSync(path.join(DIR, 'tmp', `vegval_${v.name}_mask.png`),
        encodeRGB(w, h, vis));
    }
  }
});

console.log(`\nnear-field plant levels, graded arm, ${W}x${H}`);
console.log('  plant = coverage mask of veg-grass + veg-shrub, whole frame');
console.log('  floor = brightest 40% of unmasked pixels in the bottom 22%');
console.log('  L     = Rec.709 relative luminance on normalised code values\n');
for (const r of rows) {
  console.log(`${r.view}` + (!r.t ? ''
    : `   cap ${r.t.cap}  amt ${r.t.amt}  iso ${r.t.iso}  amb ${r.t.amb}` +
      `   (${r.tiers} plant draw calls)`));
  if (!r.plant) { console.log('  no plant pixels in frame\n'); continue; }
  console.log(`  plant  n ${r.plant.n}   L p10 ${r.plant.p10.toFixed(3)}` +
    `  p50 ${r.plant.p50.toFixed(3)}  p90 ${r.plant.p90.toFixed(3)}` +
    `  p99 ${r.plant.p99.toFixed(3)}  max ${r.plant.max.toFixed(3)}`);
  if (r.flr)
    console.log(`  floor  n ${r.flr.n}   L p10 ${r.flr.p10.toFixed(3)}` +
      `  p50 ${r.flr.p50.toFixed(3)}  p90 ${r.flr.p90.toFixed(3)}` +
      `  p99 ${r.flr.p99.toFixed(3)}`);
  if (r.flr)
    console.log(`  plant p99 / floor p50   ${(r.plant.p99 / r.flr.p50).toFixed(2)}x` +
      `   — foliage reflectance is well under sand's, so under 1 is the only` +
      ` defensible side`);
  console.log(`  at 254+ on any channel   ${r.clip}` +
    `  = ${(100 * r.clip / r.plant.n).toFixed(2)}% of plant pixels`);
  const tot = r.hist.reduce((a, b) => a + b, 0);
  const bar = r.hist.map(n => {
    const p = 100 * n / tot;
    return p.toFixed(0).padStart(3);
  }).join(' ');
  console.log(`  histogram, % per tenth of own p99`);
  console.log(`    ${bar}`);
  console.log(`     lo                                    hi`);
  console.log('');
}

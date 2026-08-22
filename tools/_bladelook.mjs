/* Measure and crop one plant class where it is brightest, by mask.
 *
 *   node tools/_bladelook.mjs --view wash_low --mesh veg-grass --tag before
 *
 * A delivery critic reported the grass in `wash_low` as "chalky cream,
 * desaturated toward neutral, and brighter than anything else in frame including
 * sunlit rock", with "the three tones visibly quantised into flat bands" and
 * "holes punched through them by the alpha mask".
 *
 * Coordinates are not usable for finding it. The critic's y for this framing is
 * bottom-origin, and reading it top-origin lands on lit gravel whose highlights
 * are the same colour as the complaint -- which has now wasted time twice. So
 * this finds the class by rendering a coverage mask for it and measures only
 * pixels the class actually drew.
 *
 * The mask is built the way the mask instrument fault in CONTRACT.md requires: a
 * MeshBasicMaterial with a white colour and the atlas bound as `map` renders the
 * *atlas's* colour, because a bound map multiplies into the output, so a
 * brightness threshold on it silently discards the darkest texels of whatever it
 * is masking. It undercounted the hero crown 94-fold. Here the map is kept for
 * its alpha and the colour is forced to white in the shader.
 *
 * The luminance histogram is the point rather than a garnish: "quantised into
 * three flat bands" is a claim about a distribution, and three passes across a
 * blade should show as three modes. It is the one measurement that can tell a
 * rolling ramp from cel shading without an eye.
 */
import fs from 'node:fs';
import { run } from './harness.mjs';
import { byName } from './views.mjs';
import { encodeRGB } from './png.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const view = opt('view', 'wash_low');
const meshPre = opt('mesh', 'veg-grass');
const tag = opt('tag', 'now');
const W = +opt('w', 1997), H = +opt('h', 1123);
const v = byName(view);

const PAGE = /* js */`
  window.__bl = async (pre) => {
    const g = window.__game;
    const r = g.renderer, gl = r.getContext();
    const w = r.domElement.width, h = r.domElement.height;
    const grab = () => {
      const b = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
      const o = new Uint8Array(w * h * 3);
      for (let y = 0; y < h; y++) {
        const sy = h - 1 - y;
        for (let x = 0; x < w; x++) {
          const s = (sy * w + x) * 4, d = (y * w + x) * 3;
          o[d] = b[s]; o[d + 1] = b[s + 1]; o[d + 2] = b[s + 2];
        }
      }
      return o;
    };
    const THREE = g._three;
    g.setPaused(true);
    g.renderOnce();
    const beauty = grab();

    /* Coverage mask: the target class white, everything else black. */
    const targets = [], others = [], swapped = [];
    g._scene.traverse(o => {
      if (!(o.isMesh || o.isPoints || o.isSprite)) return;
      const n = o.name || '';
      if (n.indexOf(pre) === 0) targets.push(o); else others.push(o);
    });
    /* Everything else keeps drawing, but writes no colour. Hiding it instead
       marks the class's coverage as if nothing were in front of it, so a masked
       pixel can be whatever occludes the plant -- and the brightest "grass" pixel
       in this framing was lit gravel seen through a hole in the grass. It gave
       itself away by being byte-identical across an A/B that changed the atlas. */
    const noColor = [];
    for (const o of others) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const mm of ms) {
        if (!mm || mm.colorWrite === false) continue;
        mm.colorWrite = false;
        noColor.push(mm);
      }
    }
    for (const o of targets) {
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff, map: src.map || null, side: THREE.DoubleSide,
        alphaTest: src.alphaTest || 0, transparent: false, toneMapped: false,
        fog: false,
      });
      m.onBeforeCompile = (sh) => {
        if (sh.fragmentShader.indexOf('#include <map_fragment>') < 0)
          throw new Error('_bladelook: no map_fragment to force white in; the mask '
            + 'would carry the atlas colour and undercount dark texels');
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
          '#include <map_fragment>\\n\\tdiffuseColor.rgb = vec3( 1.0 );');
      };
      swapped.push({ o, was: o.material });
      o.material = m;
    }
    const bg = g._scene.background;
    g._scene.background = new THREE.Color(0x000000);
    const fog = g._scene.fog; g._scene.fog = null;
    g.renderOnce();
    const mask = grab();
    g._scene.background = bg; g._scene.fog = fog;
    for (const s of swapped) { s.o.material.dispose(); s.o.material = s.was; }
    for (const mm of noColor) mm.colorWrite = true;
    g.setPaused(false);

    const b64 = (u8) => {
      let s = '';
      for (let i = 0; i < u8.length; i += 4096)
        s += String.fromCharCode.apply(null, u8.subarray(i, i + 4096));
      return btoa(s);
    };
    return { w, h, beauty: b64(beauty), mask: b64(mask) };
  };
`;

let out;
await run({ width: W, height: H, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);
  await page.evaluate(PAGE);
  await page.evaluate(([d, yaw, pitch]) => {
    const g = window.__game;
    g.walkTo(d); g.lookAt(yaw, pitch);
  }, [v.d, v.yaw, v.pitch]);
  await page.waitForTimeout(900);
  out = await page.evaluate(p => window.__bl(p), meshPre);
  if (errs.length) console.log('page errors: ' + [...new Set(errs)].slice(0, 3).join(' | '));
});

const beauty = Buffer.from(out.beauty, 'base64');
const mask = Buffer.from(out.mask, 'base64');
const { w, h } = out;
const lum = (b, i) => 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];

/* An optional stored frame, measured over the *same* mask. The mask depends on
   coverage, which an albedo change does not move, so this is a genuine paired
   before/after over one pixel set without needing the old build on disk. */
const refFile = opt('ref', '');
let ref = null;
if (refFile) {
  const { decode } = await import('./png.mjs');
  const d = decode(fs.readFileSync(refFile));
  if (d.w !== w || d.h !== h)
    console.log(`note: ${refFile} is ${d.w}x${d.h}, frame is ${w}x${h}; skipping ref`);
  else ref = d;
}

const collect = (src, ch, stride) => {
  const out2 = [];
  for (let i = 0; i < w * h; i++) {
    if (mask[i * 3] < 96) continue;
    const j = i * stride;
    out2.push({ i, l: lum(src, j), r: src[j], g: src[j + 1], b: src[j + 2] });
  }
  out2.sort((p, q) => q.l - p.l);
  return out2;
};
const px = collect(beauty, 3, 3);
console.log(`\n${view} ${w}x${h}, mesh prefix ${meshPre}, tag ${tag}`);
console.log(`  ${px.length} masked pixels`);
if (!px.length) process.exit(0);

const sat = (p) => { const mx = Math.max(p.r, p.g, p.b); return mx ? (mx - Math.min(p.r, p.g, p.b)) / mx : 0; };
const stat = (label, arr) => {
  const n = arr.length || 1;
  const m = (f) => arr.reduce((s, p) => s + f(p), 0) / n;
  return `  ${label.padEnd(18)} rgb(${String(Math.round(m(p => p.r))).padStart(3)},`
    + `${String(Math.round(m(p => p.g))).padStart(3)},${String(Math.round(m(p => p.b))).padStart(3)})`
    + `  L ${m(p => p.l).toFixed(1).padStart(5)}  sat ${m(sat).toFixed(3)}`;
};
const slices = [['brightest pixel', 1e-9], ['brightest 0.1%', 0.001],
  ['brightest 1%', 0.01], ['all masked', 1]];
const cut = (arr, f) => arr.slice(0, Math.max(1, f >= 1 ? arr.length : arr.length * f | 0));
if (ref) {
  const rp = collect(ref.px, ref.ch, ref.ch);
  console.log(`\n  ref ${refFile}`);
  for (const [lab, f] of slices) {
    console.log(stat(lab + ' [ref]', cut(rp, f)));
    console.log(stat(lab + ' [now]', cut(px, f)));
  }
} else {
  for (const [lab, f] of slices) console.log(stat(lab, cut(px, f)));
}

/* Rock's peak, for the "brighter than sunlit rock" claim: brightest unmasked. */
const rock = [];
for (let i = 0; i < w * h; i++) {
  if (mask[i * 3] >= 96) continue;
  const j = i * 3;
  rock.push(lum(beauty, j));
}
rock.sort((p, q) => q - p);
console.log(`  unmasked peak L ${rock[0].toFixed(1)}, 99.9th pct `
  + `${rock[rock.length * 0.001 | 0].toFixed(1)}`);

console.log('\n  luminance histogram of masked pixels, bins of 8:');
const bins = new Array(32).fill(0);
for (const p of px) bins[Math.min(31, p.l / 8 | 0)]++;
const mx = Math.max(...bins);
for (let i = 0; i < 32; i++) {
  if (!bins[i] && (i < 2 || !bins.slice(i).some(v => v))) break;
  const bar = '#'.repeat(Math.round(bins[i] / mx * 54));
  console.log(`    L ${String(i * 8).padStart(3)}-${String(i * 8 + 7).padStart(3)}`
    + ` ${String(bins[i]).padStart(7)} ${bar}`);
}

/* A crop centred on the brightest masked pixel, so the bands and any alpha
   holes are inspectable at the magnification the critic used. */
const cx = px[0].i % w, cy = (px[0].i / w) | 0;
const S = +opt('scale', 6), R = +opt('radius', 46);
const X0 = Math.max(0, cx - R), Y0 = Math.max(0, cy - R);
const X1 = Math.min(w - 1, cx + R), Y1 = Math.min(h - 1, cy + R);
const cw = (X1 - X0) * S, chh = (Y1 - Y0) * S;
const crop = Buffer.alloc(cw * chh * 3);
for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
  const s = ((Y0 + ((y / S) | 0)) * w + (X0 + ((x / S) | 0))) * 3, d = (y * cw + x) * 3;
  crop[d] = beauty[s]; crop[d + 1] = beauty[s + 1]; crop[d + 2] = beauty[s + 2];
}
const f = `shots/sys7look/blade_${view}_${tag}_${S}x.png`;
fs.writeFileSync(f, encodeRGB(cw, chh, crop));
console.log(`\n  brightest masked pixel at (${cx},${cy})`);
console.log(`  wrote ${f}  ${cw}x${chh}`);

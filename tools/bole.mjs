/* How thick the hero juniper's woody members actually are, in pixels, in frame.
 *
 *   node tools/bole.mjs
 *   node tools/bole.mjs --view juniper --width 1600 --height 900 --keep
 *
 * Two rounds running I have reported a fat trunk from the model — "0.84 m
 * diameter above the soil, 75:1 gauge spread" — and two rounds running a critic
 * has been unable to find one in the image. Both were true. The geometry is
 * there and it is behind the foliage skirt, so the number I was quoting was
 * about a mesh nobody can see. A claim about what the tree looks like has to be
 * measured on what reaches the frame.
 *
 * So this measures what the critic measures. Two captures from one boot:
 *
 *   wood     only `juniper-wood`, on black — the woody silhouette
 *   plant    wood plus `juniper-foliage` — the whole crown silhouette
 *
 * A Euclidean distance transform of the woody silhouette gives, at every woody
 * pixel, the distance to the nearest non-wood pixel. Twice that is the local
 * width of the member that pixel sits in, so the maximum over the mask is the
 * thickest thing on the tree as *drawn*, occlusion included, and the median says
 * whether the tree is all one gauge. Dividing the maximum by the crown's width
 * gives the bole-to-crown ratio the critique is scored on: a real old juniper is
 * somewhere near a quarter, and one-gauge scrub is near a twentieth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run, capture } from './harness.mjs';
import { encodeRGB } from './png.mjs';

const argv = process.argv.slice(2);
const getf = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const VIEW = getf('view', 'juniper');
const W = +getf('width', 1600), H = +getf('height', 900);
const DIR = new URL('..', import.meta.url).pathname.replace(/^\//, '');
const KEEP = argv.includes('--keep');

const VIEWS = [
  { name: 'wash_mid', d: 46, yaw: 0, pitch: 0 },
  { name: 'juniper', d: 62, yaw: 34, pitch: 3 },
  { name: 'bend', d: 92, yaw: -22, pitch: 2 },
];
const v = VIEWS.find(x => x.name === VIEW);
if (!v) throw new Error(`no view ${VIEW}; have ${VIEWS.map(x => x.name).join(', ')}`);

/* Exact Euclidean distance transform, Felzenszwalb & Huttenlocher: the squared
   EDT of a 2D mask is separable, so it is a 1D lower envelope of parabolas down
   the columns and then across the rows. Linear time and exact, which a chamfer
   approximation is not — and the figure being argued over is a maximum, which is
   exactly where a chamfer's error concentrates. */
function edt1d(f, n) {
  const d = new Float64Array(n), vv = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0;
  vv[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      s = ((f[q] + q * q) - (f[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]);
      if (s <= z[k]) k--; else break;
    }
    k++; vv[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - vv[k]) * (q - vv[k]) + f[vv[k]];
  }
  return d;
}
function edt(mask, w, h) {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const out = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? INF : 0;
    const d = edt1d(f, h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    const d = edt1d(f, w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

/* Silhouette of a named set of objects, rendered in the page.
 *
 * Not via a capture: a capture comes out of System 5's shimmer composite and
 * System 7's chain, and the first attempt at this measured the atmospheric
 * in-scatter of an almost-empty scene — a brown haze that thresholded into a
 * 944 px wide "crown" and a 107 px "trunk". Every number off it was fiction.
 *
 * `main.js` already establishes the honest way to do this for its own sky mask:
 * force `scene.overrideMaterial`, hide the particle systems, render straight to
 * an offscreen target and read the pixels back. That path never touches either
 * post chain, so what comes back is coverage and nothing else. Alpha-tested
 * cards need their own maps kept, so the override is per-material rather than
 * scene-wide: emissive white where we want coverage, and the map retained so the
 * cutout still cuts.
 *
 * Returned as a packed bitset in base64. A 1600x900 mask is 1.44M booleans and
 * serialising that as a JSON array of numbers across CDP takes longer than the
 * render.
 */
const silhouette = (names) => {
  const g = window.__game;
  const THREE = g._three;
  const r = g.renderer;
  const w = r.domElement.width, h = r.domElement.height;
  /* The loop has to be stopped first. `begin()` has already been called, so a
     requestAnimationFrame tick can land between the render below and the pixel
     read, rebind the default framebuffer and draw the real frame into it — which
     is how the first working version of this came back with 28 woody pixels out
     of a tree that covers a hundred thousand. */
  g.setPaused(true);

  const saved = [];
  g._scene.traverse(o => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    saved.push({ o, vis: o.visible, mat: o.material });
    if (!names.includes(o.name)) { o.visible = false; return; }
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    o.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: src.map || null,
      alphaTest: src.alphaTest || 0,
      side: THREE.DoubleSide,
      fog: false,
    });
  });
  const prevBg = g._scene.background, prevFog = g._scene.fog;
  g._scene.background = new THREE.Color(0x000000);
  g._scene.fog = null;
  if (g._atmo && g._atmo.setHidden) g._atmo.setHidden(true);

  /* Straight to the default framebuffer via the project's own renderOnce, then
     read the canvas. Going through a private render target of my own missed all
     but 28 pixels of the tree and I could not account for it; renderOnce is the
     path the whole project already trusts, it handles the shimmer composite and
     the render scale, and with the atmosphere hidden and both post chains off
     there is nothing left in it to distort coverage. */
  if (g._atmo && g._atmo.setShimmer) g._atmo.setShimmer(false);
  if (g._post && g._post.setEnabled) g._post.setEnabled(false);
  g.renderOnce();
  const gl = r.getContext();
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  if (g._atmo && g._atmo.setShimmer) g._atmo.setShimmer(true);

  for (const s of saved) {
    if (s.o.material !== s.mat) s.o.material.dispose();
    s.o.material = s.mat; s.o.visible = s.vis;
  }
  g._scene.background = prevBg;
  g._scene.fog = prevFog;
  if (g._atmo && g._atmo.setHidden) g._atmo.setHidden(false);
  g.setPaused(false);

  /* readRenderTargetPixels is bottom-up; flip so y matches the frame. */
  const bytes = new Uint8Array((w * h + 7) >> 3);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      if (buf[(sy * w + x) * 4] > 96) {
        const i = y * w + x;
        bytes[i >> 3] |= 1 << (i & 7);
      }
    }
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096)
    s += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return { w, h, b64: btoa(s) };
};

function unpack({ w, h, b64 }) {
  const bytes = Buffer.from(b64, 'base64');
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return { m, w, h };
}

await run({ width: W, height: H, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);
  await page.evaluate(([d, yaw, pitch]) => {
    const g = window.__game;
    g.walkTo(d); g.lookAt(yaw, pitch);
  }, [v.d, v.yaw, v.pitch]);
  await page.waitForTimeout(500);

  /* While a page is up: is multisampling actually on?
     Three vegetation materials set `alphaToCoverage`, the shimmer target asks
     for four samples, and the quality governor claims to pin the top tier under
     automation — and yet two critics independently report hard 1-bit alpha with
     no coverage antialiasing. `alphaToCoverage` is inert unless the bound
     framebuffer really is multisampled, so the question is what the driver gave
     us rather than what we asked for. Asking GL is one line and settles it. */
  const aa = await page.evaluate(() => {
    const g = window.__game;
    const gl = g.renderer.getContext();
    const mats = [];
    g._scene.traverse(o => {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.alphaToCoverage) mats.push(`${o.name || o.type}(aT=${m.alphaTest})`);
    });
    return {
      webgl2: !!(g.renderer.capabilities && g.renderer.capabilities.isWebGL2),
      canvasSamples: gl.getParameter(gl.SAMPLES),
      maxSamples: gl.getParameter(0x8D57),
      perfKeys: g.perf ? Object.keys(g.perf).join(',') : 'no perf',
      atmoKeys: g._atmo ? Object.keys(g._atmo).filter(k => /samp|shim|qual/i.test(k))
        .join(',') || 'none matching' : 'no _atmo',
      alphaToCoverageOn: mats.slice(0, 8),
    };
  }).catch(e => ({ error: String(e) }));
  console.log('\nmultisampling as the driver sees it');
  console.log(' ', JSON.stringify(aa));

  const wood = unpack(await page.evaluate(silhouette, ['juniper-wood']));
  const plant = unpack(await page.evaluate(silhouette,
    ['juniper-wood', 'juniper-foliage']));
  if (KEEP) {
    const dump = (name, s) => {
      const rgb = Buffer.alloc(s.w * s.h * 3);
      for (let i = 0; i < s.w * s.h; i++) {
        const v = s.m[i] ? 255 : 0;
        rgb[i * 3] = v; rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v;
      }
      fs.writeFileSync(path.join(DIR, 'tmp', name), encodeRGB(s.w, s.h, rgb));
    };
    fs.mkdirSync(path.join(DIR, 'tmp'), { recursive: true });
    dump('bole_wood.png', wood);
    dump('bole_plant.png', plant);
  }

  /* Crown extent from the plant silhouette. Columns and rows carrying at least a
     few pixels, so one stray card does not set the width. */
  const colN = new Int32Array(plant.w), rowN = new Int32Array(plant.h);
  for (let y = 0; y < plant.h; y++)
    for (let x = 0; x < plant.w; x++)
      if (plant.m[y * plant.w + x]) { colN[x]++; rowN[y]++; }
  const span = (arr, min) => {
    let lo = -1, hi = -1;
    for (let i = 0; i < arr.length; i++) if (arr[i] >= min) { if (lo < 0) lo = i; hi = i; }
    return { lo, hi, n: hi - lo + 1 };
  };
  const cw = span(colN, 3), ch = span(rowN, 3);

  const d = edt(wood.m, wood.w, wood.h);
  const widths = [];
  let wmax = 0, wmaxAt = [0, 0];
  for (let y = 0; y < wood.h; y++) {
    for (let x = 0; x < wood.w; x++) {
      const i = y * wood.w + x;
      if (!wood.m[i]) continue;
      const wpx = d[i] * 2;
      widths.push(wpx);
      if (wpx > wmax) { wmax = wpx; wmaxAt = [x, y]; }
    }
  }
  widths.sort((a, b) => a - b);
  const q = (p) => widths[Math.min(widths.length - 1, Math.floor(p * widths.length))];

  console.log(`\nwoody members as drawn, view "${VIEW}" at ${W}x${H}\n`);
  console.log(`  woody pixels     ${widths.length}`);
  console.log(`  local width      median ${q(0.5).toFixed(1)} px   p90 ${q(0.9).toFixed(1)} px` +
              `   max ${wmax.toFixed(1)} px  at (${wmaxAt[0]}, ${wmaxAt[1]})`);
  console.log(`  crown silhouette ${cw.n} px wide, ${ch.n} px tall` +
              `   (x ${cw.lo}..${cw.hi}, y ${ch.lo}..${ch.hi})`);
  console.log(`\n  thickest member / crown width   1 : ${(cw.n / wmax).toFixed(1)}` +
              `      want about 1 : 4`);
  console.log(`  thickest / median member        ${(wmax / q(0.5)).toFixed(1)} : 1` +
              `      one-gauge scrub is near 6 : 1`);

});

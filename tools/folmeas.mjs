/* Measure the plant cutouts' colour off the albedo itself, not off a frame.
 *
 * The light rig and the atmosphere are both being corrected concurrently, so any
 * colour measured through them is partly a measurement of somebody else's
 * in-flight work — and an additive haze pedestal crushes HSV saturation, so a
 * frame reads lower-chroma than the texture that produced it. This opens the
 * atlases in a page, with no scene and no renderer, and reads the canvas.
 *
 * Only pixels the alpha test will keep are counted, weighted by alpha: the
 * dilated fill outside the mask exists to stop mip bleed, not to be seen, and
 * averaging it in drags the result toward the fill colour. Hue is averaged as a
 * unit vector, since it is an angle.
 *
 *   node tools/folmeas.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    /* Same import map as index.html, so plantex's bare `three` specifier
       resolves. Nothing else from the page is needed — there is no renderer
       here and no scene, only the 2D canvases the atlases are drawn on. */
    res.end(`<!doctype html><meta charset=utf-8>
<script type="importmap">{"imports":{
 "three":"/node_modules/three/build/three.module.js",
 "three/addons/":"/node_modules/three/examples/jsm/",
 "three/":"/node_modules/three/"}}</script><body>`);
    return;
  }
  const f = path.join(DIR, p);
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const dump = process.argv.includes('--dump');
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/`);

const rows = await page.evaluate(async ([port, dump]) => {
  const m = await import(`http://127.0.0.1:${port}/src/plantex.js`);

  const hsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    return [h < 0 ? h + 360 : h, mx ? d / mx : 0, mx];
  };

  const one = (name, tex, gate) => {
    /* Some of these factories hand back a texture and some hand back a
       { map, normalMap } pair, so take whichever carries the albedo. */
    const t = tex && tex.image ? tex : (tex.map || tex.albedo);
    const cv = t.image;
    /* Level 0 is an ImageData when the texture ships a hand-built mip chain, and
       a canvas when it does not. */
    let data;
    if (cv.data) {
      data = cv.data;
    } else {
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(cv, 0, 0);
      data = ctx.getImageData(0, 0, c.width, c.height).data;
    }
    let hx = 0, hy = 0, s = 0, v = 0, w = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < gate) continue;
      const [hh, ss, vv] = hsv(data[i], data[i + 1], data[i + 2]);
      if (vv < 0.04) continue;
      const rad = hh * Math.PI / 180;
      hx += Math.cos(rad) * a; hy += Math.sin(rad) * a;
      s += ss * a; v += vv * a; w += a; n++;
    }
    let h = Math.atan2(hy, hx) * 180 / Math.PI;
    if (h < 0) h += 360;
    return { name, px: n, size: `${cv.width}x${cv.height}`,
             hue: h, sat: s / w, val: v / w };
  };

  if (dump) {
    /* Composited over mid-grey, because the thing being judged is the *silhouette*
       and a cutout on a checkerboard or on black tells you much less about
       whether an edge reads as stipple or as a leaf outline. */
    const grab = (name, tex) => {
      const t = tex && tex.image ? tex : (tex.map || tex.albedo);
      const cv = t.image;
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#787878';
      ctx.fillRect(0, 0, c.width, c.height);
      if (cv.data) {
        const id = new ImageData(new Uint8ClampedArray(cv.data), cv.width, cv.height);
        const tmp = document.createElement('canvas');
        tmp.width = cv.width; tmp.height = cv.height;
        tmp.getContext('2d').putImageData(id, 0, 0);
        ctx.drawImage(tmp, 0, 0);
      } else {
        ctx.drawImage(cv, 0, 0);
      }
      return { name, url: c.toDataURL('image/png') };
    };
    return [grab('foliage', m.foliageTex()), grab('grass', m.grassTex()),
            grab('scrub', m.scrubTex())];
  }

  return [
    one('foliage', m.foliageTex(), 0.55),
    one('grass', m.grassTex(), 0.45),
    one('scrub', m.scrubTex(), 0.45),
    one('succulent', m.succTex(), 0.45),
  ];
}, [port, dump]);

if (dump) {
  for (const r of rows) {
    const f = path.join(DIR, 'shots', `atlas_${r.name}.png`);
    fs.writeFileSync(f, Buffer.from(r.url.split(',')[1], 'base64'));
    console.log(`wrote ${f}`);
  }
  await browser.close();
  srv.close();
  process.exit(0);
}

console.log('measured off the albedo, alpha-weighted, above the alpha test');
console.log('target for juniper foliage: hue 64-68, sat 0.63, low value\n');
console.log('name      atlas      kept px     hue    sat    val');
for (const r of rows) {
  console.log(`${r.name.padEnd(9)} ${r.size.padEnd(10)} ${String(r.px).padStart(8)}  ` +
    `${r.hue.toFixed(1).padStart(6)}  ${r.sat.toFixed(3)}  ${r.val.toFixed(3)}`);
}

await browser.close();
srv.close();

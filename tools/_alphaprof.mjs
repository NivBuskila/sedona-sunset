/* Histogram of a plant atlas's alpha channel at mip 0.
 *
 *   node tools/_alphaprof.mjs
 *
 * Alpha in these atlases is meant to carry optical thickness — full along a
 * blade's spine, tapering to the cutoff at its edges — because the shader's
 * cross-blade shading takes the screen-space gradient of alpha as its only
 * cross-width coordinate. If alpha is instead binary, that gradient is zero
 * across a blade's interior and the shading term silently does nothing, which is
 * indistinguishable in a frame from the term being wrongly tuned. This separates
 * the two in a second and without a render.
 *
 * What you want to see is population in the middle bins. Two spikes at 0 and 255
 * means the profile is not there.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.js': 'text/javascript', '.html': 'text/html' };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
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

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/`);

const rows = await page.evaluate(async (port) => {
  const m = await import(`http://127.0.0.1:${port}/src/plantex.js`);
  const one = (name, tex) => {
    const im = tex.image;
    const d = im.data;
    const bins = new Array(8).fill(0);
    let n = 0;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i];
      if (a === 0) continue;                 // outside the cutout entirely
      bins[Math.min(7, (a / 32) | 0)]++; n++;
    }
    return { name, w: im.width, h: im.height, n, bins };
  };
  return [one('grass', m.grassTex()), one('scrub', m.scrubTex())];
}, port);

for (const r of rows) {
  console.log(`\n${r.name}  ${r.w}x${r.h}   ${r.n} texels with any alpha`);
  r.bins.forEach((c, i) => {
    console.log(`  alpha ${String(i * 32).padStart(3)}-${String(i * 32 + 31).padStart(3)}`
      + `  ${String(c).padStart(7)}  ${(100 * c / r.n).toFixed(1).padStart(5)}%  `
      + '#'.repeat(Math.round(60 * c / r.n)));
  });
}
await browser.close();
srv.close();

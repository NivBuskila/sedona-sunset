/* Does any shrub card's UV window land wholly inside opaque atlas content?
 *
 *   node tools/_uvsolid.mjs
 *
 * A delivery critic found "a 5.6x darkening bounded by a dead-straight,
 * screen-axis-aligned horizontal line" under the shrub clump in `bend`, cutting
 * through open air between blades. Ablation named `veg-shrub-b` as the owner, so
 * it is a card of that geometry drawing as a solid quad rather than a cutout.
 *
 * The suspect is the uvFit window added to cardTuft to stop a portrait atlas cell
 * being stretched across a landscape card. It matches the card's aspect by
 * shrinking one axis of the cell and then placing the window at a random offset.
 * For the widest shrub shape -- a 2.48:1 card against a 1:2 cell -- that window
 * is the full cell width and about a fifth of its height. A band that thin,
 * placed in the dense middle of a drawn plant, can contain no transparent texels
 * at all, and a card with no transparent texels is a quad.
 *
 * This reproduces cardTuft's window arithmetic against the real atlas, with the
 * real seeds, and reports the opaque fraction of every shrub card's window. No
 * renderer and no scene, so it costs a few seconds and does not touch the
 * capture lock -- the same trick tools/folmeas.mjs uses to measure atlases.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

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

const out = await page.evaluate(async (port) => {
  const noise = await import(`http://127.0.0.1:${port}/src/noise.js`);
  const jun = await import(`http://127.0.0.1:${port}/src/juniper.js`);
  const px = await import(`http://127.0.0.1:${port}/src/plantex.js`);

  /* Level 0 of the scrub atlas as raw RGBA. */
  const tex = px.scrubTex();
  const t = tex && tex.image ? tex : (tex.map || tex.albedo);
  let img = t.image;
  if (t.mipmaps && t.mipmaps.length) img = t.mipmaps[0];
  let data, W, H;
  if (img.data) { data = img.data; W = img.width; H = img.height; }
  else {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    data = d.data; W = d.width; H = d.height;
  }

  /* Exactly src/vegetation.js's SHRUB_SHAPES and shrubGeo seeds. */
  const SHAPES = [
    { lo: [0.95, 1.00, 5], hi: [0.70, 0.78, 3], lift: 0.09 },
    { lo: [1.34, 0.54, 7], hi: [0.92, 0.40, 3], lift: 0.04 },
    { lo: [0.66, 1.34, 4], hi: [0.48, 1.02, 3], lift: 0.22 },
  ];

  /* The shader's opacity test, as built: diffuseColor.a is min(1, a/uThickFloor)
     and is compared against alphaTest, so a texel is drawn when
     a > alphaTest * uThickFloor. */
  const ALPHA_TEST = 0.42, THICK_FLOOR = 0.62;
  const OPAQUE = ALPHA_TEST * THICK_FLOOR * 255;

  const rows = [];
  /* uvFit 0.5 is as built; 0 is what cardTuft did before the aspect fix, namely
     the whole cell. The cell's outer margin is near-empty, so the two differ in
     exactly the way that matters here: whether a card's bottom edge falls on
     drawn content or on empty canvas. */
  for (const UVFIT of [0.5, 0]) SHAPES.forEach((s, si) => {
    const rand = noise.rng(1002 + si * 71);
    const arr = { pos: [], nrm: [], uvs: [], idx: [] };
    const mark = [];
    for (const [tier, cy, spec] of [['lo', 0, s.lo], ['hi', s.lift, s.hi]]) {
      const before = arr.uvs.length / 2;
      jun.cardTuft(0, cy, 0, spec[0], spec[1], spec[2], rand, arr, 2, 1, UVFIT);
      mark.push({ tier, before, after: arr.uvs.length / 2, w: spec[0], h: spec[1] });
    }
    for (const m of mark) {
      for (let v = m.before; v < m.after; v += 4) {
        let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
        for (let q = 0; q < 4; q++) {
          const u = arr.uvs[(v + q) * 2], vv = arr.uvs[(v + q) * 2 + 1];
          u0 = Math.min(u0, u); u1 = Math.max(u1, u);
          v0 = Math.min(v0, vv); v1 = Math.max(v1, vv);
        }
        /* three samples with v up, the canvas is stored with y down. */
        const x0 = Math.floor(u0 * W), x1 = Math.ceil(u1 * W);
        const yA = Math.floor((1 - v1) * H), yB = Math.ceil((1 - v0) * H);
        let n = 0, op = 0, sum = 0;
        for (let y = Math.max(0, yA); y < Math.min(H, yB); y++)
          for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
            const a = data[(y * W + x) * 4 + 3];
            n++; sum += a;
            if (a > OPAQUE) op++;
          }
        /* The bottom edge specifically. Every card in a tuft has its bottom
           vertices at the same local y, so all their bottom edges land on one
           screen row; whatever each contributes there is unioned with the rest.
           A card whose bottom row of texels is transparent fades out before its
           edge and contributes nothing to that row. */
        let bn = 0, bop = 0;
        const yBot = Math.min(H, yB);
        for (let y = Math.max(0, yBot - 3); y < yBot; y++)
          for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
            const a = data[(y * W + x) * 4 + 3];
            bn++;
            if (a > OPAQUE) bop++;
          }
        rows.push({
          uvfit: UVFIT, shape: si, tier: m.tier, card: (v - m.before) / 4,
          uw: +(u1 - u0).toFixed(3), vh: +(v1 - v0).toFixed(3),
          texels: n, opaque: n ? +(op / n).toFixed(4) : 0,
          meanA: n ? +(sum / n / 255).toFixed(3) : 0,
          botOpaque: bn ? +(bop / bn).toFixed(4) : 0,
        });
      }
    }
  });
  return { W, H, opaqueThreshold: OPAQUE / 255, rows };
}, port);

await browser.close();
srv.close();

console.log(`scrub atlas ${out.W}x${out.H}; a texel draws when alpha > `
  + `${out.opaqueThreshold.toFixed(3)}`);
console.log('bottom-3-rows coverage is what lands on the tuft\'s single shared base line.\n');
for (const uv of [0.5, 0]) {
  const rs = out.rows.filter(r => r.uvfit === uv);
  console.log(`uvFit ${uv.toFixed(2)}${uv === 0.5 ? '  (as built)' : '  (whole cell, before the aspect fix)'}`);
  console.log('  shape tier card   uv window     opaque frac   bottom rows');
  for (const r of rs) {
    console.log(`  ${r.shape}     ${r.tier}   ${String(r.card).padStart(2)}`
      + `   ${r.uw.toFixed(3)}x${r.vh.toFixed(3)}  ${r.opaque.toFixed(4).padStart(11)}`
      + `  ${r.botOpaque.toFixed(4).padStart(12)}`);
  }
  /* Union across the cards that share a base line, treating cards as
     independent: with ten cards each covering a fifth of the line, the line is
     nearly solid, which is the reported artefact. */
  for (const tier of ['lo', 'hi']) {
    for (const sh of [0, 1, 2]) {
      const g = rs.filter(r => r.tier === tier && r.shape === sh);
      if (!g.length) continue;
      const un = 1 - g.reduce((p, r) => p * (1 - r.botOpaque), 1);
      console.log(`    shape ${sh} tier ${tier}: ${g.length} cards share one base line;`
        + ` union of their bottom rows ${(un * 100).toFixed(1)}%`);
    }
  }
  console.log('');
}

/* What the brightest radiance in the frame actually is, and where.
 *
 * System 7's bright pass found a +Inf in the scene buffer: RGBA16F tops out at
 * 65504, ACES clamps Inf to white so nothing upstream ever saw it, and then a
 * divide by luminance turned Inf/Inf into NaN and two separable blurs turned one
 * texel into a rectangle. The guard is in; the value is still there.
 *
 * This renders the scene into its own float target and scans it on the CPU, so
 * the number is read rather than inferred. It bypasses System 5's shimmer
 * composite and System 7's chain, which is the point — if the extreme value is
 * here, it is a material or the sky dome; if it is not, it is one of those two
 * passes.
 *
 *   node tools/hdrmax.mjs                    # wash_mid, where the rectangle was
 *   node tools/hdrmax.mjs 46 0 0 --sky-off   # bisect: same view, no sky dome
 */
import { run } from './harness.mjs';

const a = process.argv.slice(2);
const skyOff = a.includes('--sky-off');
const bisect = a.includes('--bisect');
const gi = a.indexOf('--geom');
const geom = gi >= 0 ? (a[gi + 1] && !a[gi + 1].startsWith('--') ? a[gi + 1] : '*') : null;
const num = a.filter((x) => !x.startsWith('--') && x !== geom).map(Number);
const [d = 46, yaw = 0, pitch = 0] = num;

await run({ width: 800, height: 450 }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const out = await page.evaluate(([d, yaw, pitch, skyOff, bisect, geom]) => {
    const g = window.__game;
    g.walkTo(d); g.lookAt(yaw, pitch);
    const r = g.renderer, scene = g._scene, cam = g._camera;

    const hidden = [];
    if (skyOff) {
      scene.traverse((o) => { if (o.name === 'sky' && o.visible) { o.visible = false; hidden.push(o); } });
    }

    const countNaN = () => {
      g.renderOnce();
      const t = g._post._diag.sceneRT;
      const b = new Uint16Array(t.width * t.height * 4);
      r.readRenderTargetPixels(t, 0, 0, t.width, t.height, b);
      let n = 0;
      /* exponent all ones with a non-zero mantissa is NaN; this needs no decode */
      for (let i = 0; i < b.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const h = b[i + k];
          if (((h >> 10) & 0x1f) === 0x1f && (h & 0x3ff) !== 0) n++;
        }
      }
      return n;
    };

    if (geom) {
      const rows = [];
      scene.traverse((o) => {
        if (!o.geometry || (geom !== '*' && !(o.name || '').includes(geom))) return;
        const g2 = o.geometry, rep = { name: o.name, type: o.type, attrs: {} };
        for (const [key, at] of Object.entries(g2.attributes)) {
          const arr = at.array;
          let bad = 0, first = -1;
          for (let i = 0; i < arr.length; i++) {
            if (!Number.isFinite(arr[i])) { bad++; if (first < 0) first = i; }
          }
          const e = { bad, first, count: at.count, items: at.itemSize };
          if (key === 'normal' && at.itemSize === 3) {
            let zero = 0;
            for (let i = 0; i < arr.length; i += 3) {
              if (arr[i] === 0 && arr[i + 1] === 0 && arr[i + 2] === 0) zero++;
            }
            e.zeroLengthNormals = zero;
          }
          if (bad || e.zeroLengthNormals) rep.attrs[key] = e;
        }
        /* Degenerate triangles: two vertices at the same position give a
           zero-area face, and a normal derived from its cross product is
           normalize(vec3(0)) — NaN, on exactly the pixels the face covers. */
        const pos = g2.attributes.position, idx = g2.index;
        if (pos && idx) {
          let degen = 0;
          const p = pos.array, ix = idx.array;
          const same = (a, b) => p[a * 3] === p[b * 3] && p[a * 3 + 1] === p[b * 3 + 1] && p[a * 3 + 2] === p[b * 3 + 2];
          for (let i = 0; i + 2 < ix.length; i += 3) {
            const [a, b, c] = [ix[i], ix[i + 1], ix[i + 2]];
            if (a === b || b === c || a === c || same(a, b) || same(b, c) || same(a, c)) degen++;
          }
          if (degen) rep.degenerateTriangles = { degen, of: ix.length / 3 };
        }
        if (Object.keys(rep.attrs).length || rep.degenerateTriangles) rows.push(rep);
      });
      return { geom: true, rows };
    }

    if (bisect) {
      const base = countNaN();
      const rows = [];
      for (const child of scene.children.slice()) {
        if (!child.visible) continue;
        child.visible = false;
        const n = countNaN();
        child.visible = true;
        if (n !== base) {
          rows.push({ name: child.name || child.type, id: child.id, nan: n, base });
        }
      }
      return { bisect: true, base, rows, kids: scene.children.map((c) => c.name || c.type) };
    }

    /* No `import('three')` here. The module is loaded through an import map and
       a dynamic import inside an evaluate context hangs rather than throwing,
       which cost seven minutes of wall clock. Everything needed is reachable
       from a live object or is a numeric enum. */
    /* The app's own scene buffer, after System 5's composite and before System
       7's chain — exactly what the bright pass divides by luminance. renderOnce
       fills it; reading it needs no target of our own and no `three` import. */
    g.renderOnce();
    const rt = g._post._diag.sceneRT;
    if (!rt) return { err: 'post._diag.sceneRT is null — is the chain enabled?' };
    const size = { x: rt.width, y: rt.height };

    const buf = new Uint16Array(size.x * size.y * 4);
    r.readRenderTargetPixels(rt, 0, 0, size.x, size.y, buf);

    /* half -> float, by hand: readRenderTargetPixels hands back the raw bits for
       a HalfFloatType target and Uint16Array is the only buffer it accepts. */
    const h2f = (h) => {
      const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
      if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
      if (e === 31) return f ? NaN : s * Infinity;
      return s * Math.pow(2, e - 15) * (1 + f / 1024);
    };

    let max = -Infinity, mx = 0, my = 0, nInf = 0, nNaN = 0, nOver = 0;
    const hot = [];
    for (let i = 0; i < buf.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const v = h2f(buf[i + k]);
        if (Number.isNaN(v)) {
          nNaN++;
          if (hot.length < 16) {
            const p = i / 4;
            hot.push({ x: p % size.x, y: size.y - 1 - Math.floor(p / size.x), ch: 'rgb'[k], v: 'NaN' });
          }
          continue;
        }
        if (!Number.isFinite(v)) {
          nInf++;
          if (hot.length < 12) {
            const p = i / 4;
            hot.push({ x: p % size.x, y: size.y - 1 - Math.floor(p / size.x), ch: 'rgb'[k], v: 'Inf' });
          }
          continue;
        }
        if (v > 1000) nOver++;
        if (v > max) { max = v; mx = (i / 4) % size.x; my = size.y - 1 - Math.floor((i / 4) / size.x); }
      }
    }
    for (const o of hidden) o.visible = true;
    return { w: size.x, h: size.y, max, mx, my, nInf, nNaN, nOver, hot,
      total: size.x * size.y };
  }, [d, yaw, pitch, skyOff, bisect, geom]);

  if (out.err) { console.log('probe failed:', out.err); return; }
  if (out.geom) {
    if (!out.rows.length) console.log('\nno non-finite attribute data and no degenerate faces');
    for (const r of out.rows) console.log(`\n${r.name} (${r.type})\n  ` +
      JSON.stringify({ ...r.attrs, degenerateTriangles: r.degenerateTriangles }, null, 2).replace(/\n/g, '\n  '));
    return;
  }
  if (out.bisect) {
    console.log(`\nNaN channels with everything visible: ${out.base}`);
    console.log(`scene children: ${out.kids.join(', ')}`);
    if (!out.rows.length) console.log('no single top-level child accounts for it');
    for (const r of out.rows) console.log(`  hiding ${r.name} (id ${r.id}) -> ${r.nan} NaN`);
    return;
  }
  console.log(`\n${out.w}x${out.h}  d=${d} yaw=${yaw} pitch=${pitch}${skyOff ? '  [sky dome hidden]' : ''}`);
  console.log(`  finite max      ${out.max.toExponential(4)}  at (${out.mx}, ${out.my}) from top-left`);
  console.log(`  +Inf channels   ${out.nInf}`);
  console.log(`  NaN channels    ${out.nNaN}`);
  console.log(`  channels >1000  ${out.nOver}  of ${out.total * 3}`);
  if (out.hot.length) console.log('  bad texels:', JSON.stringify(out.hot));
  if (errs.length) console.log('  page errors:', errs.slice(0, 4));
});

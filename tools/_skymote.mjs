/* Find isolated warm dots sitting in open sky, and print them as normalised
 * coordinates ready for tools/_pixowner.mjs.
 *
 *   node tools/_skymote.mjs shots/sys7deliverpx_juniper.png
 *
 * A delivery critic reported "isolated 1-2px saturated orange and olive dots
 * sitting in empty blue sky, hard-edged, no falloff, disconnected from any
 * geometry", counted 13 in `juniper` and about 15 in `wash_mid`, and called it
 * the single most unambiguous not-a-photograph signal in the set.
 *
 * Their coordinates are quoted at 2560x1440 and the delivery frames are
 * 1997x1123, so a coordinate taken literally lands 22% off and samples clean
 * sky — which is exactly what happened on the first attempt here. Hence a
 * detector rather than a coordinate: it finds the population itself, at whatever
 * resolution the frame happens to be, and reports where they actually are.
 *
 * The test is local rather than global. A dot is warm against its own
 * surroundings, and its surroundings are sky. Nothing here assumes where the
 * horizon is, because the skyline in these framings is butte and wall rather
 * than a line, and every horizon heuristic tried on this project has produced
 * fiction — one of them put the horizon hundreds of rows into the sky and
 * reported sunlit sandstone at L 0.924 against a true 0.687.
 */
import fs from 'node:fs';
import { decode } from './png.mjs';

/* Sky, judged per pixel rather than per frame: this sky runs from a pale warm
   aureole near the sun to a deeper blue overhead, so a fixed colour will not do.
   Blue over red is the property that survives across all of it, and rock in
   these framings is strongly the other way. */
const isSky = (r, g, b) => b - r > 4 && b > 110;
const isWarm = (r, g, b) => r - b > 25;

export function findMotes(a) {
  const { w, h, ch, px } = a;
  const at = (x, y) => {
    const i = (y * w + x) * ch;
    return [px[i], px[i + 1], px[i + 2]];
  };

  /* Ring at radius 4 and 6, sixteen taps. A mote is 1-2 px, so radius 4 clears
     it; keeping two radii rejects the tip of a branch, which is warm and has
     sky on three sides but not on a whole ring at two radii. */
  const RING = [];
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2;
    for (const rad of [4, 6]) RING.push([Math.round(Math.cos(t) * rad), Math.round(Math.sin(t) * rad)]);
  }

  const flag = new Uint8Array(w * h);
  for (let y = 7; y < h - 7; y++) {
    for (let x = 7; x < w - 7; x++) {
      const [r, g, b] = at(x, y);
      if (!isWarm(r, g, b)) continue;
      let sky = 0;
      for (const [dx, dy] of RING) {
        const [rr, gg, bb] = at(x + dx, y + dy);
        if (isSky(rr, gg, bb)) sky++;
      }
      if (sky >= RING.length * 0.85) flag[y * w + x] = 1;
    }
  }

  /* Cluster, 8-connected, so a 2px dot is reported once. */
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let i = 0; i < w * h; i++) {
    if (!flag[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const cells = [];
    while (stack.length) {
      const j = stack.pop();
      cells.push(j);
      const cx = j % w, cy = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (flag[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    let sx = 0, sy = 0, best = -1, bc = null;
    for (const j of cells) {
      const cx = j % w, cy = (j / w) | 0;
      sx += cx; sy += cy;
      const c = at(cx, cy);
      const sat = c[0] - c[2];
      if (sat > best) { best = sat; bc = c; }
    }
    const n = cells.length;
    out.push({ x: Math.round(sx / n), y: Math.round(sy / n), n, c: bc });
  }

  out.sort((p, q) => q.n - p.n);
  return out;
}

/* Saturation splits the population, and it turned out to matter: the critic
   described "saturated orange and olive" dots and sampled one at (160,126,18),
   while the atmosphere's own dust was described by its author as warm-white.
   Two families in one detector's output are two findings. */
export const SATURATED = (m) => m.c[0] - m.c[2] > 90;

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length) {
  for (const f of files) {
    const a = decode(fs.readFileSync(f));
    const out = findMotes(a);
    console.log(`\n${f}  ${a.w}x${a.h}`);
    console.log(`  ${out.length} isolated warm dots in open sky,`
      + ` ${out.filter(SATURATED).length} of them strongly saturated`);
    for (const m of out) {
      console.log(`    (${String(m.x).padStart(4)},${String(m.y).padStart(4)})  ${m.n}px`
        + `  rgb(${m.c.join(',')})${SATURATED(m) ? '  SAT' : ''}`
        + `   --at ${(m.x / a.w).toFixed(4)},${(m.y / a.h).toFixed(4)}`);
    }
  }
}

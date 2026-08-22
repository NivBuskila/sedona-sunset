/* How straight is the skyline, measured on the frame a critic actually sees.
 *
 *   node tools/_skyline.mjs shots/sys3rim_shade_far.png
 *   node tools/_skyline.mjs shots/a.png shots/b.png --win 200
 *
 * The critic's finding on `shade_far` was "geometrically straight to within a
 * pixel and a half over hundreds of pixels", and that is a statement about the
 * rendered image, so this measures the rendered image. Per column, the topmost
 * non-sky pixel; then over every sliding window of `--win` columns, a
 * least-squares line through that boundary and the maximum absolute residual.
 * Small residual over a wide window is the defect, and the slope is irrelevant —
 * a rising ruler reads as artificial exactly as a level one does, which is the
 * trap that `tools/_skyveg.mjs` fell into by looking for *flat* runs and finding
 * this edge unremarkable.
 *
 * Independent of `src/` by construction, which is why it exists in this form: the
 * node-side verifier imports `terrain.js` and was unusable for a stretch while
 * another agent's in-flight edit left that file unparseable. A tool that reads
 * only a PNG cannot be blocked by anyone else's working copy.
 *
 * Sky is taken as blue >= red. On this palette that is true of sky and of nothing
 * else — rock runs B/G 0.32-0.90 with blue well under red — with one exception
 * worth knowing: the solar aureole is warm and reads as not-sky. Framings that
 * put the sun in shot will therefore start their profile below the aureole rather
 * than at the true horizon, so the columns it covers are reported and should be
 * discounted rather than trusted.
 */
import fs from 'node:fs';
import { decode } from './png.mjs';

const argv = process.argv.slice(2);
const wi = argv.indexOf('--win');
const WIN = wi >= 0 ? +argv[wi + 1] : 200;
/* Skip the flag *and its value*. The first version filtered on a leading `--`
   only, so `--win 200` left "200" in the file list and the tool went looking for
   a PNG called 200 after printing perfectly good results — a non-zero exit on a
   successful run, which is the kind of thing that gets a working tool distrusted. */
const files = argv.filter((a, i) => !a.startsWith('--') && !(wi >= 0 && i === wi + 1));
if (!files.length) {
  console.error('_skyline: give at least one PNG');
  process.exit(2);
}

for (const f of files) {
  if (!fs.existsSync(f)) { console.error(`_skyline: no such file ${f}`); process.exit(2); }
  const { w: W, h: H, ch, px: data } = decode(fs.readFileSync(f));

  /* Topmost non-sky pixel per column. Columns whose whole height is sky, and
     columns with no sky at all, are both excluded — the first has no skyline in
     it and the second is looking at a wall that fills the frame. */
  const top = new Array(W).fill(-1);
  let noSky = 0;
  for (let x = 0; x < W; x++) {
    let sawSky = false;
    for (let y = 0; y < H; y++) {
      const s = (y * W + x) * ch;
      const R = data[s], B = data[s + 2];
      if (B >= R) { sawSky = true; continue; }
      if (sawSky) { top[x] = y; break; }
      break;                       // rock at the very top row: no skyline here
    }
    if (!sawSky) noSky++;
  }

  const valid = [];
  for (let x = 0; x < W; x++) if (top[x] >= 0) valid.push(x);

  /* Sliding windows over runs of contiguous valid columns. A window that spans a
     gap would fit a line across two different skylines. */
  const runs = [];
  let s0 = null;
  for (let x = 0; x < W; x++) {
    if (top[x] >= 0) { if (s0 === null) s0 = x; }
    else if (s0 !== null) { runs.push([s0, x - 1]); s0 = null; }
  }
  if (s0 !== null) runs.push([s0, W - 1]);

  const wins = [];
  for (const [a, b] of runs) {
    for (let i = a; i + WIN - 1 <= b; i += 4) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      const n = WIN;
      for (let x = i; x < i + WIN; x++) {
        sx += x; sy += top[x]; sxx += x * x; sxy += x * top[x];
      }
      const den = n * sxx - sx * sx;
      if (Math.abs(den) < 1e-9) continue;
      const m = (n * sxy - sx * sy) / den, c = (sy - m * sx) / n;
      let worst = 0, rms = 0;
      for (let x = i; x < i + WIN; x++) {
        const r = top[x] - (m * x + c);
        worst = Math.max(worst, Math.abs(r));
        rms += r * r;
      }
      wins.push({ x0: i, x1: i + WIN - 1, worst, rms: Math.sqrt(rms / n), slope: m,
        y0: top[i], y1: top[i + WIN - 1] });
    }
  }
  wins.sort((p, q) => p.worst - q.worst);

  console.log(`\n${f}   ${W}x${H}`);
  console.log(`  ${valid.length} of ${W} columns carry a skyline` +
    `, ${noSky} have no sky above them`);
  if (!wins.length) { console.log('  no window of ' + WIN + ' contiguous columns'); continue; }
  console.log(`  straightest windows of ${WIN} columns, by worst residual:`);
  console.log('     columns        worst    rms   slope     rows');
  /* One row per distinct edge rather than six overlapping views of the same one:
     windows are stepped four columns apart, so the top of a sorted list is the
     same edge six times over and says nothing about the second-worst place. */
  const shown = [];
  for (const w of wins) {
    if (shown.some((s) => w.x0 <= s.x1 && w.x1 >= s.x0)) continue;
    shown.push(w);
    if (shown.length >= 5) break;
  }
  for (const w of shown)
    console.log(`    ${String(w.x0).padStart(5)}-${String(w.x1).padEnd(5)}` +
      `  ${w.worst.toFixed(2).padStart(6)} px ${w.rms.toFixed(2).padStart(6)}` +
      `  ${w.slope.toFixed(3).padStart(7)}   ${w.y0}-${w.y1}`);
  const q = wins[Math.floor(wins.length / 2)];
  console.log(`  median window worst residual ${q.worst.toFixed(2)} px` +
    `   (a straight edge scores near 0; the finding was 1.5 px)`);
}

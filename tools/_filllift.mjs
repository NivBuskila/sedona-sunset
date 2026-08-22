/* Did the fill lift do what it was supposed to do, and did it cost the lit surfaces?
 *
 *   node tools/_filllift.mjs <tag> [<baseline-tag>]
 *   node tools/_filllift.mjs s2m sys7final
 *
 * Three questions decide whether the critic's number one finding is closed, and one of
 * them is a trap.
 *
 * The trap is the headline saturation figure. Scene-linear analysis says the same rock
 * face reflecting fill instead of sun should sit at **0.468 saturation against 0.785
 * sunlit**, and the delivered build was returning roughly 0.63 for both - shade as
 * saturated as light, which is the wrong answer. But 40.8% of `wall_shade` has its
 * minimum channel under 10 code values, and **HSV saturation is (max-min)/max, which
 * near black reports the encoder rather than the light**: a pixel at R=20 B=1 reads 0.95
 * whatever illuminant made it, because blue has run out of code values.
 *
 * So a fill lift can move the headline saturation *without changing any chroma at all*,
 * purely by lifting pixels off the quantisation floor where their saturation was being
 * overstated. That is a real improvement in the picture and a fake one in the transport.
 * The two are told apart by measuring the same window twice:
 *
 *   **all**       every pixel in the window - comparable to the 0.63 that was delivered
 *   **headroom**  only pixels whose minimum channel is >= 10 cv, where (max-min)/max is
 *                 reporting the light and not the floor
 *
 * If the headroom subset falls toward 0.468, the fill genuinely got greyer and the
 * finding is closed. If only **all** falls while **headroom** sits still, the lift moved
 * pixels across the threshold and the chroma is untouched - worth having, but it does not
 * answer the critic. Hence every saturation here is printed with the crush fraction
 * beside it and the subset size under it, because a saturation without its clipped
 * fraction is the same error as a hue angle without its chroma magnitude.
 *
 * The guardrail matters as much as the fix. The occlusion change is an exact identity
 * only at full visibility, so a sunlit pixel at 0.8 visibility does take slightly more
 * indirect light: lit rock must hold 0.618 saturation and 20.9 degrees hue.
 *
 * Two scope rules, both of which this tool got wrong on its first run and both of which
 * have burned this project before. **The lit targets are stated on the brightest 40% of
 * the window** with crushed pixels dropped, which is what `sat.mjs --lit` measures; the
 * same `wall_lit` crop reads 0.687 whole and 0.63 lit, so a whole-window figure quoted
 * against 0.618 invents a regression that is not there. And **the 40.8% crush figure is
 * whole-frame**, not the rock crop - the crop reads 72%, which is a different true fact
 * about a smaller thing. Quote the population with the number, every time.
 */
import { readFileSync, existsSync } from 'node:fs';
import { decode } from './png.mjs';

const [tag, base] = process.argv.slice(2);
if (!tag) { console.log('usage: node tools/_filllift.mjs <tag> [<baseline-tag>]'); process.exit(1); }

/* Windows are the ones sat.mjs and hue.mjs already use, so figures here are directly
 * comparable to every reading in CONTRACT.md rather than a new crop nobody can check. */
const WINDOWS = [
  ['wall_shade', 'rock shade',  [0.30, 0.24, 0.34, 0.34], { sat: 0.468, crush: true }],
  ['wall_lit',   'rock lit',    [0.30, 0.24, 0.34, 0.34], { sat: 0.618, hue: 20.9, lit: true }],
  ['shade_far',  'floor shade', [0.58, 0.66, 0.34, 0.28], { crush: true }],
  ['shade_far',  'floor lit',   [0.04, 0.74, 0.22, 0.20], { lit: true }],
];

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; h = ((h % 360) + 360) % 360; if (h > 180) h -= 360;
  }
  return [h, mx > 1e-9 ? d / mx : 0, mx];
};

/* Crush is a whole-frame figure so it compares with the 40.8% in CONTRACT.md. */
function crush(file) {
  if (!existsSync(file)) return null;
  const img = decode(readFileSync(file));
  let n = 0, loMin = 0, loLum = 0, allBlack = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const j = i * img.ch;
    const R = img.px[j], G = img.px[j + 1], B = img.px[j + 2];
    n++;
    if (Math.min(R, G, B) < 10) loMin++;
    if (0.2126 * R + 0.7152 * G + 0.0722 * B < 10) loLum++;
    if (Math.max(R, G, B) <= 1) allBlack++;
  }
  return { loMin: 100 * loMin / n, loLum: 100 * loLum / n, black: 100 * allBlack / n };
}

function measure(file, win, spec) {
  if (!existsSync(file)) return null;
  const img = decode(readFileSync(file));
  const x0 = Math.round(img.w * win[0]), y0 = Math.round(img.h * win[1]);
  const x1 = Math.min(img.w, x0 + Math.round(img.w * win[2]));
  const y1 = Math.min(img.h, y0 + Math.round(img.h * win[3]));

  const px = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.w + x) * img.ch;
    const R = img.px[i], G = img.px[i + 1], B = img.px[i + 2];
    px.push({ R, G, B, mn: Math.min(R, G, B), mx: Math.max(R, G, B) });
  }

  /* Lit targets are stated on the brightest 40% with mx < 12 dropped - the population
     sat.mjs --lit selects. Shade is measured whole, because selecting the darkest 40%
     of a shade window is the retired instrument: it self-selects the crushed pixels and
     then quotes their quantisation as though it were the fill's colour. */
  const stat = (list) => {
    let n = 0, s = 0, v = 0, sh = 0, ch = 0;
    for (const p of list) {
      if (p.mx < 12) continue;
      const [h, sa, mxv] = hsv(p.R / 255, p.G / 255, p.B / 255);
      n++; s += sa; v += mxv;
      sh += Math.sin(h * Math.PI / 180); ch += Math.cos(h * Math.PI / 180);
    }
    return n ? { n, sat: s / n, v: v / n, hue: Math.atan2(sh / n, ch / n) * 180 / Math.PI } : null;
  };

  let pool = px;
  if (spec.lit) {
    const ok = px.filter((p) => p.mx >= 12).sort((a, b) => a.mx - b.mx);
    pool = ok.slice(-Math.max(1, Math.round(ok.length * 0.40)));
  }
  const inWin = px.length;
  return {
    n: inWin,
    winMin: 100 * px.filter((p) => p.mn < 10).length / inWin,
    all: stat(pool),
    head: stat(pool.filter((p) => p.mn >= 10)),
  };
}

const f = (x, d = 3) => (x == null || Number.isNaN(x)) ? '   -- ' : x.toFixed(d);
const dl = (a, b, d = 3) => (a == null || b == null) ? '' :
  `(${(a - b >= 0 ? '+' : '') + (a - b).toFixed(d)})`;

const rows = [];
for (const [view, label, win, spec] of WINDOWS) {
  rows.push({ view, label, spec,
    now: measure(`shots/${tag}_${view}.png`, win, spec),
    was: base ? measure(`shots/${base}_${view}.png`, win, spec) : null,
    nowC: crush(`shots/${tag}_${view}.png`),
    wasC: base ? crush(`shots/${base}_${view}.png`) : null });
}

console.log(`\n  fill lift verification    ${tag}` + (base ? `  against  ${base}` : ''));
console.log('  ' + '-'.repeat(82));
console.log('  window                     pop      sat     sat(hdrm)   hue(hdrm)      V   hdrm%');
for (const r of rows) {
  if (!r.now || !r.now.all) { console.log(`  ${(r.view + ' ' + r.label).padEnd(26)} -- no capture --`); continue; }
  const pop = r.spec.lit ? 'lit40' : 'whole';
  const frac = r.now.head ? 100 * r.now.head.n / r.now.all.n : 0;
  console.log(`  ${(r.view + ' ' + r.label).padEnd(27)}${pop}` +
    f(r.now.all.sat).padStart(9) + f(r.now.head && r.now.head.sat).padStart(14) +
    f(r.now.head && r.now.head.hue, 1).padStart(12) +
    f(r.now.all.v).padStart(8) + (frac.toFixed(0) + '%').padStart(8));
  if (r.was && r.was.all) console.log(''.padEnd(32) +
    `${f(r.was.all.sat)} ${dl(r.now.all.sat, r.was.all.sat)}`.padStart(17) +
    `${f(r.was.head && r.was.head.sat)} ${dl(r.now.head && r.now.head.sat, r.was.head && r.was.head.sat)}`.padStart(22));
  if (!r.spec.lit && frac < 70)
    console.log(`      only ${frac.toFixed(0)}% of this window has chroma headroom, so the whole-window sat is largely encoder`);
}

console.log('\n  crush, whole frame     CONTRACT baseline: wall_shade min<10 40.8%, lum<10 18.9%');
for (const r of rows) {
  if (!r.nowC || !r.spec.crush) continue;
  console.log(`  ${r.view.padEnd(12)}min<10 ${(r.nowC.loMin.toFixed(1) + '%').padStart(6)} ` +
    `${r.wasC ? dl(r.nowC.loMin, r.wasC.loMin, 1) : ''}`.padEnd(10) +
    ` lum<10 ${(r.nowC.loLum.toFixed(1) + '%').padStart(6)} ` +
    `${r.wasC ? dl(r.nowC.loLum, r.wasC.loLum, 1) : ''}`.padEnd(10) +
    ` all-black ${r.nowC.black.toFixed(2)}%`);
}

console.log('\n  verdicts');
for (const r of rows) {
  if (!r.now || !r.now.all) continue;
  const s = r.spec;
  if (s.lit && s.sat != null) {
    const ok = Math.abs(r.now.all.sat - s.sat) <= 0.008 &&
      (s.hue == null || Math.abs(r.now.all.hue - s.hue) <= 1.1);
    console.log(`  ${ok ? 'HOLDS' : 'MOVED'}  ${r.label}: sat ${r.now.all.sat.toFixed(3)} against ${s.sat}` +
      (s.hue == null ? '' : `, hue ${r.now.all.hue.toFixed(1)} against ${s.hue}`));
  } else if (s.sat != null && r.now.head) {
    const moved = (r.was && r.was.head) ? r.now.head.sat - r.was.head.sat : null;
    console.log(`  ${r.now.head.sat <= s.sat + 0.05 ? 'MET  ' : 'SHORT'}  ${r.label} toward ${s.sat}: ` +
      `headroom sat ${r.now.head.sat.toFixed(3)}` +
      (moved == null ? '' : `, moved ${moved >= 0 ? '+' : ''}${moved.toFixed(3)}` +
        (Math.abs(moved) < 0.01 ? ' - chroma unchanged, so any headline gain is pixels crossing the floor' : '')));
  }
}
console.log();

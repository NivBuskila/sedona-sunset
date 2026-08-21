/* Two measurements the fill work needs, on the encoded PNG the target is now
 * defined against: the shadow-to-sunlit luminance ratio, and what fraction of
 * the wash floor is actually catching sun. The second is FLOOR_SUNLIT in
 * atmos.js, which was reasoned at 0.32 and never measured. */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const L = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function region(tag, view, [rx, ry, rw, rh]) {
  const { w, h, ch, px } = decode(readFileSync(`shots/${tag}_${view}.png`));
  const out = [];
  for (let y = Math.round(ry * h); y < Math.round((ry + rh) * h); y++) {
    for (let x = Math.round(rx * w); x < Math.round((rx + rw) * w); x++) {
      const i = (y * w + x) * ch;
      out.push(L(px[i], px[i + 1], px[i + 2]));
    }
  }
  return out.sort((a, b) => a - b);
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/* wall_lit's rock window, split by the population convention the coordinator
   just standardised: brightest 40% is sunlit, darkest 40% is shade. */
const ROCK = [0.30, 0.24, 0.34, 0.34];
console.log('shadow : sunlit, encoded luminance, same surface and frame');
for (const tag of ['sys2f', 'sys2h', 'sys4a', 'sys4c']) {
  const p = region(tag, 'wall_lit', ROCK);
  const n = Math.round(p.length * 0.40);
  const shade = mean(p.slice(0, n)), sun = mean(p.slice(-n));
  console.log(`  ${tag}   shade ${shade.toFixed(4)}  sun ${sun.toFixed(4)}  ratio ${(shade / sun).toFixed(3)}`);
}

/* The predictor's own floor levels, encoded, from tools/atmos.mjs:
     sunlit   rgb(140,100, 67) -> L 0.4162
     shadowed rgb( 52, 46, 43) -> L 0.1841
   A floor pixel above the midpoint is catching sun. */
const SUNLIT = L(140, 100, 67), SHADED = L(52, 46, 43), CUT = (SUNLIT + SHADED) / 2;
console.log(`\nfloor: sunlit L ${SUNLIT.toFixed(3)}, shaded L ${SHADED.toFixed(3)}, cut ${CUT.toFixed(3)}`);
const FLOORS = {
  wash_mid: [0.18, 0.62, 0.64, 0.30],
  wash_low: [0.18, 0.62, 0.64, 0.30],
  ground: [0.10, 0.45, 0.80, 0.50],
  bend: [0.20, 0.60, 0.60, 0.32],
};
for (const tag of ['sys2f','sys4c','s4rp']) {
  for (const [v, r] of Object.entries(FLOORS)) {
    const p = region(tag, v, r);
    const frac = p.filter((x) => x > CUT).length / p.length;
    console.log(`  ${tag} ${v.padEnd(9)} L mean ${mean(p).toFixed(3)}  p90 ${p[Math.round(p.length * 0.9)].toFixed(3)}` +
      `  sunlit fraction ${frac.toFixed(3)}`);
  }
}

/* What the skylight fill is actually made of, and how grey.
 *
 * The brief asks for cool violet shadows and the probe was delivering
 * [0.0294, 0.0300, 0.0330] on a face turned away from the sun — a 12% channel
 * spread, which is grey with a rumour of blue in it. This decomposes the fill so
 * the grey can be attributed rather than guessed at, and sweeps the two terms
 * that are properties of the canyon rather than of the atmosphere.
 *
 * Read the B/R column. A fill that is going to read violet on red rock has to
 * carry blue well above red, because the rock's own albedo is [0.335, 0.152,
 * 0.082] and will throw away three quarters of whatever blue arrives.
 *
 *   node tools/fillprobe.mjs                       # decompose and sweep
 *   node tools/fillprobe.mjs --floor shots/sys4c   # measure FLOOR_SUNLIT
 *   node tools/fillprobe.mjs --ratio ...           # withdrawn, refuses; see below
 */
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { computeAtmosphere, SUN_DIR } from '../src/atmos.js';
import { decode } from './png.mjs';

const NORMALS = {
  'up': [0, 1, 0],
  'away from sun': null,      // filled per-solve, needs SUN_DIR
  'across': null,
  'down': [0, -1, 0],
};

const hueDeg = ([r, g, b]) => {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};

function irradiance(sh, n) {
  /* Three's LightProbe evaluation: SH9 dotted with the cosine-lobe basis. */
  const v = new THREE.Vector3(n[0], n[1], n[2]);
  const c = sh.coefficients;
  const out = new THREE.Vector3();
  const b = [
    0.886227, 1.023328 * v.y, 1.023328 * v.z, 1.023328 * v.x,
    0.858086 * v.x * v.y, 0.858086 * v.y * v.z,
    0.743125 * v.z * v.z - 0.247708, 0.858086 * v.x * v.z,
    0.429043 * (v.x * v.x - v.y * v.y),
  ];
  for (let i = 0; i < 9; i++) out.addScaledVector(c[i], b[i]);
  return [out.x, out.y, out.z];
}

function report(label, A) {
  const s = SUN_DIR;
  const away = [-s.x, 0, -s.z];
  { const l = Math.hypot(away[0], away[2]) || 1; away[0] /= l; away[2] /= l; }
  const across = [-s.z, 0, s.x];
  { const l = Math.hypot(across[0], across[2]) || 1; across[0] /= l; across[2] /= l; }
  const set = { up: [0, 1, 0], 'away from sun': away, across, down: [0, -1, 0] };
  console.log(`\n${label}`);
  for (const [k, n] of Object.entries(set)) {
    const e = irradiance(A.sh, n);
    const lum = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2];
    const spread = (Math.max(...e) - Math.min(...e)) / Math.max(...e);
    console.log(`  ${k.padEnd(14)} [${e.map((x) => x.toFixed(4)).join(' ')}]` +
      `  lum ${lum.toFixed(4)}  B/R ${(e[2] / e[0]).toFixed(2)}  spread ${(spread * 100).toFixed(0)}%` +
      `  hue ${hueDeg(e).toFixed(0)}`);
  }
}

if (process.argv[2] === '--ratio') {
  /* Withdrawn. It printed `in band` / `TOO HIGH` against the contract's 0.15-0.25
     and it was wrong about all three of the things a verdict needs to be right
     about, which is why it is a refusal rather than a repair — there is no row in
     it worth keeping.
       The estimator. It split one window into its own darkest and brightest 40%
     by value and divided them. The gate is a ratio of *two windows*, a shaded wall
     face against a sunlit one, and the record already rejected the within-window
     split: it reads systematically lower, because the brightest 40% of a shaded
     window is not sunlit rock, it is the shaded window's own bright tail.
     tools/_gate.mjs is the accepted form.
       The population. Five of its seven regions were floor. The wash floor
     measures 0.70 sunlit, so its darkest 40% is not shade at all — it is grazing-lit
     dirt — and the project retired that population by name for exactly this reason.
     A shade-to-sun ratio needs a shaded population to exist.
       The band. 0.15-0.25 is photograph-referenced on shaded rock *wall* against
     sunlit rock *wall*. It is not a figure about a within-window spread and it is
     not a figure about floor, so it applied to neither of the two things this tool
     was measuring, in either of the two ways it was measuring them.
     The rule this obeys is the project's own, and this is the fourth instrument to
     meet it today: a tool that measures nothing must not print a number, and must
     exit non-zero. */
  console.error('fillprobe --ratio: WITHDRAWN, no measurement.');
  console.error('  rejected estimator (within-window 40/40 split, not a two-window ratio),');
  console.error('  on a retired population (wash floor is 0.70 sunlit; its dark tail is not shade),');
  console.error('  against a band (0.15-0.25) that is a shaded-wall-vs-sunlit-wall figure.');
  console.error('  For the shadow gate use:  node tools/_gate.mjs <tag>');
  process.exit(2);
} else if (process.argv[2] === '--floor') {
  /* FLOOR_SUNLIT, measured. The two levels are this model's own predicted floor
     radiances pushed through ACES; a floor pixel above their midpoint is in sun.
     The same threshold on a shadow-map-off capture gives the ceiling, which is
     what the fraction would be if nothing occluded the beam. */
  const L = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const CUT = (L(140, 100, 67) + L(52, 46, 43)) / 2;
  console.log(`floor sunlit fraction, cut at L ${CUT.toFixed(3)}`);
  for (const tag of process.argv.slice(3)) {
    for (const v of ['wash_low', 'wash_mid', 'ground', 'bend']) {
      const f = `${tag}_${v}.png`;
      if (!existsSync(f)) continue;
      const { w, h, ch, px } = decode(readFileSync(f));
      const a = [];
      for (let y = Math.round(0.62 * h); y < Math.round(0.92 * h); y++) {
        for (let x = Math.round(0.18 * w); x < Math.round(0.82 * w); x++) {
          const i = (y * w + x) * ch;
          a.push(L(px[i], px[i + 1], px[i + 2]));
        }
      }
      a.sort((p, q) => p - q);
      const mean = a.reduce((s, x) => s + x, 0) / a.length;
      console.log(`  ${tag.replace(/^.*[\\/]/, '')} ${v.padEnd(9)} L ${mean.toFixed(3)}` +
        `  p90 ${a[Math.round(a.length * 0.9)].toFixed(3)}  sunlit ${(a.filter((x) => x > CUT).length / a.length).toFixed(3)}`);
    }
  }
} else {
  report('as built', computeAtmosphere());
  console.log('\n--- the warm floor bounce, which is what greys it ---');
  for (const f of [0.32, 0.15, 0.05, 0.015, 0]) {
    report(`floorSunlit ${f}`, computeAtmosphere({ floorSunlit: f }));
  }
  console.log('\n--- escarpment coverage, for reference (raises the ratio, see CONTRACT) ---');
  for (const c of [0.46, 0.20, 0]) {
    report(`coverMax ${c}`, computeAtmosphere({ coverMax: c }));
  }
}

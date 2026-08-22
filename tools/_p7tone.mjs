/* System 7: the tone-curve arithmetic behind the black-facet finding.
 *
 * Terrain attributed the critic's number-one finding — clast side faces that
 * render pure black beside blazing orange ground — to the transfer function
 * rather than to the clast material. This reproduces their arithmetic from the
 * shipped constants, and prices the candidate fixes.
 *
 * Every constant here is read from source, not from a comment. Terrain's own
 * write-up flagged that they had used an exposure quoted from a comment where
 * the shipped value differs, and that their conclusion survived "by luck, not
 * design" because ACES is near power-law there and a ratio is scale-invariant.
 * So: EXPOSURE is asserted against sky.js and the run aborts if it has moved.
 */
import fs from 'fs';

const src = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

/* ── constants, lifted from source and checked ─────────────────────────────── */
const sky = src('../src/sky.js'), post = src('../src/post.js');
const grab = (s, re, what) => {
  const m = s.match(re);
  if (!m) throw new Error(`could not read ${what} from source — the shape changed`);
  return parseFloat(m[1]);
};
const EXPOSURE      = grab(sky,  /export const EXPOSURE = ([\d.]+)/, 'EXPOSURE');
const CONTRAST      = grab(post, /contrast: ([\d.]+)/,               'contrast');
const CONTRAST_PIV  = grab(post, /contrastPivot: ([\d.]+)/,          'contrastPivot');
const TOE_TOP       = grab(post, /toeTop: ([\d.]+)/,                 'toeTop');
const TOE_SLOPE     = grab(post, /toeSlope: ([\d.]+)/,               'toeSlope');
const SHOULDER_TOP  = grab(post, /shoulderTop: ([\d.]+)/,            'shoulderTop');
const SHOULDER_SLOPE= grab(post, /shoulderSlope: ([\d.]+)/,          'shoulderSlope');

/* ── ACES, the same fit post.js runs ───────────────────────────────────────── */
const M = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const IN  = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
const OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
const rrt = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
const clamp01 = v => Math.max(0, Math.min(1, v));
function aces(rgb, exposure = EXPOSURE) {
  let c = rgb.map(v => v * exposure / 0.6);
  c = M(IN, c).map(rrt);
  return M(OUT, c).map(clamp01);
}
/* scalar form on a neutral triple, which is what a ratio argument needs */
const acesY = (y, e = EXPOSURE) => aces([y, y, y], e)[0];

/* ── sRGB OETF, post.js's expression verbatim ──────────────────────────────── */
const oetf = v => v <= 0.0031308 ? v * 12.92 : Math.pow(v, 0.41666) * 1.055 - 0.055;
const eotf = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 1 / 0.41666);

/* ── the toe / contrast / shoulder transfer on encoded luminance ───────────── */
function transfer(le, grade = 1) {
  const k = 1 + (CONTRAST - 1) * grade, p = CONTRAST_PIV;
  const A = TOE_TOP, B = SHOULDER_TOP;
  if (B > 0 && le > B) {
    const s1 = 1 + (SHOULDER_SLOPE - 1) * grade;
    const vB = (B - p) * k + p, h = 1 - B;
    const u = (le - B) / h, u2 = u * u, u3 = u2 * u;
    return vB * (2 * u3 - 3 * u2 + 1) + h * k * (u3 - 2 * u2 + u)
         + (-2 * u3 + 3 * u2) + h * s1 * (u3 - u2);
  }
  if (le >= A || A <= 0) return clamp01((le - p) * k + p);
  const s0 = 1 + (TOE_SLOPE - 1) * grade;
  const vA = (A - p) * k + p;
  const u = le / A, u2 = u * u, u3 = u2 * u;
  return Math.max(0, A * s0 * (u3 - 2 * u2 + u) + vA * (-2 * u3 + 3 * u2) + A * k * (u3 - u2));
}

/* full chain on a neutral scene-linear value → 8-bit code */
const chain = (y, grade = 1) => 255 * transfer(oetf(acesY(y)), grade);
const code  = (y, grade = 1) => Math.round(chain(y, grade));

/* invert the neutral chain: what scene-linear value lands on this code? */
function invert(target, grade = 1) {
  let lo = 1e-7, hi = 40;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (chain(mid, grade) < target) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/* ── candidate gentler curves, for pricing only ────────────────────────────── */
/* Khronos PBR Neutral, the reference implementation's constants. */
function neutral(rgb, exposure = EXPOSURE) {
  const sc = 0.8, sd = 0.15, sb = 0.04;
  let c = rgb.map(v => v * exposure);
  const p0 = Math.min(...c);
  const off = p0 < sb ? p0 - (sb * sb) / (p0 + sb - 2 * sb) * 0 : sb;
  /* reference: offset = p < 2*sb ? p*p/(4*sb) : p - sb  — written out */
  const o = p0 < 2 * sb ? (p0 * p0) / (4 * sb) : p0 - sb;
  c = c.map(v => v - o);
  const pk = Math.max(...c);
  if (pk < sc) return c.map(clamp01);
  const d = 1 - sc;
  const pn = 1 - (d * d) / (pk + d - sc);
  const g = 1 - 1 / (sd * (pk - pn) + 1);
  return c.map(v => {
    const cn = (pn / pk) * v;
    return clamp01(cn + g * (pn - cn));
  });
}
const neutralY = (y, e = EXPOSURE) => neutral([y, y, y], e)[0];

/* AgX, the Filament/Godot-style approximation used in three r16x. */
function agx(rgb, exposure = EXPOSURE) {
  const AgXIn = [0.856627153315983, 0.137318972929847, 0.11189821299995,
                 0.0951212405381588, 0.761241990602591, 0.0767994186031903,
                 0.0482516061458583, 0.101439036467562, 0.811302368396859];
  const AgXOut = [1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
                 -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
                 -0.016493938717834573, -0.016493938717834257, 1.2519364065950405];
  let c = rgb.map(v => v * exposure);
  c = M(AgXIn, c);
  const lo = Math.log2(0.0001), hi = Math.log2(16384);
  c = c.map(v => (Math.log2(Math.max(v, 1e-10)) - lo) / (hi - lo)).map(v => clamp01(v));
  /* the 6th-order polynomial fit of the AgX sigmoid */
  c = c.map(x => {
    const x2 = x * x, x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x
         + 0.4298 * x2 + 0.1191 * x - 0.00232;
  });
  return M(AgXOut, c).map(clamp01);
}
const agxY = (y, e = EXPOSURE) => agx([y, y, y], e)[0];

/* ── report ────────────────────────────────────────────────────────────────── */
const arg = k => { const i = process.argv.indexOf('--' + k); return i < 0 ? null : process.argv[i + 1]; };
const pct = v => (100 * v).toFixed(2) + '%';

console.log(`\n  constants read from source: EXPOSURE ${EXPOSURE}  contrast ${CONTRAST}@${CONTRAST_PIV}` +
            `  toe ${TOE_TOP}/${TOE_SLOPE}  shoulder ${SHOULDER_TOP}/${SHOULDER_SLOPE}`);

if (process.argv.includes('--check')) {
  /* Terrain's claim: a facet at 3.91% of the sunlit ground's scene-linear value
     arrives at sRGB code 4. Anchor the ground by inverting the chain on what the
     record measures for sunlit floor, then walk the ratio down. */
  const ratio = parseFloat(arg('ratio') || '0.0391');
  const groundCode = parseFloat(arg('ground') || '162');   // shade_far floor lit maxcv
  const gLin = invert(groundCode);
  console.log(`\n  anchor: sunlit floor at code ${groundCode} inverts to scene-linear ${gLin.toFixed(4)}`);
  console.log(`  facet at ${pct(ratio)} of that is scene-linear ${(gLin * ratio).toFixed(5)}`);
  console.log(`  → graded code ${chain(gLin * ratio).toFixed(2)}   ungraded code ${(255 * oetf(acesY(gLin * ratio))).toFixed(2)}`);

  /* The compression claim, stated as a slope. A pure power-law sRGB encode would
     put this ratio at a much higher code; ACES's toe is the difference. */
  const plain = 255 * oetf(gLin * ratio);
  console.log(`\n  the compression, stated three ways:`);
  console.log(`    ratio ${pct(ratio)} through a plain sRGB encode alone   → code ${plain.toFixed(1)}`);
  console.log(`    ratio ${pct(ratio)} through ACES then sRGB (shipped)    → code ${chain(gLin * ratio).toFixed(1)}`);
  console.log(`    so ACES costs this facet a factor of ${(plain / chain(gLin * ratio)).toFixed(2)}x in code value`);
  const eGround = chain(gLin) / 255, eFacet = chain(gLin * ratio) / 255;
  console.log(`    encoded ratio ${pct(eFacet / eGround)} against scene ratio ${pct(ratio)}` +
              `  → ${(ratio / (eFacet / eGround)).toFixed(2)}x ratio compression`);

  /* What lift is needed, and where it has to be applied. */
  const want = parseFloat(arg('want') || '45');
  const needLin = invert(want);
  console.log(`\n  to read as dark rock at code ${want}:`);
  console.log(`    needs scene-linear ${needLin.toFixed(4)}, which is ${(needLin / (gLin * ratio)).toFixed(1)}x the facet's value`);
  console.log(`    or in encoded space, code ${chain(gLin * ratio).toFixed(1)} → ${want}, a factor of ${(want / chain(gLin * ratio)).toFixed(1)}x`);
}

if (process.argv.includes('--curves')) {
  console.log(`\n  the bottom of the range, three curves, code values at EXPOSURE ${EXPOSURE}`);
  console.log(`  scene-linear |  ACES(shipped) |  AgX  | Neutral |  plain sRGB`);
  for (const y of [0.005, 0.01, 0.02, 0.0391, 0.06, 0.10, 0.18, 0.30, 0.50, 0.80]) {
    const a = 255 * oetf(acesY(y)), g = 255 * oetf(agxY(y)), n = 255 * oetf(neutralY(y)), s = 255 * oetf(y);
    console.log(`      ${y.toFixed(4).padStart(7)}  |  ${a.toFixed(1).padStart(11)}  | ${g.toFixed(1).padStart(5)} | ` +
                `${n.toFixed(1).padStart(7)} | ${s.toFixed(1).padStart(10)}`);
  }
  /* local slope in code values per doubling, which is what "hard toe" means */
  console.log(`\n  contrast in the shadows: code values per stop (doubling of scene-linear)`);
  console.log(`  around      |  ACES(shipped) |  AgX  | Neutral |  plain sRGB`);
  for (const y of [0.01, 0.02, 0.0391, 0.08, 0.18]) {
    const d = (f) => 255 * (oetf(f(y * Math.SQRT2)) - oetf(f(y / Math.SQRT2)));
    console.log(`      ${y.toFixed(4).padStart(7)}  |  ${d(acesY).toFixed(1).padStart(11)}  | ${d(agxY).toFixed(1).padStart(5)} | ` +
                `${d(neutralY).toFixed(1).padStart(7)} | ${d(y2 => y2).toFixed(1).padStart(10)}`);
  }
}

if (process.argv.includes('--lift')) {
  /* Price a linear-space shadow lift applied *before* ACES, which is the one
     place this chain can act without touching the curve everywhere. The shape is
     a soft knee: full gain at zero, unity above `hi`, so the middle is untouched
     by construction rather than by measurement. */
  const gain = parseFloat(arg('gain') || '4'), hi = parseFloat(arg('hi') || '0.10');
  const lift = y => y * (1 + (gain - 1) * Math.pow(Math.max(0, 1 - y / hi), 2));
  console.log(`\n  linear-space shadow lift, gain ${gain} at zero falling to unity at ${hi} scene-linear`);
  console.log(`  scene-linear | lifted  | code before | code after | delta`);
  for (const y of [0.005, 0.01, 0.02, 0.0391, 0.06, 0.10, 0.18, 0.30, 0.50]) {
    const b = chain(y), a2 = chain(lift(y));
    console.log(`      ${y.toFixed(4).padStart(7)}  | ${lift(y).toFixed(4).padStart(7)} | ` +
                `${b.toFixed(1).padStart(11)} | ${a2.toFixed(1).padStart(10)} | ${(a2 - b >= 0 ? '+' : '') + (a2 - b).toFixed(1)}`);
  }
  console.log(`\n  the figures that must not move, as scene-linear values:`);
  for (const [nm, y] of [['lit rock ~0.30', 0.30], ['sunlit floor ~0.19', 0.19], ['shaded floor ~0.02', 0.02]]) {
    console.log(`    ${nm.padEnd(20)} code ${chain(y).toFixed(1)} → ${chain(lift(y)).toFixed(1)}` +
                `   (${(100 * (lift(y) / y - 1)).toFixed(2)}% linear change)`);
  }
}

if (process.argv.includes('--sweep')) {
  /* The anchors, all inverted from codes measured in sys7ship rather than assumed.
     The black facet and the shaded floor are only about one stop apart, which is
     the whole difficulty: a luminance-band operation cannot separate them. */
  const A = {
    'black facet':      invert(6),
    'shaded floor':     invert(19),
    'shaded wall':      invert(33),
    'sunlit floor':     invert(162),
    'lit rock':         invert(176),
  };
  console.log('\n  anchors, inverted from measured codes:');
  for (const [k, v] of Object.entries(A)) console.log(`    ${k.padEnd(14)} code ${chain(v).toFixed(0).padStart(3)}  scene-linear ${v.toFixed(4)}`);
  console.log(`\n  facet and shaded floor are ${(A['shaded floor'] / A['black facet']).toFixed(2)}x apart in scene-linear` +
              ` — ${(Math.log2(A['shaded floor'] / A['black facet'])).toFixed(2)} stops`);

  console.log('\n  sweep: gain at zero x knee, showing what each anchor becomes');
  console.log('  gain  knee  | facet | shd floor | shd wall | sunlit | lit rock | gate proxy');
  const base = chain(A['shaded wall']) / chain(A['sunlit floor']);
  console.log(`   (shipped)   |   ${chain(A['black facet']).toFixed(0).padStart(3)} |       ${chain(A['shaded floor']).toFixed(0).padStart(3)} |` +
              `      ${chain(A['shaded wall']).toFixed(0).padStart(3)} |    ${chain(A['sunlit floor']).toFixed(0)} |      ${chain(A['lit rock']).toFixed(0)} |  ${base.toFixed(3)}`);
  for (const hi of [0.020, 0.030, 0.045, 0.070]) {
    for (const gain of [2, 3, 4, 6]) {
      const lift = y => y * (1 + (gain - 1) * Math.pow(Math.max(0, 1 - y / hi), 2));
      const c = k => chain(lift(A[k]));
      const gate = c('shaded wall') / c('sunlit floor');
      const flag = gate > 0.25 ? '  OUT of band' : '';
      console.log(`   ${gain}   ${hi.toFixed(3)} |   ${c('black facet').toFixed(0).padStart(3)} |       ${c('shaded floor').toFixed(0).padStart(3)} |` +
                  `      ${c('shaded wall').toFixed(0).padStart(3)} |    ${c('sunlit floor').toFixed(0)} |      ${c('lit rock').toFixed(0)} |  ${gate.toFixed(3)}${flag}`);
    }
  }
}

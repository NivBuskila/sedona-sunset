/* Scratch: near-field airlight, before and after.

   Dumps the live inputs to the airlight model, then evaluates the old uniform
   source and the new near/far split on the CPU at the distances System 4 and
   the critic measured, so the inscatter fraction can be reported without
   burning a render for every constant.

   node tools/_a5near.mjs
*/
import { run } from './harness.mjs';

let dump = null;
await run({ width: 640, height: 360, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 600_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const g = window.__game, s = g._scene, cam = g._camera;
    let sun = null;
    s.traverse((o) => { if (o.isDirectionalLight && !sun) sun = o; });
    const o = {
      fogDensity: s.fog.density,
      fog: [s.fog.color.r, s.fog.color.g, s.fog.color.b],
      sunColor: [sun.color.r, sun.color.g, sun.color.b],
      sunInt: sun.intensity,
      sunDir: sun.position.clone().sub(sun.target.position).normalize().toArray(),
      diag: window.__AERIAL_DIAG || null,
      camY: {},
    };
    for (const d of [8, 46, 70, 120, 200]) { g.walkTo(d); o.camY[d] = +cam.position.y.toFixed(2); }
    return o;
  });
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 3).join('\n'));
  dump = out;
});

console.log(JSON.stringify(dump, null, 1));

/* ---- the two models, side by side ---------------------------------------- */
const BETA_R = [0.327, 0.570, 1.000], R_GAIN = 0.30;
const BETA_M = [1.000, 0.962, 0.905], M_GAIN = 0.68;
const SKY_TINT = [0.95, 0.98, 1.06];
const AMB = 0.20, FWD = 0.78, RAY = 0.16;
const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const hg = (g, c) => (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(1e-4, 1 + g * g - 2 * g * c), 1.5));

function build(opts) {
  const { sunMix, gB, wB, gN, wN, farGain, sIll, nearLvl, wallAlb, wallShare, nearFwd } = opts;
  const tintPeak = Math.max(...dump.sunColor) || 1;
  const tint = dump.sunColor.map((x) => x / tintPeak);
  const L = lum(dump.fog), tl = lum(tint) || 1;
  const jRay = [0, 1, 2].map(() => L * RAY * farGain);
  const jSky = SKY_TINT.map((x) => L * x * farGain);
  const jSun = tint.map((x) => L * (1 + (x / tl - 1) * sunMix) * farGain);
  let jNear = [0, 0, 0];
  if (nearLvl) {
    const wall = tint.map((x, i) => x * wallAlb[i]);
    const wn = wall.map((x) => x / (lum(wall) || 1));
    const sn = dump.fog.map((x) => x / (L || 1));
    const mix = wn.map((x, i) => wallShare * x + (1 - wallShare) * sn[i]);
    const mn = lum(mix) || 1;
    jNear = mix.map((x) => L * nearLvl * x / mn);
  }
  const nB = 1 / hg(gB, 1), nN = 1 / hg(gN, 1);
  return function apply(color, dist, ca) {
    const lobe = wB * hg(gB, ca) * nB + wN * hg(gN, ca) * nN;
    const ds = sIll ? dist / sIll : 0;
    const out = [0, 0, 0], ins = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const tR = BETA_R[i] * R_GAIN * dump.fogDensity * dist;
      const tM = BETA_M[i] * M_GAIN * dump.fogDensity * dist;
      const t = tR + tM, T = Math.exp(-t);
      const jM = jSky[i] * AMB + jSun[i] * FWD * lobe;
      const J = (tR * jRay[i] + tM * jM) / Math.max(1e-6, t);
      if (sIll) {
        const Bn = (t / (t + ds)) * (1 - Math.exp(-(t + ds)));
        const Bf = Math.max(0, (1 - T) - Bn);
        ins[i] = jNear[i] * (1 + nearFwd * lobe) * Bn + J * Bf;
      } else {
        ins[i] = J * (1 - T);
      }
      out[i] = color[i] * T + ins[i];
    }
    return { out, ins, opt: 1 - Math.exp(-(BETA_R[1] * R_GAIN + BETA_M[1] * M_GAIN) * dump.fogDensity * dist) };
  };
}

const OLD = build({ sunMix: 0.62, gB: 0.35, wB: 0.74, gN: 0.80, wN: 0.26, farGain: 1, sIll: 0 });
const NEW = build({ sunMix: 1.0, gB: 0.35, wB: 0.58, gN: 0.85, wN: 0.42, farGain: 1.45,
  sIll: 150, nearLvl: 0.061, wallAlb: [1.0, 0.60, 0.37], wallShare: 0.55, nearFwd: 0.9 });

const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx > 0 ? (mx - mn) / mx : 0; };
/* Lit rock at the source: sat 0.686, B/G 0.60, per System 4's recovered radiance. */
const ROCK = [0.100, 0.0523, 0.0314];
const bg = (c) => c[2] / c[1];

console.log('\nlit rock at source: sat ' + sat(ROCK).toFixed(3) + '  B/G ' + bg(ROCK).toFixed(3));
console.log('\n dist   ca | model |  1-T   | inscatter share of pixel R/G/B |  sat   B/G   | airlight B/G');
for (const dist of [20, 46, 120, 550, 1450]) {
  for (const ca of [0.97, 0.2]) {
    for (const [nm, m] of [['old', OLD], ['new', NEW]]) {
      const r = m(ROCK, dist, ca);
      const share = r.ins.map((x, i) => (x / r.out[i] * 100).toFixed(1)).join('/');
      console.log(` ${String(dist).padStart(4)} ${ca.toFixed(2)} | ${nm}   | ${r.opt.toFixed(4)} | ${share.padStart(18)} | ` +
        `${sat(r.out).toFixed(3)} ${bg(r.out).toFixed(3)} | ${bg(r.ins).toFixed(3)}`);
    }
  }
}
/* Aureole contrast: how much brighter is the far airlight toward the sun. */
console.log('\nlobe contrast (airlight G at 1450 m, ca=1.00 vs 0.90 vs 0.60 vs -0.5):');
for (const [nm, m] of [['old', OLD], ['new', NEW]]) {
  const v = [1.0, 0.9, 0.6, -0.5].map((ca) => m(ROCK, 1450, ca).ins[1].toFixed(4));
  console.log('  ' + nm + '  ' + v.join('  ') + '   ratio ' + (m(ROCK, 1450, 1).ins[1] / m(ROCK, 1450, 0.6).ins[1]).toFixed(2));
}

/* Where is the bottom of a bench-tier tuft, in its own local units?
 *
 *   node tools/_tuftmin.mjs
 *
 * `cardTuft` grows a card *upward* from `cy` — `py = cy + hh * sy` with
 * `sy` in {0, 1} — so `cy` is the card's foot and not its centre. Any tuft
 * built with a positive `cy` therefore has no geometry at or below its own
 * origin, and an instance of it hovers.
 */
import { rng } from '../src/noise.js';
import { cardTuft } from '../src/juniper.js';

const TAU = Math.PI * 2;

function tuft(build) {
  const arr = { pos: [], nrm: [], uvs: [], idx: [] };
  build(arr);
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < arr.pos.length; i += 3) {
    lo = Math.min(lo, arr.pos[i]); hi = Math.max(hi, arr.pos[i]);
  }
  return { lo, hi, cards: arr.pos.length / 12 };
}

/* As shipped before this fix. */
const before = tuft((arr) => {
  const r = rng(2002);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU;
    cardTuft(Math.cos(a) * 0.17, 0.06 + r() * 0.46, Math.sin(a) * 0.17,
             0.70, 0.60, 1, r, arr, 2, 2);
  }
});

/* As shipped after it. */
const after = tuft((arr) => {
  const r = rng(2002);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU + r() * 0.42;
    const skirt = i < 4;
    const rad = skirt ? 0.21 + r() * 0.11 : 0.17;
    cardTuft(Math.cos(a) * rad,
             skirt ? -0.20 - r() * 0.12 : 0.03 + r() * 0.40,
             Math.sin(a) * rad,
             skirt ? 0.84 : 0.70, skirt ? 0.76 : 0.60, 1, r, arr, 2, 2);
  }
});

/* The near shrub, for contrast — it seats correctly and looks it. */
const shrub = tuft((arr) => {
  const r = rng(4242);
  cardTuft(0, 0, 0, 0.95, 1.0, 5, r, arr);
  cardTuft(0, 0.09, 0, 0.70, 0.78, 3, r, arr);
});

const show = (n, t, prop = false) => {
  console.log(`  ${n.padEnd(10)} ${t.cards} cards, local y ${t.lo.toFixed(3)}` +
    ` .. ${t.hi.toFixed(3)}`);
  /* Sink was a flat 0.12 m; it is now 0.10 * sz, and sy runs 0.9..1.6 of sz. */
  for (const sy of [1.0, 2.5, 4.0]) {
    const sink = prop ? 0.10 * (sy / 1.25) : 0.12;
    const air = t.lo * sy - sink;
    console.log(`    at sy ${sy.toFixed(1)}, sink ${sink.toFixed(2)} m` +
      `   lowest geometry ${air >= 0 ? '+' : ''}${air.toFixed(2)} m` +
      `  ${air > 0.02 ? 'AIR — hovering' : 'buried'}`);
  }
};

console.log('\nbench tier (veg-mid), before');
show('midGeo', before);
console.log('\nbench tier (veg-mid), after');
show('midGeo', after, true);
console.log('\nnear shrub (veg-shrub), for comparison');
show('shrubGeo', shrub);

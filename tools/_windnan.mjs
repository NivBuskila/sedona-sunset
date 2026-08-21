/* Which parameter write in Soundscape._scheduleWind goes non-finite, and why.
 *
 * The page throws `linearRampToValueAtTime … non-finite` from _scheduleWind on
 * every frame. Reproducing that in a browser costs a boot; the scheduler is
 * pure arithmetic over stubbable AudioParams, so it can be run in node instead
 * and the offending term named in a second.
 *
 *   node tools/_windnan.mjs [seconds]
 */
import { Soundscape } from '../src/audio.js';

const SEED = 0x5ed04a;
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hits = new Map();
function param(name) {
  return {
    linearRampToValueAtTime(v, t) {
      if (!Number.isFinite(v) || !Number.isFinite(t)) {
        const k = `${name}  value=${v}  time=${t}`;
        hits.set(k, (hits.get(k) || 0) + 1);
      }
    },
  };
}
const gainNode = (n) => ({ gain: param(n) });
const band = (n) => ({
  gain: gainNode(n + '.gain'), fL: { frequency: param(n + '.fL') },
  fR: { frequency: param(n + '.fR') },
});

const sc = Object.create(Soundscape.prototype);
Object.assign(sc, {
  quiet: false,
  gusts: [], gustsTo: 0, schedHead: 0,
  erand: mulberry32(SEED ^ 0x9e3779b9),
  prox: 0.5,
  edgeLvl: 2.0,
  rush: band('rush'), body: band('body'), hiss: band('hiss'), rasp: band('rasp'),
  air: { gain: gainNode('air') }, stridul: { gain: gainNode('stridul') },
  eg1: param('eg1'), eg2: param('eg2'),
  edge1: { frequency: param('edge1.freq') }, edge2: { frequency: param('edge2.freq') },
  washWet: param('washWet'), slap: param('slap'), windEcho: param('windEcho'),
});
sc.eg1 = { gain: param('eg1.gain') };
sc.eg2 = { gain: param('eg2.gain') };
sc.washWet = { gain: param('washWet.gain') };
sc.slap = { gain: param('slap.gain') };
sc.windEcho = { gain: param('windEcho.gain') };
/* The scheduler writes `this.eg1.gain`, `this.washWet.gain` … as AudioParams
   directly, so those four are params rather than nodes. */
sc.eg1 = { gain: param('eg1') };
sc.eg2 = { gain: param('eg2') };
sc.washWet = { gain: param('washWet') };
sc.slap = { gain: param('slap') };
sc.windEcho = { gain: param('windEcho') };

const SECS = Number(process.argv[2]) || 1200;
for (let now = 0; now < SECS; now += 0.25) sc._scheduleWind(now);

console.log(`swept ${SECS}s of timeline, ${sc.gusts.length} gusts`);
if (!hits.size) { console.log('no non-finite parameter write'); process.exit(0); }
for (const [k, n] of hits) console.log(`  ${n.toString().padStart(6)} ×  ${k}`);

/* Name the term. Every input to the offending line, at the first bad time. */
const w = { bg: [0, 0, 0, 0] };
for (let t = 0; t < SECS; t += 0.25) {
  sc.windAt(t, w);
  const bad = w.bg.some(v => !Number.isFinite(v)) || !Number.isFinite(w.g);
  if (!bad) continue;
  console.log(`\nfirst bad windAt at t=${t.toFixed(2)}: g=${w.g} bg=[${w.bg}]`);
  for (const gu of sc.gusts) {
    if (t < gu.t0 - gu.dur * 0.2 || t > gu.t0 + gu.dur * 1.5) continue;
    console.log('  gust', JSON.stringify(gu));
  }
  break;
}

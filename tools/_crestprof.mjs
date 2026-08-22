/* The wall's skyline, station by station, off the built geometry.
 *
 * The final critique's second-ranked finding is a "perfectly straight,
 * un-notched, un-eroded" rimline on what it read as a mesa in shade_far, and
 * tools/_pixowner.mjs attributes those pixels to wallL: it is the corridor wall
 * seen end-on, and the straight line is the crest snap holding one CREST_LEVELS
 * entry across the whole run the frame contains.
 *
 * That is a claim about the crest as a function of along-wall station, which the
 * built geometry can answer directly in a second. Renders here are running nine
 * minutes under contention and this is iterative landform work, so it should not
 * cost one to find out whether the rim steps.
 *
 * Prints the top of the wall per station band and flags each change of level, so
 * "how often does the rim step, and by how much" is read off rather than
 * eyeballed. A flat run is a ruler; steps of a few metres every twenty or thirty
 * are a mesa.
 *
 *   node tools/_crestprof.mjs [wallL] [from] [to] [step]
 */
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildWalls } = await import('../src/rock.js');

const which = process.argv[2] || 'wallL';
const from = Number(process.argv[3] ?? 0), to = Number(process.argv[4] ?? 240);
const step = Number(process.argv[5] ?? 5);

const path = new WashPath(), terrain = new Terrain(path);
const mesh = buildWalls(path, terrain, {}).find((m) => m.name === which);
if (!mesh) { console.log(`no mesh named ${which}`); process.exit(1); }

const pos = mesh.geometry.getAttribute('position');
const att = mesh.geometry.getAttribute('aRock');
const bins = new Map();
for (let i = 0; i < pos.count; i++) {
  const b = Math.floor(att.getY(i) / step) * step;
  bins.set(b, Math.max(bins.get(b) ?? -1e9, pos.getY(i)));
}

const keys = [...bins.keys()].filter((k) => k >= from && k <= to).sort((a, b) => a - b);
let prev = null, steps = 0, flat = 0, longest = 0, run = 0;
console.log(`${which}: crest by ${step} m station`);
for (const k of keys) {
  const v = bins.get(k);
  const d = prev === null ? 0 : v - prev;
  if (Math.abs(d) < 0.35) { flat++; run++; longest = Math.max(longest, run); }
  else { steps++; run = 0; }
  console.log(`  s ${String(k).padStart(4)}  crest ${v.toFixed(1).padStart(6)}`
    + (prev === null ? '' : `  ${d >= 0 ? '+' : ''}${d.toFixed(1).padStart(5)}`)
    + (Math.abs(d) >= 1.5 ? '   <- step' : ''));
  prev = v;
}
console.log(`\n  ${steps} level changes over ${keys.length} bands, `
  + `longest flat run ${longest * step} m`);

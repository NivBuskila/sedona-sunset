/* Are the alcoves and spall scars on a lattice, measured off the built wall?
 *
 * The ship critic's number two finding is "soft-edged dark rounded rectangles,
 * roughly equal width, roughly equal spacing, arranged in horizontal rows along
 * the bedding ... rows of windows in a building", in four framings, and names
 * cavernous weathering as the quality it is standing in for. Right feature, wrong
 * distribution, which is the same shape as the crest that held one bed level for
 * 50-100 m and the apron rows that sat at a dead-regular spacing. Both of those
 * were fixed by warping a phase rather than changing an amplitude, and both were
 * found by measuring the generator's spacing rather than by looking at a render.
 *
 * So measure the spacing. The recess is a lateral offset, so it is in the built
 * positions: project each vertex onto its column's wall normal and the offset
 * comes back directly. Per bedding row, find the local maxima of that offset
 * along the wall - each one is an alcove or a scar - and report the gaps between
 * them, their widths, and how much the rows agree with each other.
 *
 * A real cliff gives a broad gap distribution and rows that do not line up. A
 * lattice gives a tight one and rows that do. The coefficient of variation of the
 * gaps is the number to watch: near 0.2 is a grid, near 0.7 is a Poisson-ish
 * scatter, and the eye starts calling something a pattern below about 0.35.
 *
 *   node tools/_alcgrid.mjs [wallL] [row0] [row1]
 */
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildWalls } = await import('../src/rock.js');

const which = process.argv[2] || 'wallL';
const r0 = Number(process.argv[3] ?? 4), r1 = Number(process.argv[4] ?? 26);

const path = new WashPath(), terrain = new Terrain(path);
const mesh = buildWalls(path, terrain, {}).find((m) => m.name === which);
if (!mesh) { console.log(`no mesh named ${which}`); process.exit(1); }

const pos = mesh.geometry.getAttribute('position');
const att = mesh.geometry.getAttribute('aRock');   // x: height in column, y: station, z: freshness

/* Binned by the station and column-height attributes rather than by index,
   because `buildWalls` returns a *creased* mesh: `creasedMesh` splits vertices
   per face so hard edges can carry their own normals, so the (column, row) grid
   the generator wrote is not the vertex order that comes back. Assuming it was
   is almost certainly what made a node-side scratch report no rock above y 0 on
   a wall the app draws at y 46.8 - the layout is wrong, not the build. */
let yMax = -1e9;
for (let i = 0; i < pos.count; i++) yMax = Math.max(yMax, pos.getY(i));
console.log(`  (sanity: ${pos.count} vertices, highest at y ${yMax.toFixed(1)} m)`);

/* Lateral offset of a vertex from the centreline, along the wall normal at its
   own station. Sign is discarded: what matters is how far back from its
   neighbourhood a point sits, and the recess is the local maximum either way. */
const side = which === 'wallL' ? 1 : -1;
function offsetAt(i) {
  const s = att.getY(i);
  const p = path.posAt(s);
  const th = path.headingAt(s);
  const nx = Math.cos(th) * side, nz = Math.sin(th) * side;
  return (pos.getX(i) - p.x) * nx + (pos.getZ(i) - p.z) * nz;
}

/* One profile per height band: every vertex whose column height falls in the
   band, averaged into 0.62 m station bins so the crease duplicates collapse back
   onto the column they came from. */
const DS = 0.62;
const stats = [];
const peakSets = [];
for (let band = r0; band <= r1; band += 2) {
  const acc = new Map();
  for (let i = 0; i < att.count; i++) {
    const hy = att.getX(i);
    if (hy < band || hy >= band + 2) continue;
    const key = Math.round(att.getY(i) / DS);
    const a = acc.get(key) || [0, 0];
    a[0] += offsetAt(i); a[1]++;
    acc.set(key, a);
  }
  const keys = [...acc.keys()].sort((a, b) => a - b);
  if (keys.length < 40) continue;
  const ss = keys.map((k) => k * DS);
  const u = keys.map((k) => acc.get(k)[0] / acc.get(k)[1]);
  const n = u.length;
  /* Local maxima of the offset, above this band's own median by a real amount so
     that grain does not count as an alcove. Half a metre is well under the 1.1 m
     scar depth and the 2.2 m bench alcove, and well over the roughening. */
  const med = [...u].sort((a, b) => a - b)[n >> 1];
  const peaks = [];
  for (let i = 3; i < n - 3; i++) {
    if (u[i] - med < 0.5) continue;
    let top = true;
    for (let k = -3; k <= 3; k++) if (u[i + k] > u[i]) { top = false; break; }
    if (top) peaks.push(ss[i]);
  }
  const j = band;
  if (peaks.length < 3) continue;
  const gaps = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
  stats.push({ j, n: peaks.length, mean, sd, cv: sd / mean,
    min: Math.min(...gaps), max: Math.max(...gaps) });
  peakSets.push({ j, peaks });
}

console.log(`${which}: alcove/scar spacing by height band;  alcove/scar spacing per bedding row`);
console.log('band   n   mean gap    sd     CV     min    max');
for (const t of stats) {
  console.log(`${String(t.j).padStart(3)} ${String(t.n).padStart(4)}  `
    + `${t.mean.toFixed(1).padStart(7)} ${t.sd.toFixed(1).padStart(6)} `
    + `${t.cv.toFixed(2).padStart(6)}  ${t.min.toFixed(1).padStart(6)} ${t.max.toFixed(1).padStart(6)}`);
}
const allCv = stats.reduce((a, t) => a + t.cv, 0) / (stats.length || 1);
const allMean = stats.reduce((a, t) => a + t.mean, 0) / (stats.length || 1);
console.log(`\n  ${stats.length} rows carry recesses; mean spacing ${allMean.toFixed(1)} m, mean CV ${allCv.toFixed(2)}`);
console.log('  (CV near 0.2 is a grid; the eye stops calling it a pattern above about 0.35)');

/* Do the rows line up with each other? A building has its windows in columns as
   well as rows, and vertical alignment between adjacent beds is what turns a row
   of recesses into a facade. Measured as the fraction of peaks in one row that
   have a peak in the row above within three metres. */
let pairs = 0, aligned = 0;
for (let a = 1; a < peakSets.length; a++) {
  if (peakSets[a].j !== peakSets[a - 1].j + 1) continue;
  for (const p of peakSets[a].peaks) {
    pairs++;
    if (peakSets[a - 1].peaks.some((q) => Math.abs(q - p) < 3)) aligned++;
  }
}
if (pairs) {
  console.log(`  vertical alignment between adjacent rows: ${aligned}/${pairs} `
    + `= ${(100 * aligned / pairs).toFixed(0)}%  (chance at this density is roughly `
    + `${(100 * 6 / allMean).toFixed(0)}%)`);
}

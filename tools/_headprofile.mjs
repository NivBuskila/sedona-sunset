/* What stands in front of the wash head, column by column.
 *
 * far_320 is the last framing of the walk and the amphitheatre System 1 built
 * behind it is invisible. tools/_pixowner.mjs attributes the straight tilted
 * ledge across that frame to `apronL` and `apronR`, so the occluder is the talus
 * apron and not the wall — but "the apron" is four hundred columns long and the
 * fix has to know which of them are in the way and by how much.
 *
 * Prints, for the last stretch of the corridor: the wall's crest, the apron's
 * head height and reach, the lateral offset of the wall foot, and the terrain's
 * own height on the corridor axis at the same station — which is the thing the
 * apron is standing in front of.
 *
 *   node tools/_headprofile.mjs [from] [to]
 */
import * as THREE from 'three';
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildWalls } = await import('../src/rock.js');

const from = Number(process.argv[2] ?? 250), to = Number(process.argv[3] ?? 356);

const path = new WashPath(), terrain = new Terrain(path);
const meshes = buildWalls(path, terrain, {});
const p = new THREE.Vector3();

/* The aprons carry their along-wall station in the second attribute channel, so
   the built geometry can be asked directly rather than the profile being
   recomputed here — which would be a second implementation able to disagree. */
function apronBand(mesh, s0, s1) {
  const pos = mesh.geometry.getAttribute('position');
  const att = mesh.geometry.getAttribute('aRock');
  let yMax = -1e9, yMin = 1e9, xIn = 1e9, xOut = -1e9, n = 0;
  for (let i = 0; i < pos.count; i++) {
    const s = att.getY(i);
    if (s < s0 || s > s1) continue;
    n++;
    yMax = Math.max(yMax, pos.getY(i));
    yMin = Math.min(yMin, pos.getY(i));
    const ax = Math.abs(pos.getX(i));
    xIn = Math.min(xIn, ax); xOut = Math.max(xOut, ax);
  }
  return { n, yMax, yMin, xIn, xOut };
}

const wallOf = (nm) => meshes.find((m) => m.name === nm);

console.log('   s     axis x,z    terrain@axis |  apronL  yTop  |x| in..out  |  apronR  yTop  |x| in..out');
for (let s = from; s <= to; s += 6) {
  path.posAt(s, p);
  const th = terrain.heightAt(p.x, p.z);
  const L = apronBand(wallOf('apronL'), s - 3, s + 3);
  const R = apronBand(wallOf('apronR'), s - 3, s + 3);
  const f = (v) => (Number.isFinite(v) ? v.toFixed(1) : '  -');
  console.log(`${String(s).padStart(4)}  ${p.x.toFixed(1).padStart(6)},${p.z.toFixed(0).padStart(5)}`
    + `  ${th.toFixed(1).padStart(6)}     |  ${f(L.yTop ?? L.yMax).padStart(6)} `
    + `${f(L.xIn).padStart(5)}..${f(L.xOut).padStart(5)}  |  ${f(R.yMax).padStart(6)} `
    + `${f(R.xIn).padStart(5)}..${f(R.xOut).padStart(5)}`);
}

/* And the height field along the axis past the corridor, which is the
   amphitheatre the ledge is hiding. */
console.log('\naxis profile past the corridor');
for (let s = 300; s <= 380; s += 10) {
  path.posAt(s, p);
  console.log(`  s ${String(s).padStart(3)}  x ${p.x.toFixed(1).padStart(6)} z ${p.z.toFixed(0).padStart(5)}`
    + `  terrain ${terrain.heightAt(p.x, p.z).toFixed(1).padStart(6)}`
    + `  at |x|=25 ${terrain.heightAt(p.x + 25, p.z).toFixed(1).padStart(6)}`);
}

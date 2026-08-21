/* What the sun has to clear to reach the wash floor.
 *
 * The floor measured 0.9% sunlit where the provisional rig had 52%, and turning
 * the shadow map off restored it to 51% — so the direct beam is being blocked by
 * geometry rather than lost to a grazing cosine or eaten by shadow acne. This
 * finds out by what, and by how much, without rendering: march the terrain height
 * field along the sun's azimuth from a point on the floor and report the largest
 * elevation angle anything subtends. If that exceeds the sun's elevation, the
 * point is in shadow and no amount of bias tuning will change it.
 *
 *   node tools/horizon.mjs            # a few points down the wash
 *   node tools/horizon.mjs --sweep    # elevation needed, against sun azimuth
 */
import { Terrain } from '../src/terrain.js';
import { WashPath } from '../src/path.js';
import { SUN_AZ, SUN_EL, SUN_EL_DEG, SUN_AZ_DEG } from '../src/atmos.js';

const path = new WashPath();
const terrain = new Terrain(path);
const DEG = 180 / Math.PI;

/* March out along a horizontal bearing, in steps that grow with distance: near
   ground needs metres to catch a bank crest, a butte 2 km out does not. */
function horizonAngle(x0, z0, az, maxDist = 3000) {
  const dx = Math.sin(az), dz = -Math.cos(az);
  const y0 = terrain.heightAt(x0, z0) + 0.05;
  let best = -Math.PI / 2, bestD = 0, bestH = 0;
  for (let d = 0.5; d < maxDist; d *= 1.03) {
    const h = terrain.heightAt(x0 + dx * d, z0 + dz * d);
    const a = Math.atan2(h - y0, d);
    if (a > best) { best = a; bestD = d; bestH = h - y0; }
  }
  return { deg: best * DEG, d: bestD, rise: bestH };
}

/* Points on the wash centreline, at the distances the viewpoints stand at. */
const PTS = [0, 20, 46, 80, 140, 220];
const at = (s) => { const p = path.atZ(-s); return p ? [p.x ?? 0, -s] : [0, -s]; };

if (process.argv.includes('--sweep')) {
  console.log(`sun elevation ${SUN_EL_DEG}, azimuth ${SUN_AZ_DEG}`);
  console.log('az    | horizon elevation needed, degrees, per point down the wash');
  for (let azd = 0; azd >= -70; azd -= 5) {
    const az = azd / DEG;
    const row = PTS.map((s) => { const [x, z] = at(s); return horizonAngle(x, z, az).deg.toFixed(1).padStart(6); });
    console.log(`${azd.toString().padStart(4)}  |${row.join('')}`);
  }
} else {
  console.log(`sun elevation ${SUN_EL_DEG} deg, azimuth ${SUN_AZ_DEG} deg\n`);
  console.log('  s     floor y   horizon    blocked by            verdict');
  for (const s of PTS) {
    const [x, z] = at(s);
    const h = horizonAngle(x, z, SUN_AZ);
    const lit = h.deg < SUN_EL_DEG;
    console.log(`${s.toString().padStart(4)}  ${terrain.heightAt(x, z).toFixed(2).padStart(8)}` +
      `  ${h.deg.toFixed(2).padStart(7)} deg   ${h.rise.toFixed(0).padStart(4)} m at ${h.d.toFixed(0).padStart(4)} m` +
      `     ${lit ? 'SUNLIT' : 'in shadow, needs ' + (h.deg + 0.2).toFixed(1) + ' deg'}`);
  }
  console.log(`\nsun is at ${(SUN_EL * DEG).toFixed(2)} deg`);
}

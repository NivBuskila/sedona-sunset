/* Find aliasing in the height field without rendering anything.
 *
 * A term whose wavelength approaches the grid spacing does not appear as relief,
 * it appears as a checkerboard: neighbouring vertices alternate up and down
 * because the function is being sampled at its own Nyquist frequency. That is
 * invisible in the source and unmistakable in a render, where it reads as a patch
 * of ground made of sugar cubes. This walks the grid, looks for runs where the
 * second difference flips sign on every step, and reports where they are and how
 * large — so the offending term can be found by its wavelength rather than by
 * bisecting the height function one render at a time.
 *
 *   node tools/ridge.mjs [xmin xmax zmin zmax]
 */
import { Terrain } from '../src/terrain.js';
import { WashPath } from '../src/path.js';

const [x0, x1, z0, z1] = process.argv.slice(2).length === 4
  ? process.argv.slice(2).map(Number) : [-24, 24, -60, 120];

const t = new Terrain(new WashPath());
const H = (x, z) => t.heightAt(x, z);

const dx = 0.20, dz = 0.42;
let worst = [];
for (let z = z0; z < z1; z += dz) {
  for (let x = x0; x < x1 - 4 * dx; x += dx) {
    /* second difference, three in a row, alternating sign */
    const d = [];
    for (let k = 0; k < 4; k++) {
      const a = H(x + k * dx, z), b = H(x + (k + 1) * dx, z), c = H(x + (k + 2) * dx, z);
      d.push(a - 2 * b + c);
    }
    let alt = true, amp = 0;
    for (let k = 0; k < 4; k++) {
      if (k && Math.sign(d[k]) === Math.sign(d[k - 1])) alt = false;
      amp += Math.abs(d[k]);
    }
    if (alt && amp / 4 > 0.03) worst.push({ x: +x.toFixed(2), z: +z.toFixed(2), amp: +(amp / 4).toFixed(3) });
  }
}
worst.sort((a, b) => b.amp - a.amp);
console.log(`x aliasing: ${worst.length} sites`);
console.log(worst.slice(0, 14));

worst = [];
for (let x = x0; x < x1; x += dx) {
  for (let z = z0; z < z1 - 4 * dz; z += dz) {
    const d = [];
    for (let k = 0; k < 4; k++) {
      const a = H(x, z + k * dz), b = H(x, z + (k + 1) * dz), c = H(x, z + (k + 2) * dz);
      d.push(a - 2 * b + c);
    }
    let alt = true, amp = 0;
    for (let k = 0; k < 4; k++) {
      if (k && Math.sign(d[k]) === Math.sign(d[k - 1])) alt = false;
      amp += Math.abs(d[k]);
    }
    if (alt && amp / 4 > 0.03) worst.push({ x: +x.toFixed(2), z: +z.toFixed(2), amp: +(amp / 4).toFixed(3) });
  }
}
worst.sort((a, b) => b.amp - a.amp);
console.log(`z aliasing: ${worst.length} sites`);
console.log(worst.slice(0, 14));

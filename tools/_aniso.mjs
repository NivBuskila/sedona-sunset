/* Is the wall's structure horizontal only, and by how much?
 *
 * The final critique's top rock finding is that the walls carry "perfectly
 * parallel horizontal lines ... no vertical joint sets, no blocky spall, no
 * cross-fracture" and read as sliced plywood. That is a claim about the
 * *direction* of the surface's energy, and every instrument this project has for
 * rock surface — grad.mjs, hf.mjs, wallprobe.mjs — is isotropic and cannot see
 * it. All three would score a set of perfect horizontal rules and a real jointed
 * cliff identically.
 *
 * So: split the gradient by axis. A bedding-only wall puts its energy in dI/dy
 * (bright above a contact, dark below) and almost none in dI/dx. A real Sedona
 * face is cut by vertical joints into slabs, so dI/dx carries at least as much.
 *
 * Reported at two scales, because the two structures live at different ones: the
 * 1-pixel figure is joint hairlines and grain, the 4-pixel figure is bed contacts
 * and slab edges. `V/H` below 1 means bedding dominates; a real cliff runs near
 * or above 1 at the coarse scale, where the joints cut it into columns.
 *
 *   node tools/_aniso.mjs shots/sys7final_wall_lit.png
 *   node tools/_aniso.mjs shots/a.png shots/b.png --crop 0.16,0.30,0.20,0.20
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--') && !/^[\d.,]+$/.test(a));
const ci = args.indexOf('--crop');
const crop = ci >= 0 ? args[ci + 1].split(',').map(Number) : null;

/* Same presets and the same sRGB-space luma as grad.mjs and hf.mjs, so a V/H
   figure can be quoted beside an hf/lf figure for the same crop without the two
   silently measuring different pixels. */
const CROPS = {
  wall_lit: [['midwall', [0.16, 0.30, 0.20, 0.20]], ['upper', [0.62, 0.04, 0.20, 0.18]]],
  wall_shade: [['face', [0.20, 0.25, 0.30, 0.35]]],
  far_170: [['rwall', [0.55, 0.00, 0.42, 0.42]]],
  bend: [['upper', [0.30, 0.05, 0.35, 0.30]]],
  shade_far: [['mesa', [0.02, 0.08, 0.22, 0.16]]],
  far_220: [['dome', [0.41, 0.21, 0.10, 0.22]]],
  far_320: [['rwall', [0.51, 0.00, 0.31, 0.49]]],
};

function lum(img) {
  const { w, h, px, ch } = img;
  const L = new Float32Array(w * h);
  for (let i = 0, p = 0; i < L.length; i++, p += ch) {
    L[i] = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
  }
  return { L, w, h };
}

/* Mean |dI/dx| and mean |dI/dy| at a stride, over a rectangle. Absolute rather
   than squared: a joint is a thin high-contrast line and squaring lets a handful
   of terminator pixels dominate a whole crop, which is how the last directional
   attempt in this tree was misread. */
function axes({ L, w, h }, x0, y0, x1, y1, s) {
  let gx = 0, gy = 0, n = 0;
  for (let y = y0; y < y1 - s; y++) {
    for (let x = x0; x < x1 - s; x++) {
      const i = y * w + x;
      gx += Math.abs(L[i + s] - L[i]);
      gy += Math.abs(L[i + s * w] - L[i]);
      n++;
    }
  }
  return { gx: gx / n, gy: gy / n, n };
}

/* Directional box blur, radius R along one axis only, clamped at the edges. */
function blur1({ L, w, h }, R, alongX) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) {
        const xx = alongX ? Math.min(w - 1, Math.max(0, x + k)) : x;
        const yy = alongX ? y : Math.min(h - 1, Math.max(0, y + k));
        s += L[yy * w + xx]; n++;
      }
      o[y * w + x] = s / n;
    }
  }
  return { L: o, w, h };
}

/* Coherent line energy, which is the thing the critic is actually describing and
   the thing the raw axis split above cannot see.
 *
 * A granular isotropic surface has dI/dx ~ dI/dy and scores V/H ~ 1 while
 * containing no lines at all; a wall of perfect horizontal rules scores the same
 * ~1 once grain is added on top. Both were measured here and both came back
 * 0.86-1.10, which is why every isotropic instrument in this tree called the wall
 * fine while a critic called it sliced plywood.
 *
 * Smearing along x by twelve pixels destroys anything vertical and leaves
 * horizontal lines untouched, so the surviving dI/dy is the strength of the
 * horizontal line system alone. Smearing along y gives the vertical one. Grain is
 * attenuated by the same factor in both, so it cancels in the ratio, and what is
 * left is a statement about fracture versus bedding. */
function lines(img, x0, y0, x1, y1, R) {
  const H = axes(blur1(img, R, true), x0, y0, x1, y1, 2).gy;
  const V = axes(blur1(img, R, false), x0, y0, x1, y1, 2).gx;
  return { H, V, r: V / H };
}

console.log('file                        region      dI/dx    dI/dy    V/H  |  @4: dI/dx   dI/dy    V/H'
  + '  ||  hLine   vLine   vert/horiz');
for (const f of files) {
  const img = decode(readFileSync(f));
  const L = lum(img);
  const base = f.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
  const key = Object.keys(CROPS).find((k) => base.endsWith(k));
  const regions = crop ? [['crop', crop]] : (CROPS[key] || [['frame', [0.1, 0.1, 0.8, 0.8]]]);
  let first = true;
  for (const [name, [rx, ry, rw, rh]] of regions) {
    const x0 = Math.round(rx * img.w), y0 = Math.round(ry * img.h);
    const x1 = Math.round((rx + rw) * img.w), y1 = Math.round((ry + rh) * img.h);
    const a = axes(L, x0, y0, x1, y1, 1), b = axes(L, x0, y0, x1, y1, 4);
    const ln = lines(L, x0, y0, x1, y1, 12);
    console.log(`${(first ? base : '').padEnd(27)} ${name.padEnd(9)} `
      + `${a.gx.toFixed(4)}   ${a.gy.toFixed(4)}   ${(a.gx / a.gy).toFixed(2)}  |  `
      + `${b.gx.toFixed(4)}   ${b.gy.toFixed(4)}   ${(b.gx / b.gy).toFixed(2)}`
      + `  ||  ${ln.H.toFixed(4)}  ${ln.V.toFixed(4)}   ${ln.r.toFixed(2)}`);
    first = false;
  }
}

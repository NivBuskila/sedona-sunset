/* The wash centreline.
 *
 * One spline is the authority for everything: the terrain cross-section is
 * built around it, the player walks along it, the pebble field is scattered in
 * its local frame, and `walkTo(d)` is literally arc length along it. Nothing
 * derives the wash position a second, independent way, so terrain and player
 * cannot drift apart.
 *
 * Frame convention, used consistently everywhere downstream:
 *   s  arc length in metres from the start of the walk
 *   u  signed lateral offset, positive to the player's right
 *   forward is broadly -Z, so yaw 0 in `lookAt` is up-wash toward the sun
 *
 * The curve is deliberately gentle — no more than about 12 degrees off the
 * mean axis — so that new ground opens up as you walk without the sun ever
 * swinging out of the corridor.
 */
import * as THREE from 'three';

const CTRL = [
  [0, 20], [0.5, 8], [3.5, -16], [1.0, -44], [-5.0, -70], [-9.0, -96],
  [-5.5, -122], [1.5, -146], [6.5, -172], [5.0, -200], [-1.0, -226],
  [-4.0, -252], [-2.0, -280], [0.0, -320],
];

/* z-indexed lookup. The path is monotonic in z, which makes the world→(s, u)
   inverse a table read instead of a nearest-point search — and that inverse is
   needed per terrain vertex and per player frame. */
const Z0 = 40, Z1 = -340, DZ = 0.25;
const NZ = Math.round((Z0 - Z1) / DZ) + 1;

export class WashPath {
  constructor() {
    const pts = CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);

    /* Resample by arc length. `s` below is measured from the point nearest
       z = 8, so walkTo(0) starts the player just inside the mouth of the wash
       with terrain already built behind them. */
    const N = 6000;
    const sp = this.curve.getSpacedPoints(N);
    const total = this.curve.getLength();
    this.ds = total / N;
    this.px = new Float32Array(N + 1);
    this.pz = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) { this.px[i] = sp[i].x; this.pz[i] = sp[i].z; }
    this.N = N;

    let sZero = 0;
    for (let i = 0; i <= N; i++) if (this.pz[i] > 8) sZero = i * this.ds;
    this.sZero = sZero;
    this.length = total - sZero;

    /* z → (pathX, s, tangent angle, curvature) */
    this.lx = new Float32Array(NZ);
    this.ls = new Float32Array(NZ);
    this.lt = new Float32Array(NZ);
    this.lk = new Float32Array(NZ);
    let j = 0;
    for (let i = 0; i < NZ; i++) {
      const z = Z0 - i * DZ;
      while (j < N - 1 && this.pz[j + 1] > z) j++;
      const za = this.pz[j], zb = this.pz[j + 1];
      const t = clamp01((z - za) / (zb - za || -1e-6));
      this.lx[i] = this.px[j] + (this.px[j + 1] - this.px[j]) * t;
      this.ls[i] = (j + t) * this.ds - sZero;
    }
    for (let i = 0; i < NZ; i++) {
      const a = Math.max(0, i - 2), b = Math.min(NZ - 1, i + 2);
      const dx = this.lx[b] - this.lx[a];
      const dz = -(b - a) * DZ;
      this.lt[i] = Math.atan2(dx, -dz);            // 0 when heading straight -Z
    }
    for (let i = 0; i < NZ; i++) {
      const a = Math.max(0, i - 8), b = Math.min(NZ - 1, i + 8);
      let dth = this.lt[b] - this.lt[a];
      this.lk[i] = dth / ((b - a) * DZ);           // rad per metre, + = turning right
    }
  }

  /** Table lookup by world z. */
  atZ(z, out = {}) {
    let f = (Z0 - z) / DZ;
    f = f < 0 ? 0 : f > NZ - 1.001 ? NZ - 1.001 : f;
    const i = f | 0, t = f - i;
    out.x = this.lx[i] + (this.lx[i + 1] - this.lx[i]) * t;
    out.s = this.ls[i] + (this.ls[i + 1] - this.ls[i]) * t;
    out.th = this.lt[i] + (this.lt[i + 1] - this.lt[i]) * t;
    out.k = this.lk[i] + (this.lk[i + 1] - this.lk[i]) * t;
    return out;
  }

  /** Lateral offset of a world point from the centreline, positive to the right. */
  uOf(x, z, p) {
    const q = p || this.atZ(z);
    return (x - q.x) * Math.cos(q.th);
  }

  /** World position of the centreline at arc length s. */
  posAt(s, out = new THREE.Vector3()) {
    let f = (s + this.sZero) / this.ds;
    f = f < 0 ? 0 : f > this.N - 1.001 ? this.N - 1.001 : f;
    const i = f | 0, t = f - i;
    out.set(this.px[i] + (this.px[i + 1] - this.px[i]) * t, 0,
            this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t);
    return out;
  }

  /** Heading in radians at arc length s; 0 means straight down -Z. */
  headingAt(s) {
    /* Clamped to where the path exists, which is `-sZero`, not to zero. The
       backward sample was pinned at s = 0 while the forward one was free, so
       below s = -3 the two straddled the origin backwards and the heading came
       out reversed: -177.6 deg at s = -34 and -174.5 deg at s = -3.2 against a
       true +5.7 deg, through a degenerate atan2(0, -0) = 180 deg at exactly
       s = -3 where the two samples coincide.
       That reversal flipped `cNx = cos(th) * side` in rock.js, so fifty columns
       of the wall curtain were placed on the far side of the corridor and the one
       transition column at s = -3 stretched a single quad eighty-three metres
       across it, from x -42 to x +40 at a near-constant y 46.8. The interior of
       that triangle is what draws `shade_far`'s ruler-straight skyline, and it is
       why no crest variation and no rim planting could touch it: a silhouette
       drawn across the middle of one triangle has no vertices to carry detail.
       The only callers below s = 0 are the two in rock.js, so this corrects
       geometry that was reversed and reaches nothing that was right. */
    const a = this.posAt(Math.max(-this.sZero, s - 3), this._ha || (this._ha = new THREE.Vector3()));
    const b = this.posAt(s + 3, this._hb || (this._hb = new THREE.Vector3()));
    return Math.atan2(b.x - a.x, -(b.z - a.z));
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

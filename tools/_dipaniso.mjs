/* _dipaniso.mjs — is the grit reprojection helping or hurting, per slope?
 *
 *   node tools/_dipaniso.mjs [view] [samples]
 *
 * A planar projection of a texture onto a tilted surface is anisotropic: it is
 * undistorted along the strike and stretched along the dip by one over the
 * cosine of the angle between the surface and the projection plane. For a slope
 * at theta from horizontal, with unit normal N:
 *
 *   XZ projection (the shipped default)   stretch = 1 / |N.y| = 1 / cos(theta)
 *   ZY projection (used when N.x is big)  stretch = 1 / |N.x|
 *   XY projection (used when N.z is big)  stretch = 1 / |N.z|
 *
 * and since N.x^2 + N.z^2 = sin^2(theta), the best the two vertical projections
 * can do is 1 / sin(theta). So:
 *
 *   below 45 deg   cos > sin   ->  the XZ projection is the LESS stretched one
 *   above 45 deg               ->  the vertical pair is the less stretched one
 *
 * The crossover is at 45 degrees and it is exact. But the gate that blends
 * toward the vertical pair is
 *
 *     steep = smoothstep(0.14, 0.40, 1.0 - N.y)
 *
 * which begins at 30.7 deg and saturates at 53.1 deg - it straddles the
 * crossover and reaches substantial weight well before it. On any slope between
 * 31 and 45 degrees the shader is therefore blending *toward* the projection
 * that stretches the texture more, along the dip line, which is the direction
 * the striations run.
 *
 * This measures the terrain rather than asserting it: it samples the real height
 * field over the band a view is looking at, and reports how much of that surface
 * sits in the harmful regime and what the shipped blend delivers there.
 */
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');

const VIEW = process.argv[2] ?? 'far_320';
const N = Number(process.argv[3] ?? 220);

const path = new WashPath(), terrain = new Terrain(path);

/* The band each view is looking at, in path arc length, and a lateral spread. */
const BANDS = { far_320: [300, 375], far_270: [255, 320], far_220: [205, 270] };
const [s0, s1] = BANDS[VIEW] ?? BANDS.far_320;

const EPS = 0.25;
function normalAt(x, z) {
  const h = terrain.heightAt(x, z);
  const hx = terrain.heightAt(x + EPS, z), hz = terrain.heightAt(x, z + EPS);
  const dx = (hx - h) / EPS, dz = (hz - h) / EPS;
  const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
  return { x: -dx * inv, y: inv, z: -dz * inv };
}

const smoothstep = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

const rows = [];
for (let i = 0; i < N; i++) {
  const s = s0 + (s1 - s0) * (i / (N - 1));
  const c = path.posAt(s);
  for (let j = -12; j <= 12; j++) {
    const x = c.x + j * 3.0, z = c.z + j * 0.0;
    const n = normalAt(x, z);
    const theta = Math.acos(Math.min(1, Math.max(0, n.y))) * 180 / Math.PI;
    if (theta < 12) continue;                       // floor, not a slope
    const steep = smoothstep(0.14, 0.40, 1 - n.y);
    const ax = Math.abs(n.x), az = Math.abs(n.z);
    const pw = ax / Math.max(ax + az, 1e-4);
    /* The delivered vertical stretch is the pw blend of the two verticals. */
    const sZY = 1 / Math.max(ax, 1e-4), sXY = 1 / Math.max(az, 1e-4);
    const sVert = pw * sZY + (1 - pw) * sXY;
    const sXZ = 1 / Math.max(n.y, 1e-4);
    const delivered = (1 - steep) * sXZ + steep * Math.min(sVert, 40);
    rows.push({ theta, steep, sXZ, sVert: Math.min(sVert, 40), delivered, n });
  }
}

rows.sort((a, b) => a.theta - b.theta);
const BINS = [[12, 25], [25, 31], [31, 38], [38, 45], [45, 53], [53, 90]];
console.log(`${VIEW}: terrain slopes over path s ${s0}-${s1} m, ${rows.length} samples`);
console.log('stretch along dip; 1.00 is isotropic. "harmful" = the blend is toward');
console.log('the MORE stretched projection, which happens below the 45 deg crossover\n');
console.log('  slope band      n     mean steep   XZ stretch   vert stretch   delivered   verdict');
for (const [a, b] of BINS) {
  const g = rows.filter((r) => r.theta >= a && r.theta < b);
  if (!g.length) continue;
  const mean = (f) => g.reduce((s, r) => s + f(r), 0) / g.length;
  const st = mean((r) => r.steep), xz = mean((r) => r.sXZ);
  const vt = mean((r) => r.sVert), dl = mean((r) => r.delivered);
  const harmful = vt > xz && st > 0.05;
  console.log(`  ${String(a).padStart(2)}-${String(b).padStart(2)} deg  ${String(g.length).padStart(6)}` +
    `      ${st.toFixed(2)}         ${xz.toFixed(2)}          ${vt.toFixed(2)}          ${dl.toFixed(2)}` +
    `     ${harmful ? 'HARMFUL' : 'ok'}`);
}
const bad = rows.filter((r) => r.sVert > r.sXZ && r.steep > 0.05);
const wsum = rows.reduce((s, r) => s + r.steep, 0);
console.log(`\n${(100 * bad.length / rows.length).toFixed(1)}% of sloped samples are in the harmful regime`);
console.log(`(blend weight > 0.05 and the vertical projection more stretched than XZ)`);
console.log(`mean blend weight over all sloped samples: ${(wsum / rows.length).toFixed(3)}`);

/* ---- second defect: the frame the perturbation is interpreted in ----
 * The G,B channels are a tangent-space normal expressed in the *texture's* own
 * u,v axes. Under the ZY projection those are world Z and world Y; under XY,
 * world X and world Y. But tsToWorld builds its frame from world X regardless:
 *
 *     T = normalize(X - N * dot(X, N));   B = cross(T, N);
 *
 * so nothing carries the projection's choice of axes into the interpretation.
 * This measures the angle between the axis the texture means by "u" - its world
 * axis projected into the tangent plane - and the axis tsToWorld applies it
 * along. Zero is correct; ninety is the perturbation rotated a quarter turn,
 * which puts the shading gradient along the stretched direction instead of
 * across it. */
const V = (x, y, z) => ({ x, y, z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const scl = (a, k) => V(a.x * k, a.y * k, a.z * k);
const nrm = (a) => { const L = Math.hypot(a.x, a.y, a.z) || 1e-9; return scl(a, 1 / L); };

let s = 0, n = 0, mx = 0;
for (const r of rows) {
  if (r.steep <= 0.05) continue;
  const N_ = r.n;
  const ax = Math.abs(N_.x), az = Math.abs(N_.z);
  /* Which projection dominates, and therefore what the texture means by u. */
  const uWorld = ax >= az ? V(0, 0, 1) : V(1, 0, 0);   // ZY -> u is Z; XY -> u is X
  const uProj = nrm(sub(uWorld, scl(N_, dot(uWorld, N_))));
  const axv = Math.abs(N_.x) < 0.9 ? V(1, 0, 0) : V(0, 0, 1);
  const T = nrm(sub(axv, scl(N_, dot(axv, N_))));
  const ang = Math.acos(Math.min(1, Math.abs(dot(uProj, T)))) * 180 / Math.PI;
  s += ang; n++; if (ang > mx) mx = ang;
}
console.log(`\ntangent-frame mismatch on the reprojected surface (0 correct, 90 = quarter turn)`);
console.log(`  mean ${(s / Math.max(n, 1)).toFixed(1)} deg over ${n} samples, max ${mx.toFixed(1)} deg`);

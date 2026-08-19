/* Terrain: the height field, the mesh it is sampled into, and the surface
 * shader that dresses it.
 *
 * `heightAt(x, z)` is the single source of truth for ground elevation. The
 * mesh is nothing but that function sampled on a grid, and the player's feet
 * call the same function, so the two cannot disagree — no collision mesh, no
 * raycast, no drift.
 *
 * The grid is non-uniform in both axes: dense through the walkable corridor
 * where displaced geometry has to carry the larger forms, and geometrically
 * expanding outward so that a real horizon exists without spending triangles
 * on it. One mesh, one draw call.
 */
import * as THREE from 'three';
import { fbm, ridged, clamp, smoothstep, mix } from './noise.js';

/* ── height field ──────────────────────────────────────────────────────── */

export class Terrain {
  constructor(path) {
    this.path = path;
    this._q = {};
  }

  heightAt(x, z) {
    return this.heightAtQ(x, z, this.path.atZ(z, this._q));
  }

  /**
   * Elevation at a world point, given the precomputed path frame for its z.
   * Callers that walk a whole grid row share one frame, which is most of the
   * reason the mesh builds in about a second rather than ten.
   */
  heightAtQ(x, z, q) {
    const s = q.s;
    const u = (x - q.x) * Math.cos(q.th);
    const a = Math.abs(u);
    const side = u >= 0 ? 1 : -1;

    /* ── longitudinal: the wash climbs gently as you walk up it ── */
    let h = 0.0130 * s + 1.15 * fbm(s * 0.0098, 3.7, 3, 21);

    /* ── cross-section widths ── */
    const wFloor = 6.8 + 3.2 * fbm(s * 0.0205, 12.5, 3, 51);
    const wBank = wFloor + 3.0 + 2.4 * (0.5 + 0.5 * fbm(s * 0.031, 4.0, 2, 57));

    /* Outside of a bend gets the cut bank; inside gets a low gravel bar.
       Curvature is signed with the travel direction, so this tracks the
       spline automatically instead of being placed by hand. */
    const outer = clamp(-side * q.k * 240, 0, 1);
    const bankH = 0.40 + 2.00 * outer + 0.30 * (0.5 + 0.5 * fbm(s * 0.042, 9, 2, 61));
    const bankT = smoothstep(wFloor, wBank, a);
    h += bankT * bankH;

    /* ── canyon walls ──
       An S-curve from the terrace edge to the rim: concave at the base where
       talus piles up, steepest through the middle, easing at the top. System 2
       sits rock formations on this, so the shape has to be plausible on its
       own but not pretend to be cliff geometry. */
    const openEnd = smoothstep(215, 330, s);   // let the far end breathe
    const wStart = wBank + 2.6 + 5.0 * (0.5 + 0.5 * fbm(s * 0.016, side > 0 ? 31 : 63, 3, 71));
    const wRun = 24 + 15 * (0.5 + 0.5 * fbm(s * 0.011, side > 0 ? 101 : 137, 3, 73));
    const wallH = (16 + 16 * (0.5 + 0.5 * fbm(s * 0.0085, side > 0 ? 7 : 19, 3, 79))
                 + 7 * (0.5 + 0.5 * fbm(s * 0.021, 91, 2, 83))) * (1 - 0.55 * openEnd);
    const t = clamp((a - wStart) / wRun, 0, 1);
    const ramp = t * t * (3 - 2 * t);
    h += ramp * wallH;
    /* rim country beyond the wall top, rising slowly */
    h += clamp(a - (wStart + wRun), 0, 45) * 0.20 * (0.7 + 0.3 * fbm(s * 0.02, 5, 2, 87));

    /* ── relief ──
       Evaluated in world space, not in (s, u), so it does not shear as the
       wash bends. Floor detail is centimetres; wall detail is metres. */
    const rocky = ramp;
    h += (1 - rocky) * (0.26 * fbm(x * 0.105, z * 0.105, 3, 111)
                      + 0.075 * fbm(x * 0.46, z * 0.46, 2, 113))
       + rocky * (3.1 * fbm(x * 0.031, z * 0.031, 4, 117)
                + 1.10 * fbm(x * 0.13, z * 0.13, 3, 119)
                + 0.26 * fbm(x * 0.62, z * 0.62, 2, 121));

    /* Drainage gullies down the wall face. Ridged noise in s, almost constant
       across the slope, so the grooves run down the fall line the way runoff
       cuts them — without this the walls read as dunes. */
    if (rocky > 0.02) {
      const gully = ridged(s * 0.095, a * 0.012, 3, 171);
      h -= rocky * (1.15 - rocky * 0.45) * 4.2 * smoothstep(0.42, 0.98, gully);
      /* benches where a harder bed resists, which is what breaks the
         constant-gradient look System 2 will build on */
      h += rocky * 1.6 * smoothstep(0.45, 0.62, 0.5 + 0.5 * fbm(a * 0.055, s * 0.012, 3, 181));
    }

    /* ── the riverbed itself ──
       A wandering thalweg with braided minor channels either side of it, and
       sand drifts banked up where the flow slowed. */
    const floorMask = 1 - smoothstep(wFloor * 0.72, wBank, a);
    if (floorMask > 0.001) {
      const tOff = 3.0 * fbm(s * 0.028, 21.0, 2, 141);
      const d = (u - tOff) / 2.9;
      h -= floorMask * 0.38 * Math.exp(-d * d);

      const br = ridged(s * 0.042, u * 0.115, 3, 151);
      h -= floorMask * 0.17 * smoothstep(0.52, 0.95, br);

      const drift = 0.5 + 0.5 * fbm(x * 0.055, z * 0.055, 3, 161);
      h += floorMask * 0.16 * smoothstep(0.52, 0.95, drift);
    }

    /* ── far field ──
       Beyond the wall rim the terrain becomes distant mesa country purely so
       there is a horizon to sit the sky against. It is provisional scenery,
       not System 2. */
    const far = smoothstep(140, 430, a);
    if (far > 0.001) {
      const fh = 10 + 62 * (0.5 + 0.5 * fbm(x * 0.0022, z * 0.0022, 4, 401))
                    * smoothstep(150, 620, a)
               + 18 * fbm(x * 0.0065, z * 0.0065, 3, 409);
      h = mix(h, fh, far);
      const far2 = smoothstep(700, 1500, a);
      if (far2 > 0.001) h = mix(h, 22 + 26 * fbm(x * 0.0009, z * 0.0009, 3, 419), far2);
    }

    return h;
  }
}

/* ── grid axis with a dense core and geometric falloff ─────────────────── */

function axis(coreMin, coreMax, step, outMin, outMax, growth) {
  const core = [];
  for (let v = coreMin; v <= coreMax + 1e-6; v += step) core.push(v);
  const lo = [];
  let v = coreMin, st = step;
  while (v > outMin) { st *= growth; v -= st; lo.push(v); }
  lo.reverse();
  const hi = [];
  v = coreMax; st = step;
  while (v < outMax) { st *= growth; v += st; hi.push(v); }
  return Float32Array.from([...lo, ...core, ...hi]);
}

/* ── mesh ──────────────────────────────────────────────────────────────── */

export function buildTerrainMesh(terrain, material) {
  const xs = axis(-36, 36, 0.40, -1600, 1600, 1.16);
  /* z runs from behind the start of the walk to well past its end; the core
     covers everything the standard viewpoints can get close to. */
  const zs = axis(-258, 12, 0.45, -1900, 220, 1.16);

  const nx = xs.length, nz = zs.length;
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const q = {};

  for (let j = 0; j < nz; j++) {
    const z = zs[j];
    terrain.path.atZ(z, q);
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const o = (row + i) * 3;
      pos[o] = x;
      pos[o + 1] = terrain.heightAtQ(x, z, q);
      pos[o + 2] = z;
    }
  }

  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'terrain';
  return mesh;
}

/* ── surface shader ────────────────────────────────────────────────────── */

const FRAG_PREFIX = /* glsl */`
uniform sampler2D uDirtA; uniform sampler2D uDirtN; uniform sampler2D uDirtM;
uniform sampler2D uSandA; uniform sampler2D uSandN; uniform sampler2D uSandM;
uniform sampler2D uRockA; uniform sampler2D uRockN; uniform sampler2D uRockM;
uniform sampler2D uMacro; uniform sampler2D uCrack;
uniform vec3  uDamp;
uniform float uDetail;
varying vec3 vWPos;
varying vec3 vWNrm;

float tRough;
float tAO;
vec3  tNrmW;

vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }

vec3 tsToWorld(vec3 n, vec3 N){
  vec3 ax = abs(N.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 T = normalize(ax - N * dot(ax, N));
  vec3 B = cross(T, N);
  return normalize(T * n.x + B * n.y + N * n.z);
}

vec3 triSample(sampler2D t, vec3 p, vec3 w, float sc){
  return texture2D(t, p.zy * sc).rgb * w.x
       + texture2D(t, p.xz * sc).rgb * w.y
       + texture2D(t, p.xy * sc).rgb * w.z;
}

vec3 triNormal(sampler2D t, vec3 p, vec3 w, float sc, vec3 N){
  vec3 nx = texture2D(t, p.zy * sc).xyz * 2.0 - 1.0;
  vec3 ny = texture2D(t, p.xz * sc).xyz * 2.0 - 1.0;
  vec3 nz = texture2D(t, p.xy * sc).xyz * 2.0 - 1.0;
  nx = vec3(nx.xy + N.zy, abs(nx.z) * N.x);
  ny = vec3(ny.xy + N.xz, abs(ny.z) * N.y);
  nz = vec3(nz.xy + N.xy, abs(nz.z) * N.z);
  return normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
}

/* Derivative bump: turns a scalar field into a normal perturbation without
   needing tangents or a second UV set. Used only for the mud plates. */
vec3 bumpFrom(float hgt, vec3 N, float scale){
  vec3 pdx = dFdx(vWPos), pdy = dFdy(vWPos);
  float hdx = dFdx(hgt), hdy = dFdy(hgt);
  vec3 r1 = cross(pdy, N), r2 = cross(N, pdx);
  float det = dot(pdx, r1);
  vec3 grad = sign(det) * (hdx * r1 + hdy * r2);
  return normalize(abs(det) * N - scale * grad);
}
`;

const SURFACE = /* glsl */`
vec3 gN = normalize(vWNrm);
vec2 wxz = vWPos.xz;

/* Macro variation, twice, at unrelated scales and rotations. The detail tiles
   below repeat every few metres; this is what hides that. */
vec4 mac  = texture2D(uMacro, wxz * 0.0164);
vec4 mac2 = texture2D(uMacro, rot2(wxz, 1.13) * 0.0555);

float slope = 1.0 - clamp(gN.y, 0.0, 1.0);
/* The dirt/rock boundary is broken up by macro noise at two scales, otherwise
   it falls exactly on an iso-slope contour and reads as a drawn line. */
float rockW = smoothstep(0.08, 0.72, slope + (mac2.g - 0.5) * 0.36 + (mac.g - 0.5) * 0.20);

/* ---- compacted dirt, two scales ----
   The two tiles are close in size and irrationally related, so grain, clasts
   and fissures stay the right physical size in both while the pattern
   decorrelates. A widely separated second scale instead re-reads the same
   features as larger objects, which is how procedural dirt gets its blotches. */
vec2 d1 = wxz * 0.3846;               // 2.6 m tile
vec2 d2 = rot2(wxz, 0.83) * 0.2326;   // 4.3 m tile
float dB = clamp(mac.g * 1.30 - 0.18, 0.15, 0.85);
vec3 dirtA = mix(texture2D(uDirtA, d1).rgb, texture2D(uDirtA, d2).rgb, dB);
vec3 dirtN = mix(texture2D(uDirtN, d1).xyz, texture2D(uDirtN, d2).xyz, dB) * 2.0 - 1.0;
vec3 dirtM = mix(texture2D(uDirtM, d1).rgb, texture2D(uDirtM, d2).rgb, dB);

/* ---- drifted sand ---- */
vec2 s1 = rot2(wxz, 0.35) * 0.4545;   // 2.2 m tile
vec3 sandA = texture2D(uSandA, s1).rgb;
vec3 sandN = texture2D(uSandN, s1).xyz * 2.0 - 1.0;
vec3 sandM = texture2D(uSandM, s1).rgb;

/* Sand is drifts, not a ground cover: it banks up in the lee of obstacles and
   in the slack water on the inside of bends, so the mask is deliberately mean.
   Broad sand coverage is the single fastest way to make a wash read as a dune. */
float sandW = clamp(mac.r * 1.9 + (mac2.r - 0.5) * 0.7 - 0.95, 0.0, 1.0)
            * (1.0 - rockW) * smoothstep(0.30, 0.10, slope);

vec3 gA  = mix(dirtA, sandA, sandW);
vec3 gNt = normalize(mix(dirtN, sandN, sandW));
vec3 gM  = mix(dirtM, sandM, sandW);
vec3 gWN = tsToWorld(gNt * vec3(uDetail, uDetail, 1.0), gN);

/* ---- dried mud plates ----
   Only in the flat pans where a puddle actually stood, so they read as
   patches in the wash rather than as a pattern laid over the whole floor. */
vec3 ck = texture2D(uCrack, rot2(wxz, 2.10) * 0.3846).rgb;   // 2.6 m tile
/* Water has to have stood still for mud to crack, so the slope cutoff is
   severe — about ten degrees. Allowing cracks onto a bank makes the whole
   wash look like it is wrapped in cracked glaze. */
float panW = smoothstep(0.70, 0.95, mac.b)
           * (1.0 - rockW) * (1.0 - sandW) * smoothstep(0.020, 0.004, slope);
float crackH = (ck.b * 0.40 - ck.r) * panW;
gWN = bumpFrom(crackH, gWN, 0.012);
gA *= 1.0 - ck.r * panW * 0.18;
gA *= mix(1.0, 0.94 + ck.g * 0.12, panW);
gM.r *= 1.0 - ck.r * panW * 0.25;

/* ---- wall rock, triplanar so vertical faces do not smear ---- */
vec3 triW = pow(abs(gN), vec3(4.0));
triW /= max(triW.x + triW.y + triW.z, 1e-4);
vec3 rockA = triSample(uRockA, vWPos, triW, 0.0715);   // 14 m tile
vec3 rockM = triSample(uRockM, vWPos, triW, 0.0715);
vec3 rockWN = triNormal(uRockN, vWPos, triW, 0.0715, gN);

vec3 albedo = mix(gA, rockA, rockW);
vec3 arm    = mix(gM, rockM, rockW);
vec3 wN     = normalize(mix(gWN, rockWN, rockW));

/* ---- broad tonal variation and damp shadowed dirt ---- */
float bright = (0.74 + mac.g * 0.54) * (0.88 + mac2.g * 0.26);
albedo *= bright;
float cav = mac.a;
float damp = clamp((1.0 - arm.r) * 0.60 + (1.0 - cav) * 0.40, 0.0, 1.0);
albedo = mix(albedo, albedo * uDamp, damp * 0.75);

diffuseColor.rgb *= albedo;
tRough = clamp(arm.g * (0.94 + (mac2.g - 0.5) * 0.20), 0.30, 1.0);
tAO    = clamp(arm.r * (0.74 + cav * 0.36), 0.34, 1.0);
tNrmW  = wN;
`;

export function makeTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1.0, metalness: 0.0, dithering: true,
  });
  mat.userData.uniforms = {
    uDirtA: { value: tex.dirt.albedo }, uDirtN: { value: tex.dirt.normal }, uDirtM: { value: tex.dirt.arm },
    uSandA: { value: tex.sand.albedo }, uSandN: { value: tex.sand.normal }, uSandM: { value: tex.sand.arm },
    uRockA: { value: tex.rock.albedo }, uRockN: { value: tex.rock.normal }, uRockM: { value: tex.rock.arm },
    uMacro: { value: tex.macro }, uCrack: { value: tex.crack },
    uDamp: { value: new THREE.Color(0.58, 0.47, 0.55) },
    uDetail: { value: 1.0 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);

    shader.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);');

    shader.fragmentShader = FRAG_PREFIX + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>',
        'normal = normalize((viewMatrix * vec4(tNrmW, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= tAO;');
  };
  mat.customProgramCacheKey = () => 'sedona-terrain-v1';
  return mat;
}

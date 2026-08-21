/* Does the scene still build? Answered in two seconds, without a browser.
 *
 * This exists because of a specific outage. An uncommitted edit read a variable
 * in `emit()` that was computed in its caller, so `buildScatter` threw a
 * ReferenceError before `window.__game` was ever assigned. Every capture in the
 * repo then failed as a bare readiness timeout — and a readiness timeout is
 * indistinguishable from a slow boot, so with five agents sharing one working
 * tree, four of them spent their runs debugging a fault that was not theirs.
 *
 * `node --check` cannot catch it: the syntax is valid and the reference only
 * fails when the line executes. `tools/glslcheck.mjs` cannot catch it either,
 * because it is a JavaScript error and not a shader one. What catches it is
 * running the build, and the build is pure JavaScript — the height field, the
 * facies model, the scatter placement and the instance packing all run to
 * completion with no GL context at all. Only the textures need a canvas, and
 * the material never samples them here, so a stub is enough.
 *
 * Covers the two files this project's terrain owner writes to. It deliberately
 * does not try to cover rendering: if a shader is malformed this will still pass
 * and the capture will still fail, which is what glslcheck is for. Run both.
 *
 *   node tools/_bootprobe.mjs
 */
import * as THREE from 'three';
import { Terrain, buildTerrainMesh, makeTerrainMaterial } from '../src/terrain.js';
import { WashPath } from '../src/path.js';
import { buildScatter } from '../src/scatter.js';

const t0 = Date.now();
const stub = new THREE.Texture();
const tex = {
  clast: { albedo: stub, normal: stub, arm: stub },
  grit: stub,
  dirt: { albedo: stub, normal: stub, arm: stub },
  sand: { albedo: stub, normal: stub, arm: stub },
  rock: { albedo: stub, normal: stub, arm: stub },
  macro: stub, stone: stub,
};

let failed = 0;
function step(name, fn) {
  const t = Date.now();
  try {
    const out = fn();
    console.log(`  ok    ${name.padEnd(22)} ${String(Date.now() - t).padStart(5)} ms   ${out ?? ''}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name.padEnd(22)} ${e.constructor.name}: ${e.message}`);
    if (e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }
}

console.log('\nboot probe — the pure-JS half of the scene build\n');

let terrain, mat;
step('WashPath', () => { const p = new WashPath(); terrain = new Terrain(p);
  return `${p.length.toFixed(0)} m of walk`; });

/* The height field, sampled the way the mesh samples it and then some. Walks
   the full z range including past the end of the path table, because the wash
   head lives out there and the table clamps. */
step('heightAt sweep', () => {
  let lo = Infinity, hi = -Infinity, bad = 0;
  for (let z = 20; z > -420; z -= 0.7) {
    for (let x = -60; x <= 60; x += 1.3) {
      const h = terrain.heightAt(x, z);
      if (!Number.isFinite(h)) bad++;
      if (h < lo) lo = h; if (h > hi) hi = h;
    }
  }
  if (bad) throw new Error(`${bad} non-finite heights`);
  return `y ${lo.toFixed(1)} .. ${hi.toFixed(1)} m`;
});

step('terrain material', () => { mat = makeTerrainMaterial(tex); return ''; });
step('buildTerrainMesh', () => {
  const m = buildTerrainMesh(terrain, mat);
  const n = m.geometry.attributes.position.count;
  return `${(n / 1000).toFixed(0)}k verts, ${(m.geometry.index.count / 3000).toFixed(0)}k tris`;
});

/* The one that broke. Runs every placement, every emit and every instance pack. */
step('buildScatter', () => {
  const g = buildScatter(terrain, tex);
  let inst = 0, meshes = 0;
  const visit = o => {
    if (!o) return;
    if (Array.isArray(o)) { o.forEach(visit); return; }
    if (o.isInstancedMesh) { meshes++; inst += o.count; }
    if (o.children) o.children.forEach(visit);
  };
  visit(g);
  if (!meshes) throw new Error('no instanced meshes came back');
  return `${meshes} meshes, ${inst} instances`;
});

console.log(`\n${failed ? `${failed} FAILED` : 'all ok'} in ${Date.now() - t0} ms\n`);
process.exit(failed ? 1 : 0);

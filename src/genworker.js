/* The generation worker.
 *
 * One stage of the boot, computed off the main thread and handed back as typed
 * arrays. Nothing in here touches the GPU, the DOM or a Three.js object that
 * outlives the message: a stage is arithmetic in and buffers out, which is the
 * property that makes it movable at all.
 *
 * ── why the inputs are not sent
 *
 * The obvious design posts the stage's inputs in and the arrays out. This posts
 * only a *name* in, and rebuilds the inputs here from scratch. That reads
 * wasteful and is the opposite: `new WashPath()` and `new Terrain(path)` are a
 * few milliseconds of setting up analytic fields, against the seconds of sampling
 * that follow, and structured-cloning a live generator graph across the boundary
 * is not possible at any price — it is closures and methods, not data.
 *
 * It is sound because the generators are seeded and stateless. `hash2` is a pure
 * function of position and seed, `rng(seed)` takes its seed explicitly, and no
 * module in the graph holds mutable state that generation consumes in order. So
 * the graph built in this worker is not a copy of the main thread's, it is an
 * identical one, and the arrays it produces are bit for bit the arrays the main
 * thread would have produced. Were any of that untrue — one module-level counter
 * feeding a noise term — this would silently produce a *different valley* on a
 * machine with workers than on one without, which is the failure this comment
 * exists to warn the next person away from creating.
 *
 * ── the import map
 *
 * Workers do not inherit the document's import map, so every module reachable
 * from here must avoid the bare `three` specifier; see src/three.js, which exists
 * for this reason alone.
 */

import { WashPath } from './path.js';
import { Terrain, terrainMeshArrays } from './terrain.js';
import { wallPair } from './rock.js';
import { scatterPlan } from './scatter.js';
import { packGeometries } from './bake.js';

/* Stages by name. Each returns an object of typed arrays and nothing else — the
   keys become the transfer list below, so anything in here that is not a buffer
   is a bug rather than a slow path. */
const STAGES = {
  'terrain-mesh': () => terrainMeshArrays(scene().terrain),
  /* The curtain and its apron, packed here: geometry is typed arrays until a
     renderer uploads it, and there is no renderer on this thread. */
  'wallL': () => { const s = scene(); return packGeometries(wallPair(s.path, s.terrain, -1)); },
  'wallR': () => { const s = scene(); return packGeometries(wallPair(s.path, s.terrain, +1)); },
  /* Mutates its own terrain as it places; the hollows travel back in `__scours`
     and the main thread replays them. See scatterPlan for why that is sound. */
  'scatter': () => scatterPlan(scene().terrain),
};

/* The generator graph, rebuilt once per worker.
 *
 * Cheap — analytic fields, milliseconds — but not free, and a worker that ran two
 * stages would otherwise build it twice. Kept as a lazy singleton rather than
 * module-level so that constructing it is charged to the stage that asked, and so
 * a worker spawned for a stage that never needs it does not pay at all. */
let graph = null;
function scene() {
  if (!graph) {
    const path = new WashPath();
    graph = { path, terrain: new Terrain(path) };
  }
  return graph;
}

self.onmessage = (e) => {
  const { id, stage } = e.data;
  const run = STAGES[stage];
  if (!run) {
    self.postMessage({ id, error: `unknown stage: ${stage}` });
    return;
  }
  try {
    const out = run();
    /* Transferred rather than copied: these are tens of megabytes, and a
       structured clone of them would hand back a fraction of the time the worker
       just saved. The worker's own references die with the message, which is
       correct — a stage is computed once and belongs to the caller. */
    const buffers = [];
    for (const v of Object.values(out)) if (v?.buffer) buffers.push(v.buffer);
    self.postMessage({ id, out }, buffers);
  } catch (err) {
    /* Reported rather than thrown, so the pool can fall back to computing the
       stage on the main thread. A worker that dies silently is a boot that hangs
       on a blank screen, which is worse than the wait it was trying to avoid. */
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};

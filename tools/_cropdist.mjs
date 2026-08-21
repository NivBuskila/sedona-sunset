/* How far away is each grad.mjs crop, and how many texels wide is a pixel there?
 *
 * `wall_lit` midwall reads hf/lf 0.49 and `wall_lit` upper reads 0.61 — same
 * wall, same material, same texture set, same frame. A material that had lost its
 * grain would lose it in both crops, so the difference between the two crops is
 * not amplitude, and before anything is added to the maps it is worth knowing
 * what the difference actually is.
 *
 * Raycasts a grid over each named crop and reports the distance, plus the width
 * of one pixel's footprint on the surface against the rock albedo's texel size.
 * Once a pixel covers several texels the fine octave is being resolved by the
 * mip chain rather than by the shader, and no amount of amplitude in the map can
 * come back through that filter.
 *
 *   node tools/_cropdist.mjs wall_lit
 */
import { run } from './harness.mjs';
import { VIEWS } from './views.mjs';

const view = process.argv[2] || 'wall_lit';
const v = VIEWS.find((q) => q.name === view);

/* Kept in step with tools/grad.mjs by hand; both are small and a shared module
   between two scratch tools is more coupling than it buys. */
const CROPS = {
  wall_lit: [['midwall', [0.16, 0.30, 0.20, 0.20]], ['upper', [0.62, 0.04, 0.20, 0.18]]],
};

await run({ width: 1600, height: 900, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async ([vv, crops, w, h]) => {
    const g = window.__game;
    g.walkTo(vv.d); g.lookAt(vv.yaw, vv.pitch); g.renderOnce();
    const THREE = await import('three');
    const rc = new THREE.Raycaster(); rc.far = 3000;
    const cam = g._camera;
    /* Vertical extent of one pixel in radians, which with the hit distance and the
       surface's tilt away from the view gives the footprint on the rock. */
    const pxRad = (cam.fov * Math.PI / 180) / h;
    const res = [];
    for (const [name, [x, y, cw, ch]] of crops) {
      const ds = [], foots = [], owners = new Map();
      for (let i = 1; i < 8; i++) {
        for (let j = 1; j < 8; j++) {
          const u = x + cw * i / 8, vy = y + ch * j / 8;
          rc.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - vy * 2), cam);
          const hit = rc.intersectObjects(g._scene.children, true)[0];
          if (!hit) continue;
          ds.push(hit.distance);
          owners.set(hit.object.name || hit.object.type,
            (owners.get(hit.object.name || hit.object.type) || 0) + 1);
          /* 1/cos of the angle between the view ray and the surface normal
             stretches the footprint on a slanted face. */
          const n = hit.face && hit.normal ? hit.normal.clone().transformDirection(hit.object.matrixWorld) : null;
          const cosI = n ? Math.max(0.15, Math.abs(n.dot(rc.ray.direction))) : 1;
          foots.push(hit.distance * pxRad / cosI);
        }
      }
      ds.sort((a, b) => a - b); foots.sort((a, b) => a - b);
      res.push({ name, n: ds.length,
        dMin: ds[0], dMed: ds[ds.length >> 1], dMax: ds[ds.length - 1],
        footMed: foots[foots.length >> 1],
        owners: [...owners].sort((a, b) => b[1] - a[1]).slice(0, 3) });
    }
    /* The rock albedo's world period and pixel size, so the footprint can be put
       in texels rather than left as an abstract length. */
    let tile = null, texw = null;
    g._scene.traverse((o) => {
      if (tile || !o.material) return;
      const u = o.material.userData && o.material.userData.uniforms;
      if (u && u.uWarpK && u.uRockScale) tile = u.uRockScale.value;
      if (u && u.uWarpK && o.material.map && o.material.map.image) texw = o.material.map.image.width;
    });
    return { res, tile, texw };
  }, [v, CROPS[view], 1600, 900]);

  console.log(`${view}   tile ${out.tile ?? '?'} m   map ${out.texw ?? '?'} px`);
  console.log('crop        n    dist min/med/max        px footprint');
  for (const r of out.res) {
    console.log(`${r.name.padEnd(10)} ${String(r.n).padStart(3)}  `
      + `${r.dMin.toFixed(1).padStart(6)} ${r.dMed.toFixed(1).padStart(6)} ${r.dMax.toFixed(1).padStart(6)} m   `
      + `${(r.footMed * 1000).toFixed(1).padStart(6)} mm   `
      + r.owners.map(([k, c]) => `${k}:${c}`).join(' '));
  }
});

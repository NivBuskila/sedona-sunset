/* Scratch: name the object under a given pixel of a given viewpoint.
 *
 *   node tools/_pick.mjs 30 10 -38 0.39 0.45
 *                        d  yaw pitch  u    v      (u,v are frame fractions)
 *
 * Written because a large pale flat-faced object appeared in the `ground`
 * framing and survived every change to every class it could plausibly have
 * belonged to — four renders spent narrowing it down by elimination. Asking the
 * scene graph is one render.
 */
import { run } from './harness.mjs';

const [d, yaw, pitch, u, v] = process.argv.slice(2).map(Number);

await run({ width: 1600, height: 900, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async ([d, yaw, pitch, u, v]) => {
    const g = window.__game;
    g.walkTo(d); g.lookAt(yaw, pitch); g.renderOnce();
    const THREE = await import('three');
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), g._camera);
    const hits = rc.intersectObjects(g._scene.children, true).slice(0, 4);
    return hits.map(h => ({
      name: h.object.name || h.object.type,
      dist: +h.distance.toFixed(2),
      instanced: h.object.isInstancedMesh === true,
      instanceId: h.instanceId ?? null,
      count: h.object.count ?? null,
      mat: h.object.material && h.object.material.userData
        ? Object.keys(h.object.material.userData.uniforms || {}).slice(0, 4).join(',') : '',
    }));
  }, [d, yaw, pitch, u, v]);
  console.log(JSON.stringify(out, null, 2));
});

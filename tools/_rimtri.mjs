/* Which triangle draws the skyline, and how big is it?
 *
 * System 3 established that the shade_far ruler is wallL at world (-6, 46.8, 8.2)
 * while the highest wall vertex within twelve metres of that point is at y -0.8,
 * and concluded the edge is drawn across the interior of one very large triangle
 * whose corners sit tens of metres away. That is a checkable claim about a
 * specific triangle, and if it is right the fix is tessellation rather than
 * anything to do with the crest function - a silhouette drawn through the middle
 * of one triangle cannot vary however much the crest varies, because there are no
 * vertices there to carry it.
 *
 * So ask for the triangle. Raycast the pixel, take the hit's faceIndex, read the
 * three corners out of the index buffer and report them in world space with the
 * edge lengths and the face normal. An 0.62 m grid quad and a forty-metre
 * spanning triangle are not going to be confused with each other.
 *
 * Also reports the vertical row structure at the hit column, because the wall is
 * built as columns of rows and "which row is the silhouette" is the question the
 * fix has to answer.
 *
 *   node tools/_rimtri.mjs shade_far 0.081,0.101 0.125,0.113 0.169,0.125
 */
import { run } from './harness.mjs';
import { VIEWS } from './views.mjs';

const a = process.argv.slice(2);
const view = a[0] || 'shade_far';
const pts = a.slice(1).map((s) => s.split(',').map(Number));
if (!pts.length) { console.error('_rimtri: give at least one u,v'); process.exit(2); }
const v = VIEWS.find((q) => q.name === view)
  || (() => { const [d, yaw, pitch] = view.split(',').map(Number); return { d, yaw, pitch }; })();

await run({ width: 1600, height: 900, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async ([vv, ps]) => {
    const g = window.__game;
    g.walkTo(vv.d); g.lookAt(vv.yaw, vv.pitch); g.renderOnce();
    const THREE = await import('three');
    const rc = new THREE.Raycaster(); rc.far = 4000;
    const res = [];
    for (const [u, vy] of ps) {
      rc.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - vy * 2), g._camera);
      const hit = rc.intersectObjects(g._scene.children, true)[0];
      if (!hit) { res.push({ u, v: vy, miss: true }); continue; }
      const o = hit.object, geo = o.geometry;
      const pos = geo.getAttribute('position');
      const idx = geo.index;
      const f = hit.faceIndex;
      const ia = idx ? idx.getX(f * 3) : f * 3;
      const ib = idx ? idx.getX(f * 3 + 1) : f * 3 + 1;
      const ic = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
      const w = (i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const A = w(ia), B = w(ib), C = w(ic);
      const att = geo.getAttribute('aRock');
      res.push({
        u, v: vy, name: o.name,
        hit: [hit.point.x, hit.point.y, hit.point.z].map((q) => +q.toFixed(2)),
        A: [A.x, A.y, A.z].map((q) => +q.toFixed(2)),
        B: [B.x, B.y, B.z].map((q) => +q.toFixed(2)),
        C: [C.x, C.y, C.z].map((q) => +q.toFixed(2)),
        edges: [A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)].map((q) => +q.toFixed(2)),
        nrm: hit.face ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z]
          .map((q) => +q.toFixed(2)) : null,
        /* The along-wall station of each corner, which says whether the triangle
           spans columns or rows. */
        aS: att ? [att.getY(ia), att.getY(ib), att.getY(ic)].map((q) => +q.toFixed(1)) : null,
        yRock: att ? [att.getX(ia), att.getX(ib), att.getX(ic)].map((q) => +q.toFixed(1)) : null,
      });
    }
    return res;
  }, [v, pts]);

  for (const r of out) {
    if (r.miss) { console.log(`  ${r.u},${r.v}  no hit`); continue; }
    console.log(`\n  ${r.u},${r.v}  ${r.name}   hit (${r.hit.join(', ')})   normal (${r.nrm.join(', ')})`);
    console.log(`      A (${r.A.join(', ')})`);
    console.log(`      B (${r.B.join(', ')})`);
    console.log(`      C (${r.C.join(', ')})`);
    console.log(`      edges ${r.edges.join(' / ')} m`
      + (r.aS ? `   station ${r.aS.join('/')}   colY ${r.yRock.join('/')}` : ''));
  }
});

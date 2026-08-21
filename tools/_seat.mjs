/* Do the bench plants actually stand on the ground they are drawn against?
 *
 *   node tools/_seat.mjs
 *
 * System 2 reports junipers at the wall foot with severed trunks — foliage over
 * a black gap — and proved by an apron-on/apron-off pair from one page load that
 * their colluvium is not burying them. So either my seat heights are wrong or
 * the cards are shading to black.
 *
 * The bench tier is harvested off the *rock* meshes: a vertex is taken in world
 * space and the instance is seated at that vertex's y. That is only correct if
 * the rock is the surface actually drawn at that (x, z). On a ledge lip, an
 * overhang, or anywhere the terrain has since been raised over the rock, it is
 * not — and the instance ends up in air.
 *
 * This asks the scene rather than the plan: decompose every instance matrix,
 * drop a ray from well above it onto everything solid, and report how far the
 * origin sits above the first hit. A metre of air under a card tuft is a
 * severed trunk.
 */
import { run } from './harness.mjs';

const probe = () => {
  const g = window.__game;
  const THREE = g._three;

  const solid = [];
  g._scene.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    if (/^(terrain|apron|wall|butte|talus)/.test(o.name)) solid.push(o);
  });

  const rc = new THREE.Raycaster();
  rc.far = 400;
  const down = new THREE.Vector3(0, -1, 0);
  const out = { solidNames: solid.map(o => o.name), tiers: {} };

  out.geoLo = {};
  for (const tier of ['veg-mid', 'veg-shrub', 'veg-far']) {
    const im = g._scene.getObjectByName(tier);
    if (!im || !im.isInstancedMesh) { out.tiers[tier] = 'absent'; continue; }
    /* The tier's own lowest vertex, in the geometry's units. */
    im.geometry.computeBoundingBox();
    out.geoLo[tier] = im.geometry.boundingBox.min.y;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(),
      qq = new THREE.Quaternion(), s = new THREE.Vector3();
    const rows = [];
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      m.decompose(p, qq, s);
      p.applyMatrix4(im.matrixWorld);
      rc.set(new THREE.Vector3(p.x, p.y + 120, p.z), down);
      const hit = rc.intersectObjects(solid, false);
      if (!hit.length) { rows.push({ i, air: null, y: p.y, sy: s.y }); continue; }
      /* First hit from above is the silhouette edge the viewer sees against. */
      rows.push({ i, air: +(p.y - hit[0].point.y).toFixed(3), y: +p.y.toFixed(2),
        sy: +s.y.toFixed(2), x: +p.x.toFixed(1), z: +p.z.toFixed(1),
        on: hit[0].object.name });
    }
    out.tiers[tier] = rows;
  }
  return out;
};

await run({ width: 640, height: 360, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3500);
  const r = await page.evaluate(probe);

  const geoLo = r.geoLo;
  console.log('\nsolid meshes rayed against:\n  ' + r.solidNames.join(', '));
  for (const [tier, rows] of Object.entries(r.tiers)) {
    if (typeof rows === 'string') { console.log(`\n${tier}: ${rows}`); continue; }
    const miss = rows.filter(x => x.air === null);
    const hit = rows.filter(x => x.air !== null);
    hit.sort((a, b) => b.air - a.air);
    const airs = hit.map(x => x.air).sort((a, b) => a - b);
    const q = p => airs[Math.min(airs.length - 1, Math.floor(p * airs.length))];
    console.log(`\n${tier}: ${rows.length} instances, ${miss.length} over no surface`);
    console.log(`  air under origin   p10 ${q(0.1).toFixed(2)}  median ${q(0.5).toFixed(2)}` +
      `  p90 ${q(0.9).toFixed(2)}  max ${q(1).toFixed(2)} m`);
    /* Air measured against the tier's own lowest vertex rather than a guess.
       The first version of this assumed a tuft hangs 0.24 units below its
       origin, which is exactly the thing that turned out to be false — the
       bench tier's lowest vertex was at *+0.074*, so the check reported 0.9%
       floating on a tier where every large instance hovered. Ask the geometry. */
    const lo = geoLo[tier];
    const bad = hit.filter(x => x.air + lo * x.sy > 0.02);
    console.log(`  lowest vertex in local y   ${lo.toFixed(3)}`);
    console.log(`  hovering (lowest vertex clear of ground)   ${bad.length}` +
      `  = ${(100 * bad.length / rows.length).toFixed(1)}%`);
    for (const b of bad.slice(0, 12))
      console.log(`    #${b.i} air ${b.air.toFixed(2)} m  sy ${b.sy}` +
        `  at (${b.x}, ${b.z}) y ${b.y}  over ${b.on}`);
  }
});

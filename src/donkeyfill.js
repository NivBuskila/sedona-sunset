/* ── the animal's fill light ────────────────────────────────────────────────
 *
 * A warm bounce term added to the donkey's materials and to nothing else.
 *
 * WHY THIS EXISTS, and it is not because the shading was wrong. It was measured
 * first: with the sun at 15° elevation the wash floor reads luminance 147, the
 * animal's sunlit topline reads 73, its shaded flank 20-37, and terrain sitting
 * in shadow reads 23. So the animal is brighter than anything else in shadow and
 * its top carries exactly the ratio its albedo predicts against the floor — the
 * renderer is behaving. The problem is staging: the sun is *ahead* along the
 * corridor and the follow camera rides behind, so the camera spends the whole
 * traverse on the animal's shaded side and it reads as a silhouette.
 *
 * The honest physical content of the term is the one thing a lone SH probe plus a
 * horizon band cannot deliver at this scale: a quadruped standing on sunlit
 * sandstone is wrapped in bounce off the metre of ground immediately around and
 * under it. The terrain's own s4GroundBand approximates that with a horizon
 * annulus fitted for facets on the floor, which is the right model for a clast
 * and the wrong one for a body held 0.7 m above the floor on legs.
 *
 * WHY IT IS A MATERIAL PATCH AND NOT A LIGHT. three does not support per-object
 * lights. `Object3D.layers` on a light is tested against the *camera's* layers,
 * not against each mesh's (three.module.js:16154), so a second DirectionalLight
 * restricted to a layer either lights the whole scene or nothing in it. Adding a
 * real light here would have lit the terrain too and flattened the canyon.
 *
 * WHY IT DOES NOT WASH OUT THE LIT SIDE. The term is weighted by `away²`, which
 * is zero on any facet pointing at the sun and one on a facet pointing directly
 * away, so the sunlit topline keeps the value it measured at and only the shaded
 * half is lifted. A flat ambient add would have raised both and taken the form
 * out of the animal, which is the failure this shape exists to avoid.
 */
import * as THREE from 'three';

/* Warm, because it is sandstone bounce and not skylight: the corridor floor is
   red rock under a low sun, so the light coming back up off it is far warmer than
   the sky above. Magnitude is in the same units as `dotNL * sun.intensity` — the
   floor's own direct term is 0.26 * 13.7 = 3.6 — and was tuned by measuring the
   shaded flank back up into the 60-75 band, level with the animal's own sunlit
   topline at 73. Past about 2.6 the flank overtakes the topline and the animal
   starts to look lit from the camera, which is the tell of an overdone fill. */
const FILL = new THREE.Color(1.00, 0.63, 0.44).multiplyScalar(2.55);

const GLSL = `
#if defined( RE_IndirectDiffuse )
  {
    /* geometryNormal is view space; the sun direction uniform is world space. */
    vec3 dfN = inverseTransformDirection( geometryNormal, viewMatrix );
    /* 0 on a facet facing the sun, 1 on one facing directly away. */
    float dfAway = 0.5 - 0.5 * dot( dfN, uDonkeyFillSun );
    /* 1 on the back, 0 on the belly: the underside is closed off by the barrel
       above it and the four legs around it, so it gets roughly half the fill an
       exposed flank does.
       Worth recording what this factor did NOT do, so nobody re-derives it. It
       was added to correct a measured inversion — the animal's lower third read
       54 against 47 for its flank, the underside being its brightest part — and
       it barely moved that number. The inversion is not the belly at all: the
       lower third is mostly *legs*, near-vertical cylinders whose normals are
       horizontal, so a factor keyed on N.y cannot reach them. It is kept because
       the reasoning about the belly proper is sound and it costs one multiply,
       not because it fixed the thing it was aimed at. */
    float dfUp = 0.5 + 0.5 * dfN.y;
    irradiance += uDonkeyFillCol * ( dfAway * dfAway * ( 0.55 + 0.45 * dfUp ) );
  }
#endif
`;

/**
 * Patches every material given so that it — and only it — receives the fill.
 *
 * @param {THREE.Material[]} materials  the animal's materials
 * @param {THREE.DirectionalLight} sun  read for its world-space direction
 * @returns {{ update: () => void }}    call when the sun may have moved
 */
export function installDonkeyFill(materials, sun) {
  /* One uniform object shared by every material, so the per-frame update is a
     single vector write rather than one per body part. */
  const uSun = { value: new THREE.Vector3(0, 1, 0) };
  const uCol = { value: FILL };

  const ANCHOR = '#include <lights_fragment_begin>';
  for (const m of materials) {
    m.onBeforeCompile = (shader) => {
      /* onBeforeCompile runs before three resolves #include, so the anchor is
         still a one-line directive here and this needs to know nothing about the
         chunk's contents — which is what keeps it working across three versions.
         The chunk declares `irradiance` inside a plain #if and not a block, so it
         is still in scope on the line after. */
      if (!shader.fragmentShader.includes(ANCHOR)) {
        throw new Error('donkeyfill: lights_fragment_begin is gone; fill not installed');
      }
      shader.uniforms.uDonkeyFillSun = uSun;
      shader.uniforms.uDonkeyFillCol = uCol;
      shader.fragmentShader =
        'uniform vec3 uDonkeyFillSun;\nuniform vec3 uDonkeyFillCol;\n' +
        shader.fragmentShader.replace(ANCHOR, ANCHOR + GLSL);
    };
    m.needsUpdate = true;
  }

  const dir = new THREE.Vector3();
  return {
    update() {
      /* The light rides the shadow cascade rig, so its position moves every few
         frames while its direction does not. Recomputed rather than cached
         because the cost is one subtract and the alternative is a stale beam if
         the sky ever animates. */
      dir.subVectors(sun.position, sun.target.position);
      if (dir.lengthSq() > 0) uSun.value.copy(dir.normalize());
    },
  };
}

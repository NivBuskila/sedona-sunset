/* The canonical camera framings, in one place.
 *
 * This table used to live inside tools/shoot.mjs, and tools/sundisc.mjs carried a
 * hand-copied duplicate of it that had drifted: wash_low was d 18 pitch 0 there
 * against d 8 pitch -4 here, and bend was d 78 yaw -28 against d 92 yaw -22. So
 * every occlusion verdict and every azimuth sweep that tool produced was raycast
 * from a camera that never appears in a capture, and the sun it projected to
 * screen 0.365,0.25 is drawn at 0.325,0.171 in the frame the reviewer is actually
 * looking at. Anything that needs to reason about what a capture contains imports
 * from here, so the two can no longer disagree.
 */
export const VIEWS = [
  { name: 'wash_low',   d: 8,   yaw: 0,    pitch: -4 },
  { name: 'wash_mid',   d: 46,  yaw: 0,    pitch: 0 },
  { name: 'ground',     d: 30,  yaw: 10,   pitch: -38 },
  { name: 'wall_lit',   d: 46,  yaw: 72,   pitch: 12 },
  { name: 'wall_shade', d: 46,  yaw: -104, pitch: 10 },
  { name: 'bend',       d: 92,  yaw: -22,  pitch: 2 },
  { name: 'juniper',    d: 62,  yaw: 34,   pitch: 3 },
  { name: 'sun_gap',    d: 120, yaw: 0,    pitch: 6 },
  /* The cool half of the walk, which until now nothing photographed.
   *
   * The eight above stop at 120 m and five of them sit at 46 m or nearer, inside
   * the part of the corridor whose walls fill 45 to 80 degrees of their sky with
   * sunlit red rock. Warm shade there is what correct light transport gives and it
   * is not going to be faked. But tools/_skydist.mjs measures the corridor opening
   * astern as the walk lengthens - the up-canyon skyline falls from 80 degrees at
   * 8 m to about 17 past 160 - so the fill's away-from-sun lobe arrives at hue 317
   * out here where it arrives at hue 10 at the head of the walk. The player
   * traverses this; the camera never did. Every critique this project has received
   * was formed on the warm half, which is a sampling failure on our side rather
   * than anything about the scene.
   *
   * Chosen by looking, in tools/_scout.mjs, over three stations and eleven
   * bearings. The brief is shaded ground against sunlit wall because the contrast
   * is the point and not the shade on its own - a frame of uniformly cool dirt
   * would prove the fill works and say nothing about whether the warm/cool split
   * reads. This bearing puts shaded floor across the right foreground with a soft
   * terminator through it, sunlit floor at the left, and a sunlit stratified wall
   * behind, so warm and cool are in one frame and can be compared without
   * remembering another. 160 m rather than further because the outer wash is wide
   * and its floor is largely grazing-lit: past about 180 the shaded fraction falls
   * away and there is nothing to contrast. The astern aperture mix here is 0.945.
   */
  { name: 'shade_far',  d: 160, yaw: -155, pitch: -4 },
];

export const byName = (n) => VIEWS.find((v) => v.name === n);

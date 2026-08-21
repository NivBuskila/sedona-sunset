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
];

export const byName = (n) => VIEWS.find((v) => v.name === n);

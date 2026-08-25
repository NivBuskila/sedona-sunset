/**
 * The scene's wind, in one place.
 *
 * WHY THIS FILE EXISTS. There were two winds and they disagreed by 63°. The
 * juniper leaned along `(0.94, 0.34)` while the dust, the saltation ribbons, the
 * bed drift and the whole soundscape ran off a `WIND_HEADING = 0.12` that was
 * declared *twice*, once in `atmosphere.js` and once in `audio.js`, each with a
 * comment asking the other to stay in step. Nothing enforced any of it. The
 * previous attempt at a fix was to rename the juniper's export `PREVAILING` so
 * its name could no longer imply an agreement it did not have — which documented
 * the split honestly but left the scene showing a tree leaning across a wind
 * nothing blew along. Comments cannot hold two constants together. A single
 * declaration can, so the headings live here and every system imports them.
 *
 * ON THE 63°. The delivery contract records this gap as 76°. It is 63.3°:
 * `(0.94, 0.34)` normalises to a heading of 1.2254 rad = 70.2°, tonight's is
 * 0.12 rad = 6.9°, and the angle between the two unit vectors is
 * `acos(0.4503) = 63.2°` by either route. The 76° is corrected here rather than
 * repeated, per the project's own rule that a figure outlives the day it was
 * measured on.
 *
 * BOTH HEADINGS ARE THE DIRECTION THE WIND BLOWS *TOWARD*, in radians, measured
 * the way `WashPath` measures: 0 means +Z, which is down-wash and away from the
 * sun. So the wind is in your face walking up the wash, sand streams past you
 * toward the mouth, and grains pile on the up-wash faces of the clasts — which
 * is the side System 1 already drew them piled on.
 */

/**
 * Tonight's wind: the gust bed, the saltation, the sand deposited this evening,
 * and the sound. This is the number that does not move. Three systems are tuned
 * against it, `syncWind()` bakes the terrain's drift from the mean of it, and the
 * delivery captures were measured with it — so reconciling the two winds means
 * moving the juniper to meet this, never the reverse.
 */
export const TONIGHT_HEADING = 0.12;

/**
 * How far the prevailing wind sits off tonight's, and the one number to turn if
 * the juniper's lean wants redirecting.
 *
 * It is not zero, and that is deliberate on two counts. Physically the two are
 * different quantities: a tree's lean records years of prevailing wind while
 * tonight's breeze is one evening's weather, and a canyon channels both along
 * its axis without pinning them to the same bearing. And there is an art
 * constraint that predates this file — the juniper's lean was aimed *across* the
 * wash rather than along it so that it reads as a lean in the hero framing
 * instead of foreshortening to nothing. Folding the lean flat onto tonight's
 * down-wash heading would satisfy the arithmetic and lose the tree.
 *
 * 0.62 rad keeps a little over half the cross-wash component that framing needs
 * while cutting the disagreement from 63.3° to 35.5°, so the two winds now share
 * an axis and a sense instead of reading as perpendicular.
 */
export const PREVAILING_OFFSET = 0.62;

/** The multi-year wind the juniper's lean and its litter drift record. */
export const PREVAILING_HEADING = TONIGHT_HEADING + PREVAILING_OFFSET;

/** A heading as the `[x, z]` unit vector it points along. */
export const headingToVec = (h) => [Math.sin(h), Math.cos(h)];

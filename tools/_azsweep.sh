#!/bin/bash
# Empirical sweep of the two levers that can put sun back on the wash floor:
# the sun's azimuth through the butte gap, and its elevation over the skyline.
# One 800x450 pair per setting, ~35 s each on the GPU.
set -e
cp src/atmos.js /tmp/atmos.orig
for cfg in "-5 8" "0 8" "6 8" "-13 11" "-13 14"; do
  set -- $cfg
  az=$1; el=$2
  tag="az${az}el${el}"
  tag=${tag//-/m}
  perl -pi -e "s/^export const SUN_AZ_DEG = [-\d.]+;/export const SUN_AZ_DEG = $az.0;/; s/^export const SUN_EL_DEG = [-\d.]+;/export const SUN_EL_DEG = $el.0;/" src/atmos.js
  echo "=== az $az el $el -> $tag"
  node tools/shoot.mjs "$tag" --only wash_mid,wall_lit --w 800 --h 450 2>&1 | grep -E "wash_mid|wall_lit|shots"
done
cp /tmp/atmos.orig src/atmos.js
echo "restored"
grep -n "SUN_AZ_DEG = \|SUN_EL_DEG = " src/atmos.js

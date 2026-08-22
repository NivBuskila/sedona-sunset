/* Offline analysis of the lens ghosts. Reads captures that already exist and
 * touches no GPU.
 *
 * Recovers the sun's screen position per view from the ablation blobs, because
 * nothing in the manifest records it: each ghost sits at mix(uSun, CTR, t), so a
 * blob centroid and its known t invert to uSun = (gp - t*CTR) / (1 - t). With uSun
 * in hand every disc's footprint is known analytically, which gives both what it
 * overlays and a calibrated peak amplitude.
 */
import fs from 'fs';
import { decode } from './png.mjs';

/* the shipped table: t, r, tint rgb, intensity */
const GHOSTS = [
  [-0.34, 0.045, 1.00, 0.62, 0.34, 0.55],
  [0.30, 0.026, 0.55, 0.76, 1.00, 0.30],
  [0.63, 0.078, 1.00, 0.86, 0.56, 0.20],
  [1.00, 0.019, 0.68, 1.00, 0.84, 0.42],
  [1.44, 0.118, 0.38, 0.56, 1.00, 0.12],
  [1.87, 0.056, 1.00, 0.72, 0.46, 0.16],
];
const A_PEAK = 0.72 + 0.60;          /* rim boost at its maximum */
const GAIN_TEST = 0.5;               /* the ablation arm's #ghost */
const SHIPPED = 0.0014;

/* ── the numeric chain, so encoded code values can be read as scene-linear ──── */
const EXPOSURE=0.95,CONTRAST=1.03,PIV=0.5,TOE_TOP=0.111,TOE_SLOPE=1.0,SH_TOP=0.86,SH_SLOPE=0.45;
const M=(m,v)=>[m[0]*v[0]+m[3]*v[1]+m[6]*v[2],m[1]*v[0]+m[4]*v[1]+m[7]*v[2],m[2]*v[0]+m[5]*v[1]+m[8]*v[2]];
const IN=[0.59719,0.076,0.0284,0.35458,0.90834,0.13383,0.04823,0.01566,0.83777];
const OUT=[1.60475,-0.10208,-0.00327,-0.53108,1.10813,-0.07276,-0.07367,-0.00605,1.07602];
const rrt=v=>(v*(v+0.0245786)-0.000090537)/(v*(0.983729*v+0.432951)+0.238081);
const cl=v=>Math.max(0,Math.min(1,v));
const acesY=y=>{let c=[y,y,y].map(v=>v*EXPOSURE/0.6);c=M(IN,c).map(rrt);return cl(M(OUT,c)[0]);};
const oetf=v=>v<=0.0031308?v*12.92:Math.pow(v,0.41666)*1.055-0.055;
function transfer(le){const k=CONTRAST,p=PIV,A=TOE_TOP,B=SH_TOP;
 if(B>0&&le>B){const vB=(B-p)*k+p,h=1-B,u=(le-B)/h,u2=u*u,u3=u2*u;
  return vB*(2*u3-3*u2+1)+h*k*(u3-2*u2+u)+(-2*u3+3*u2)+h*SH_SLOPE*(u3-u2);}
 if(le>=A)return cl((le-p)*k+p);
 const vA=(A-p)*k+p,u=le/A,u2=u*u,u3=u2*u;
 return Math.max(0,A*TOE_SLOPE*(u3-2*u2+u)+vA*(-2*u3+3*u2)+A*k*(u3-u2));}
const fwd=y=>transfer(oetf(acesY(y)));
const INV=(()=>{const N=4096,xs=[],ys=[];
 for(let i=0;i<=N;i++){const y=Math.pow(10,-5+i*(Math.log10(60)+5)/N);xs.push(y);ys.push(fwd(y));}
 return e=>{if(e<=ys[0])return xs[0];if(e>=ys[N])return xs[N];
  let lo=0,hi=N;while(hi-lo>1){const m=(lo+hi)>>1;if(ys[m]<e)lo=m;else hi=m;}
  const t=(e-ys[lo])/Math.max(ys[hi]-ys[lo],1e-12);return xs[lo]+t*(xs[hi]-xs[lo]);};})();

const lum=(im,i)=>(0.2126*im.px[i]+0.7152*im.px[i+1]+0.0722*im.px[i+2])/255;

/* ── blob detection on the ghost delta ─────────────────────────────────────── */
function blobs(A, B) {
  const w = A.w, h = A.h, seen = new Uint8Array(w * h);
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * A.ch;
    let s = 0;
    for (let c = 0; c < 3; c++) s += Math.max(0, B.px[p + c] - A.px[p + c]);
    d[i] = s / 3;
  }
  const out = [], THR = 6;
  const stack = new Int32Array(w * h);
  for (let i0 = 0; i0 < w * h; i0++) {
    if (seen[i0] || d[i0] < THR) continue;
    let n = 0, sx = 0, sy = 0, cnt = 0, peak = 0;
    stack[n++] = i0; seen[i0] = 1;
    while (n) {
      const i = stack[--n], x = i % w, y = (i - x) / w;
      sx += x; sy += y; cnt++; if (d[i] > peak) peak = d[i];
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && d[j] >= THR) { seen[j] = 1; stack[n++] = j; }
      }
    }
    if (cnt < 60) continue;
    out.push({ cx: sx / cnt, cy: sy / cnt, px: cnt, rpx: Math.sqrt(cnt / Math.PI), peak });
  }
  return { list: out.sort((a, b) => b.px - a.px), d };
}

const VIEWS = ['sun_gap', 'wash_mid', 'juniper', 'bend'];
console.log('\n  ghost blobs recovered from the #ghost=0 / #ghost=0.5 ablation, 1280x720');
console.log('  matching each blob to its table entry by radius (r * frame height)\n');

for (const v of VIEWS) {
  const A = decode(fs.readFileSync(`shots/sys7gdiag_${v}.png`));
  const B = decode(fs.readFileSync(`shots/sys7gdiagB_${v}.png`));
  const { list } = blobs(A, B);
  console.log(`  ${v}  (${list.length} blobs found)`);
  /* match by radius: expected radius in px is r * h */
  const used = new Set();
  const suns = [];
  for (const b of list) {
    let best = -1, err = 1e9;
    GHOSTS.forEach((g, k) => {
      if (used.has(k)) return;
      const e = Math.abs(g[1] * A.h - b.rpx) / (g[1] * A.h);
      if (e < err) { err = e; best = k; }
    });
    if (best < 0 || err > 0.55) continue;
    used.add(best);
    const t = GHOSTS[best][0];
    const gx = b.cx / A.w, gy = b.cy / A.h;
    if (Math.abs(1 - t) > 1e-3) suns.push([(gx - t * 0.5) / (1 - t), (gy - t * 0.5) / (1 - t)]);
    console.log(`    t=${String(t).padStart(5)}  r=${GHOSTS[best][1].toFixed(3)}  centre (${gx.toFixed(3)},${gy.toFixed(3)})  ` +
                `radius ${b.rpx.toFixed(0)}px vs expected ${(GHOSTS[best][1] * A.h).toFixed(0)}px  peak delta ${b.peak.toFixed(0)}cv`);
  }
  if (suns.length) {
    const sx = suns.reduce((a, s) => a + s[0], 0) / suns.length;
    const sy = suns.reduce((a, s) => a + s[1], 0) / suns.length;
    const spread = Math.max(...suns.map(s => Math.hypot(s[0] - sx, s[1] - sy)));
    console.log(`    => sun at uv (${sx.toFixed(3)}, ${sy.toFixed(3)}), agreement across discs ±${spread.toFixed(3)}`);
  }
  console.log('');
}

/* ── what each disc overlays, and a calibrated amplitude ────────────────────── */
const SUN = { sun_gap: [0.328, 0.340], wash_mid: [0.484, 0.190], juniper: [0.221, 0.274], bend: [0.716, 0.270] };

function alphaGeom(d, r) {
  const ss = (a, b, x) => { const t = cl((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  return ss(r, r * 0.70, d) * (0.72 + 0.60 * ss(r * 0.50, r * 0.94, d));
}

console.log('  ── per-disc footprint, background and calibrated contrast ──');
console.log('  contrast = ghost peak / local background, both scene-linear, at the SHIPPED gain 0.0014');
console.log('  and at candidate gains. "sky" vs "terrain" is read from the frame under the disc.\n');
console.log('  view      t      lands at      overlay   bg(lin)  peak/bg @0.0014   @0.02   @0.04   @0.08');

const rows = [];
for (const v of VIEWS) {
  const A = decode(fs.readFileSync(`shots/sys7gdiag_${v}.png`));
  const B = decode(fs.readFileSync(`shots/sys7gdiagB_${v}.png`));
  const [sx, sy] = SUN[v];
  for (const [t, r, tr, tg, tb, gi] of GHOSTS) {
    const gx = sx + (0.5 - sx) * t, gy = sy + (0.5 - sy) * t;
    if (gx < -0.2 || gx > 1.2 || gy < -0.2 || gy > 1.2) continue;
    const aspect = A.w / A.h;
    let bgSum = 0, bgN = 0, ratios = [], skyN = 0, allN = 0;
    for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
      const u = (x + 0.5) / A.w, w2 = (y + 0.5) / A.h;
      const d = Math.hypot((u - gx) * aspect, w2 - gy);
      if (d > r * 1.05) continue;
      const i = (y * A.w + x) * A.ch;
      const la = INV(lum(A, i)), lb = INV(lum(B, i));
      bgSum += la; bgN++;
      allN++;
      /* sky or terrain? sky here is bright and blue-ish relative to the rock */
      if (A.px[i + 2] >= A.px[i] * 0.72) skyN++;
      const ag = alphaGeom(d, r);
      const clipped = B.px[i] >= 250 || B.px[i + 1] >= 250 || B.px[i + 2] >= 250;
      if (!clipped && ag > 0.20 && ag < 0.95) ratios.push((lb - la) / ag);
    }
    if (!bgN || ratios.length < 30) continue;
    ratios.sort((a, b) => a - b);
    const C = ratios[Math.floor(ratios.length / 2)];       /* coefficient at gain 0.5 */
    const peakAtTest = C * A_PEAK;
    const bg = bgSum / bgN;
    const pct = g => 100 * peakAtTest * (g / GAIN_TEST) / bg;
    const overlay = skyN / allN > 0.6 ? 'sky' : (skyN / allN > 0.25 ? 'mixed' : 'TERRAIN');
    rows.push({ v, t, gi, overlay, bg, pct });
    console.log(`  ${v.padEnd(9)} ${String(t).padStart(5)}  (${gx.toFixed(2)},${gy.toFixed(2)})   ` +
      `${overlay.padStart(8)}  ${bg.toFixed(3).padStart(6)}   ${pct(SHIPPED).toFixed(2).padStart(6)}%  ` +
      `${pct(0.02).toFixed(1).padStart(6)}% ${pct(0.04).toFixed(1).padStart(6)}% ${pct(0.08).toFixed(1).padStart(6)}%`);
  }
}
console.log('\n  ── if the discs at t>=1 are dropped, what remains ──');
const keep = rows.filter(r => r.t < 1);
for (const g of [0.01, 0.02, 0.03, 0.04, 0.06, 0.08]) {
  const vals = keep.map(r => r.pct(g));
  console.log(`  gain ${g.toFixed(3)}:  kept discs sit at ${Math.min(...vals).toFixed(1)}%-${Math.max(...vals).toFixed(1)}% of local background` +
    `  (median ${vals.sort((a,b)=>a-b)[Math.floor(vals.length/2)].toFixed(1)}%)`);
}

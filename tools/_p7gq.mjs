/* Quantify the ghost term from a #ghost=0 pair: how much of the frame it touches,
 * how hard it pushes, and -- the figure the gain was chosen against -- its peak as
 * a fraction of the local background it sits on.
 *
 * The last one is the whole argument. An additive disc at fixed amplitude is
 * invisible on bright sky and a blob on shaded rock, because the background under
 * these discs spans a hundredfold range, so "how bright is the ghost" is not a
 * meaningful question on its own. Everything here is reported against the local
 * background in scene-linear, which is the only frame in which the number means
 * anything.
 *
 *   node tools/_p7gq.mjs sys7gh sun_gap wash_mid juniper bend
 */
import fs from 'fs';
import { decode } from './png.mjs';

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

const tag = process.argv[2];
const views = process.argv.slice(3);
if (!tag || !views.length) { console.error('usage: _p7gq.mjs <tag> <view...>'); process.exit(1); }

console.log(`\n  ghost term, ${tag} vs ${tag}_ghost0`);
console.log('  peak/bg is the disc peak over the local background it sits on, both scene-linear.');
console.log('  A real ghost sits at a few percent of what it overlays; that is what 0.03 was set to.\n');
console.log('  view       touched   peak cv   peak/bg   pixels over 10% of bg   over 25%   max bg   min bg');

for (const v of views) {
  const A = decode(fs.readFileSync(`shots/${tag}_ghost0_${v}.png`));
  const B = decode(fs.readFileSync(`shots/${tag}_${v}.png`));
  let touched = 0, peakCv = 0, peakRatio = 0, n10 = 0, n25 = 0, maxBg = 0, minBg = 1e9;
  for (let i = 0; i < A.w * A.h; i++) {
    const p = i * A.ch;
    let dmax = 0;
    for (let c = 0; c < 3; c++) dmax = Math.max(dmax, B.px[p + c] - A.px[p + c]);
    if (dmax <= 0) continue;
    touched++;
    if (dmax > peakCv) peakCv = dmax;
    const la = INV((0.2126 * A.px[p] + 0.7152 * A.px[p+1] + 0.0722 * A.px[p+2]) / 255);
    const lb = INV((0.2126 * B.px[p] + 0.7152 * B.px[p+1] + 0.0722 * B.px[p+2]) / 255);
    const r = (lb - la) / Math.max(la, 1e-6);
    if (r > peakRatio) { peakRatio = r; }
    if (r > 0.10) n10++;
    if (r > 0.25) n25++;
    if (la > maxBg) maxBg = la;
    if (la < minBg) minBg = la;
  }
  const pct = 100 * touched / (A.w * A.h);
  console.log(`  ${v.padEnd(10)} ${pct.toFixed(2).padStart(5)}%  ${String(peakCv).padStart(6)}cv  ` +
    `${(100 * peakRatio).toFixed(1).padStart(6)}%  ${String(n10).padStart(12)} (${(100*n10/(A.w*A.h)).toFixed(3)}%)  ` +
    `${String(n25).padStart(7)}  ${maxBg.toFixed(3).padStart(6)}  ${minBg.toFixed(4).padStart(7)}`);
}
console.log('\n  "over 25% of bg" is the blob count: discs reading that hard against what they');
console.log('  sit on are what the gate exists to prevent. Zero is the target, not a small number.');

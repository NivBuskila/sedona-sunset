/* Predict the shadow gate and the facet level for a lift keyed on BOTH luminance
 * and local contrast, over the real pixel population.
 *
 * lift = 1 + (gain-1) * wLum(y)^2 * wMask(m)
 *   wLum  = max(0, 1 - y/knee)        excludes lit rock and the sunlit floor
 *   wMask = smoothstep(lo, hi, blurLuma - luma)   excludes the interior of a large
 *                                                 shadow, however dark it is
 *
 * The luminance key alone cannot work: the facet and the shaded floor are 1.27
 * stops apart and the gate is a mean over a shaded window. The mask is the second
 * axis, and it is the one the two populations actually differ on — a clast side
 * face is small and surrounded by blazing ground, the shaded wall is large and
 * uniform. Measured on the shipped frames the mask is 0.219 on ground's facets
 * against 0.011 inside the gate window.
 */
import fs from 'fs';
import { decode } from './png.mjs';

/* ── the shipped forward chain, on neutral luminance ───────────────────────── */
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
 for(let i=0;i<=N;i++){const y=Math.pow(10,-5+i*(Math.log10(30)+5)/N);xs.push(y);ys.push(fwd(y));}
 return e=>{let lo=0,hi=N;while(hi-lo>1){const m=(lo+hi)>>1;if(ys[m]<e)lo=m;else hi=m;}
  const t=(e-ys[lo])/Math.max(ys[hi]-ys[lo],1e-12);return xs[lo]+t*(xs[hi]-xs[lo]);};})();

function plane(file){const im=decode(fs.readFileSync(file));
 const L=new Float32Array(im.w*im.h);
 for(let i=0,p=0;i<L.length;i++,p+=im.ch)L[i]=(0.2126*im.px[p]+0.7152*im.px[p+1]+0.0722*im.px[p+2])/255;
 return {L,w:im.w,h:im.h};}
function blur(L,w,h,r,passes=3){let a=Float32Array.from(L),b=new Float32Array(L.length);
 for(let k=0;k<passes;k++){
  for(let y=0;y<h;y++){let acc=0;const row=y*w;
   for(let x=-r;x<=r;x++)acc+=a[row+Math.min(w-1,Math.max(0,x))];
   for(let x=0;x<w;x++){b[row+x]=acc/(2*r+1);acc+=a[row+Math.min(w-1,x+r+1)]-a[row+Math.max(0,x-r)];}}
  for(let x=0;x<w;x++){let acc=0;
   for(let y=-r;y<=r;y++)acc+=b[Math.min(h-1,Math.max(0,y))*w+x];
   for(let y=0;y<h;y++){a[y*w+x]=acc/(2*r+1);acc+=b[Math.min(h-1,y+r+1)*w+x]-b[Math.max(0,y-r)*w+x];}}}
 return a;}

const GATE=[0.30,0.24,0.34,0.34];
const R=24;
const cache={};
const MODE=process.argv.includes('--taps')?'taps':'blur';
const NT=parseInt(process.argv[process.argv.indexOf('--nt')+1]||'8',10);
/* the cheap shader-friendly variant: N taps on a spiral, compared against the
   local MAXIMUM rather than a mean. Max is far more stable with few taps, and it
   is the signal that matters — a facet is dark *next to blazing ground*, so one
   bright tap is enough, while the interior of a large shadow has no bright tap at
   any count. */
function tapMask(L,w,h){
 /* on sqrt(scene-linear), because that is the space the shader has: it holds
    linear radiance at this point and a square root is one instruction, where
    reproducing ACES-plus-OETF per tap is not. Thresholds are swept in this same
    space so prediction and implementation cannot drift apart. */
 const S=new Float32Array(L.length);
 for(let i=0;i<L.length;i++)S[i]=Math.sqrt(INV(L[i]));
 L=S;
 const out=new Float32Array(L.length);
 const offs=[];
 for(let i=0;i<NT;i++){const a=i*2.39996323,r=R*Math.sqrt((i+0.5)/NT);
  offs.push([Math.round(Math.cos(a)*r),Math.round(Math.sin(a)*r)]);}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;let mx=L[i];
  for(const [dx,dy] of offs){const xx=Math.min(w-1,Math.max(0,x+dx)),yy=Math.min(h-1,Math.max(0,y+dy));
   const v=L[yy*w+xx];if(v>mx)mx=v;}
  out[i]=Math.max(0,mx-L[i]);}
 return out;}
const get=v=>{if(cache[v])return cache[v];
 const p=plane(`shots/sys7lift_lift1_${v}.png`);
 if(MODE==='taps'){p.B=new Float32Array(p.L.length);const m=tapMask(p.L,p.w,p.h);
  for(let i=0;i<p.L.length;i++)p.B[i]=p.L[i]+m[i];}     // so B-L reproduces the mask
 else p.B=blur(p.L,p.w,p.h,R);
 return cache[v]=p;};

const smoothstep=(a,b,x)=>{const t=cl((x-a)/(b-a));return t*t*(3-2*t);};
function liftFactor(y,mask,gain,knee,lo,hi){
 const wl=Math.max(0,1-y/knee);
 return 1+(gain-1)*wl*wl*smoothstep(lo,hi,mask);}

/* mean encoded luminance of a window under the candidate lift */
function windowMean(v,box,P){const {L,B,w,h}=get(v);
 const x0=Math.round(box[0]*w),y0=Math.round(box[1]*h);
 const x1=x0+Math.round(box[2]*w),y1=y0+Math.round(box[3]*h);
 let s=0,n=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*w+x;
  const yl=INV(L[i]);const m=Math.max(0,B[i]-L[i]);
  s+=fwd(yl*liftFactor(yl,m,...P));n++;}
 return s/n;}

/* what the facet population becomes: the dark pixels of `ground` */
function facets(P){const {L,B,w,h}=get('ground');
 let s=0,n=0,worst=0,wn=0;
 for(let i=0;i<L.length;i++){if(L[i]*255>14)continue;
  const yl=INV(L[i]);const m=Math.max(0,B[i]-L[i]);
  const c=255*fwd(yl*liftFactor(yl,m,...P));
  s+=c;n++;if(L[i]*255<=7){worst+=c;wn++;}}
 return [s/n,worst/wn];}

console.log(`\n  combined lift, blur radius ${R}px, mask ramp 0.04 -> 0.14`);
console.log('  gain knee  | gate  | ceiling | facets mean | worst(<=7cv) mean');
const B0=MODE==='taps'?[1,0.045,0.14,0.42]:[1,0.045,0.04,0.14];
const base=windowMean('wall_shade',GATE,B0)/windowMean('wall_lit',GATE,B0);
const bf=facets(B0);
console.log(`   (shipped)  | ${base.toFixed(3)} |  0.25   |    ${bf[0].toFixed(1).padStart(5)}    |     ${bf[1].toFixed(1)}`);
for(const knee of [0.030,0.045,0.070]){
 for(const gain of [3,5,8,12]){
  const P=MODE==='taps'?[gain,knee,0.14,0.42]:[gain,knee,0.04,0.14];
  const g=windowMean('wall_shade',GATE,P)/windowMean('wall_lit',GATE,P);
  const f=facets(P);
  console.log(`    ${String(gain).padStart(2)}  ${knee.toFixed(3)} | ${g.toFixed(3)} |  0.25   |    ${f[0].toFixed(1).padStart(5)}    |     ${f[1].toFixed(1)}` +
              (g<=0.25?'':'   OVER'));
 }}

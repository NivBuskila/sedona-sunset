/* Predict the shadow gate and the shadow structure for a candidate shadow lift,
 * over the actual pixel population rather than over a single anchor value.
 *
 * The first attempt at this priced the lift from five representative anchors and
 * predicted the gate would land at 0.227. Measured, it landed at 0.418. The
 * anchors were not the population: the gate is a mean over a window whose pixels
 * mostly sit *below* the anchor, and a gain that rises as luminance falls hits
 * them all harder than it hits the one value chosen to stand for them. That is
 * the same population error this project has now made in six different costumes,
 * so this tool walks every pixel.
 *
 * Validated against two measured points before it is believed — see --validate.
 */
import fs from 'fs';
import { decode } from './png.mjs';

const EXPOSURE = 0.95, CONTRAST = 1.03, PIV = 0.5, TOE_TOP = 0.111, TOE_SLOPE = 1.0,
      SH_TOP = 0.86, SH_SLOPE = 0.45;
const M = (m, v) => [m[0]*v[0]+m[3]*v[1]+m[6]*v[2], m[1]*v[0]+m[4]*v[1]+m[7]*v[2], m[2]*v[0]+m[5]*v[1]+m[8]*v[2]];
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
/* invert the neutral forward chain on an encoded-luminance reading */
const INV=(()=>{const N=4096,xs=[],ys=[];
 for(let i=0;i<=N;i++){const y=Math.pow(10,-5+i*(Math.log10(30)+5)/N);xs.push(y);ys.push(fwd(y));}
 return e=>{let lo=0,hi=N;while(hi-lo>1){const m=(lo+hi)>>1;if(ys[m]<e)lo=m;else hi=m;}
  const t=(e-ys[lo])/Math.max(ys[hi]-ys[lo],1e-12);return xs[lo]+t*(xs[hi]-xs[lo]);};})();

const GATE=[0.30,0.24,0.34,0.34];
function win(file,box){const im=decode(fs.readFileSync(file));
 const x0=Math.round(box[0]*im.w),y0=Math.round(box[1]*im.h),w=Math.round(box[2]*im.w),h=Math.round(box[3]*im.h);
 const out=[];for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const p=(y*im.w+x)*im.ch;
  out.push((0.2126*im.px[p]+0.7152*im.px[p+1]+0.0722*im.px[p+2])/255);}return out;}

const lifted=(gain,knee)=>y=>{const w=Math.max(0,1-y/knee);return y*(1+(gain-1)*w*w);};
function predict(shadeFile,litFile,gain,knee){
 const L=lifted(gain,knee);
 const go=a=>{let s=0;for(const e of a)s+=fwd(L(INV(e)));return s/a.length;};
 const sh=win(shadeFile,GATE),su=win(litFile,GATE);
 return go(sh)/go(su);}

const arg=k=>{const i=process.argv.indexOf('--'+k);return i<0?null:process.argv[i+1];};
const S=arg('shade')||'shots/sys7lift_lift1_wall_shade.png';
const T=arg('lit')||'shots/sys7lift_lift1_wall_lit.png';

if(process.argv.includes('--validate')){
 console.log('\n  predictor validated against measured captures:');
 for(const [g,k,measured] of [[1,0.045,0.223],[4,0.045,0.418]]){
  const p=predict(S,T,g,k);
  console.log(`    gain ${g} knee ${k}   predicted ${p.toFixed(3)}   measured ${measured.toFixed(3)}` +
              `   error ${(p-measured>=0?'+':'')+(p-measured).toFixed(3)}`);}
}
if(process.argv.includes('--sweep')){
 console.log('\n  gate over the real population.  band ceiling 0.25');
 process.stdout.write('  knee \ gain');for(const g of [1.5,2,2.5,3,4])process.stdout.write(String(g).padStart(9));
 console.log();
 for(const knee of [0.010,0.014,0.018,0.022,0.030,0.045]){
  process.stdout.write('    '+knee.toFixed(3).padStart(8));
  for(const g of [1.5,2,2.5,3,4]){const p=predict(S,T,g,knee);
   process.stdout.write((p.toFixed(3)+(p<=0.25?' ':'*')).padStart(9));}
  console.log();}
 console.log('    * over band');
 /* what each candidate does to the worst facet, at code 6 */
 console.log('\n  and what it does to a code-6 facet (scene-linear '+INV(6/255).toFixed(4)+'):');
 for(const knee of [0.014,0.018,0.022,0.030]){
  const row=[];for(const g of [2,2.5,3,4])row.push((255*fwd(lifted(g,knee)(INV(6/255)))).toFixed(0).padStart(4));
  console.log(`    knee ${knee.toFixed(3)}  gain 2,2.5,3,4 → code ${row.join(' ')}`);}
}

if(process.argv.includes('--conflict')){
 /* For a target facet code, what gate does it force? Searched over the same
    two-parameter family, taking the *lowest* gate that reaches each target. */
 console.log('\n  what each facet target costs at the gate (band ceiling 0.25):');
 console.log('  facet target | best gate achievable | knee  gain');
 for(const target of [8,10,13,16,20,25,30,45]){
  let best=null;
  for(let knee=0.006;knee<=0.20;knee*=1.06)for(let g=1.05;g<=40;g*=1.06){
   const c=255*fwd(lifted(g,knee)(INV(6/255)));
   if(c<target)continue;
   const gate=predict(S,T,g,knee);
   if(!best||gate<best.gate)best={gate,knee,g};
  }
  const flag=best.gate<=0.25?'':'   OVER BAND';
  console.log(`      ${String(target).padStart(3)}      |        ${best.gate.toFixed(3)}         | ${best.knee.toFixed(3)}  ${best.g.toFixed(2)}${flag}`);
 }
}

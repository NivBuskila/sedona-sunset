/* Projected (silhouette) area of a seated clast: shipped vs a candidate hull.
 *
 * Exists because I landed a hull change having held half-height to +0.0% and
 * horizontal radius to within 1.5%, rendered it, and found the stones visibly
 * smaller - one plate lost 22% of its pixels. The camera sees neither of the
 * extents I guarded. It sees a silhouette, and a lumpier hull of the same
 * bounding box covers fewer pixels: the uniform-rescaled candidate cost 12-21%
 * of projected area across every class.
 *
 * Fourth instance today of one error. A statistic must be taken in the space
 * the viewer occupies: not the whole hull but the visible cap, not the whole
 * population but the stones that cover pixels, not exact normals but perceived
 * ones, and not bounding extents but projected area.
 *
 * Run this against any change to angularClast before believing the size held.
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
function rng(s0){let s=s0>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function clast(seed,flat,bevel,bLo,bSp,comp){
  const rand=rng(seed);const pts=[];const ax=1.0,ay=flat,az=0.78+rand()*0.42;
  for(let i=0;i<8;i++)pts.push(new THREE.Vector3(((i&1)?1:-1)*ax*(0.52+rand()*0.58),((i&2)?1:-1)*ay*(0.52+rand()*0.58),((i&4)?1:-1)*az*(0.52+rand()*0.58)));
  for(let i=0;i<bevel;i++){let dx=rand()*2-1,dy=rand()*2-1,dz=rand()*2-1;
    const L=Math.hypot(dx,dy,dz)||1;dx/=L;dy/=L;dz/=L;
    const t=1/Math.max(Math.abs(dx)/ax,Math.abs(dy)/ay,Math.abs(dz)/az);
    const j=t*(bLo+rand()*bSp);pts.push(new THREE.Vector3(dx*j,dy*j,dz*j));}
  const g=new ConvexGeometry(pts);if(Array.isArray(comp))g.scale(comp[0],comp[1],comp[2]);else if(comp!==1)g.scale(comp,comp,comp);return g;}
function clipY(t){const sg=t.map(v=>v.y>=0),n=sg.filter(Boolean).length;
  if(n===3)return[t];if(n===0)return[];
  const lp=(p,q)=>{const s=(0-p.y)/(q.y-p.y);return new THREE.Vector3().lerpVectors(p,q,s);};
  if(n===1){const i=sg.indexOf(true),p=t[i],q=t[(i+1)%3],r=t[(i+2)%3];return[[p,lp(p,q),lp(p,r)]];}
  const i=sg.indexOf(false),p=t[i],q=t[(i+1)%3],r=t[(i+2)%3];
  return[[lp(p,q),q,r],[lp(p,q),r,lp(p,r)]];}
function projArea(g,sink,axis,tilt,vd){
  const m=new THREE.Matrix4().makeRotationAxis(axis,tilt);
  m.premultiply(new THREE.Matrix4().makeTranslation(0,-sink,0));
  const p=g.attributes.position;let tot=0;
  for(let t=0;t<p.count/3;t++){
    const a=new THREE.Vector3().fromBufferAttribute(p,t*3).applyMatrix4(m);
    const b=new THREE.Vector3().fromBufferAttribute(p,t*3+1).applyMatrix4(m);
    const c=new THREE.Vector3().fromBufferAttribute(p,t*3+2).applyMatrix4(m);
    const n=new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b,a),new THREE.Vector3().subVectors(c,a));
    if(n.lengthSq()<1e-20)continue;n.normalize();if(n.dot(vd)>=0)continue;
    for(const ct of clipY([a,b,c])){
      const ar=new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(ct[1],ct[0]),new THREE.Vector3().subVectors(ct[2],ct[0])).length()*0.5;
      tot+=ar*Math.abs(n.dot(vd));}}
  return tot;}
const vd=new THREE.Vector3(0,-Math.sin(20*Math.PI/180),-Math.cos(20*Math.PI/180)).normalize();
const CLASSES=[['granule',0.50,20,0.52,0.96],['gravel',0.54,7,0.52,0.96],['cobble',0.42,24,0.54,0.98],
  ['pavement',0.50,26,0.35,0.62],['block',0.62,26,0.52,0.94],['slab',0.62,34,0.52,0.94],['boulder',0.86,38,0.56,0.94]];
console.log('projected-area change: uniform rescale vs y-only rescale');
console.log('');
console.log('  class      uniform   y-only     horiz ext  (y-only holds half-height)');
for(const [name,flat,bevel,s0,s1] of CLASSES){
  const run=(bLo,bSp,comp)=>{let sum=0,n=0;
    for(let v=0;v<8;v++){const g=clast(7717+v*17,flat,bevel,bLo,bSp,comp);const rand=rng(991+v);
      for(let k=0;k<120;k++){const hT=flat;let sink=hT*(s0+rand()*(s1-s0));
        sink=Math.min(Math.max(sink,hT*0.34),hT*0.95);
        const tilt=Math.min(Math.pow(rand(),1.6)*0.60,Math.atan2(hT*1.7,1.0));
        const ta=rand()*Math.PI*2;
        sum+=projArea(g,sink,new THREE.Vector3(Math.cos(ta),0,Math.sin(ta)),tilt,vd);n++;}}
    return sum/n;};
  const dimsY=(g)=>{const p=g.attributes.position;let mx=-1e9,mn=1e9,h=0;
    for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i);
      mx=Math.max(mx,v.y);mn=Math.min(mn,v.y);h=Math.max(h,Math.hypot(v.x,v.z));}
    return{half:(mx-mn)/2,horiz:h};};
  const shipH=(()=>{let s=0;for(let v=0;v<8;v++)s+=dimsY(clast(7717+v*17,flat,bevel,0.99,0.24,1)).half;return s/8;})();
  let cy=1;for(let it=0;it<6;it++){let s=0;for(let v=0;v<8;v++)s+=dimsY(clast(7717+v*17,flat,bevel,0.86,0.50,[1,cy,1])).half;cy*=shipH/(s/8);}
  const a=run(0.99,0.24,1),b=run(0.86,0.50,0.926),c=run(0.86,0.50,[1,cy,1]);
  let hz0=0,hz1=0;for(let v=0;v<8;v++){hz0+=dimsY(clast(7717+v*17,flat,bevel,0.99,0.24,1)).horiz;hz1+=dimsY(clast(7717+v*17,flat,bevel,0.86,0.50,[1,cy,1])).horiz;}
  const pc=(x,y)=>`${100*(x/y-1)>=0?'+':''}${(100*(x/y-1)).toFixed(1)}%`;
  console.log(`  ${name.padEnd(10)}  ${pc(b,a).padStart(6)}      ${pc(c,a).padStart(6)}     ${pc(hz1/8,hz0/8).padStart(6)}     cy ${cy.toFixed(3)}`);
}

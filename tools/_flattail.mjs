/* The critic looks at the worst stone in frame, not at the mean.
 *
 * _topbias.mjs reports cobble's mean largest-visible-plane falling 29.0% ->
 * 23.6%. A mean can improve while the tail that draws the eye does not, and
 * the tail is what "the single worst object in the whole set" means. So this
 * reports the DISTRIBUTION: what share of seated cobbles present one plane
 * carrying more than 35%, 45% and 55% of everything the camera sees of them.
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
function rng(s0){let s=s0>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function clast(seed,flat,bevel,bias,capMin){
  const rand=rng(seed);const pts=[];const ax=1.0,ay=flat,az=0.78+rand()*0.42;
  for(let i=0;i<8;i++)pts.push(new THREE.Vector3(((i&1)?1:-1)*ax*(0.52+rand()*0.58),((i&2)?1:-1)*ay*(0.52+rand()*0.58),((i&4)?1:-1)*az*(0.52+rand()*0.58)));
  for(let i=0;i<bevel;i++){let dx=rand()*2-1,dy=rand()*2-1,dz=rand()*2-1;
    if(rand()<bias)dy=capMin+Math.abs(dy)*(1-capMin);
    const L=Math.hypot(dx,dy,dz)||1;dx/=L;dy/=L;dz/=L;
    const t=1/Math.max(Math.abs(dx)/ax,Math.abs(dy)/ay,Math.abs(dz)/az);
    const j=t*(0.99+rand()*0.24);pts.push(new THREE.Vector3(dx*j,dy*j,dz*j));}
  return new ConvexGeometry(pts);
}
function clipY(t){const sg=t.map(v=>v.y>=0),n=sg.filter(Boolean).length;
  if(n===3)return[t];if(n===0)return[];
  const lp=(p,q)=>{const s=(0-p.y)/(q.y-p.y);return new THREE.Vector3().lerpVectors(p,q,s);};
  if(n===1){const i=sg.indexOf(true),p=t[i],q=t[(i+1)%3],r=t[(i+2)%3];return[[p,lp(p,q),lp(p,r)]];}
  const i=sg.indexOf(false),p=t[i],q=t[(i+1)%3],r=t[(i+2)%3];
  return[[lp(p,q),q,r],[lp(p,q),r,lp(p,r)]];}
function topShare(g,sink,axis,tilt,vd){
  const m=new THREE.Matrix4().makeRotationAxis(axis,tilt);
  m.premultiply(new THREE.Matrix4().makeTranslation(0,-sink,0));
  const p=g.attributes.position;const planes=[];let tot=0;
  for(let t=0;t<p.count/3;t++){
    const a=new THREE.Vector3().fromBufferAttribute(p,t*3).applyMatrix4(m);
    const b=new THREE.Vector3().fromBufferAttribute(p,t*3+1).applyMatrix4(m);
    const c=new THREE.Vector3().fromBufferAttribute(p,t*3+2).applyMatrix4(m);
    const n=new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b,a),new THREE.Vector3().subVectors(c,a));
    if(n.lengthSq()<1e-20)continue;n.normalize();if(n.dot(vd)>=0)continue;
    for(const ct of clipY([a,b,c])){
      const ar=new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(ct[1],ct[0]),new THREE.Vector3().subVectors(ct[2],ct[0])).length()*0.5;
      if(ar<1e-12)continue;const pr=ar*Math.abs(n.dot(vd));tot+=pr;const d=n.dot(ct[0]);
      const h=planes.find(q=>q.n.dot(n)>0.9995&&Math.abs(q.d-d)<1e-5);
      if(h)h.proj+=pr;else planes.push({n:n.clone(),d,proj:pr});}}
  if(!planes.length||tot<=0)return null;
  planes.sort((a,b)=>b.proj-a.proj);return planes[0].proj/tot;
}
const vd=new THREE.Vector3(0,-Math.sin(20*Math.PI/180),-Math.cos(20*Math.PI/180)).normalize();
console.log('cobble: distribution of the largest single visible plane');
console.log('');
console.log('  bias    mean    >35%    >45%    >55%    n');
for(const bias of [0.00,0.25,0.40,0.55]){
  const vals=[];
  for(let v=0;v<4;v++){
    const g=clast(7717+v*17,0.42,24,bias,0.25);const rand=rng(991+v);
    for(let k=0;k<200;k++){
      const hT=0.42;let sink=hT*(0.54+rand()*0.44);
      sink=Math.min(Math.max(sink,hT*0.34),hT*0.95);
      const tilt=Math.min(Math.pow(rand(),1.6)*0.60,Math.atan2(hT*1.7,1.0));
      const ta=rand()*Math.PI*2;
      const r=topShare(g,sink,new THREE.Vector3(Math.cos(ta),0,Math.sin(ta)),tilt,vd);
      if(r!==null)vals.push(r);}}
  const f=(th)=>100*vals.filter(x=>x>th).length/vals.length;
  const mean=100*vals.reduce((s,x)=>s+x,0)/vals.length;
  const mk=bias===0?'  (shipped)':'';
  console.log(`  ${bias.toFixed(2)}   ${mean.toFixed(1)}%   ${f(0.35).toFixed(1)}%   ${f(0.45).toFixed(1)}%   ${f(0.55).toFixed(1)}%   ${vals.length}${mk}`);
}

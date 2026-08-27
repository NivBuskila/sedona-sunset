import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:400,height:300} });
p.on('pageerror', e=>console.log('[PAGEERROR]',e.message));
await p.goto('http://localhost:3000/',{waitUntil:'load'});
for(let i=0;i<40;i++){ if(await p.evaluate(()=>!!window.__game).catch(()=>0)) break; await p.waitForTimeout(5000); }
// hoof stubbed to a no-op BEFORE walking: donkey+onHoof still run, audio never does
await p.evaluate(()=>{ window.__game.audio.hoof=()=>{}; window.__n=0;
  requestAnimationFrame(function f(){ window.__n++; requestAnimationFrame(f); });
  dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'})); });
const s=[];
for(let i=0;i<5;i++){ await p.waitForTimeout(1000);
  s.push(await p.evaluate(()=>({ph:+window.__game._donkey._gait().phase.toFixed(2),
    beats:window.__game._donkey._gait().beats, ownRaf:window.__n, fps:Math.round(window.__game.fps)}))); }
console.log(JSON.stringify(s));
await b.close();

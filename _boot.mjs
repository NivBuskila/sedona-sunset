import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:400,height:300} });
await p.goto('http://localhost:3000/',{waitUntil:'load'});
for(let i=0;i<60;i++){ if(await p.evaluate(()=>!!window.__game).catch(()=>0)) break; await p.waitForTimeout(5000); }
const log = await p.evaluate(()=>window.__game._boot);
console.log('total:', log.total, 'ms  painted at:', Math.round(log.painted));
for (const ph of log.phases) console.log(String(ph.ms).padStart(7), ' ', ph.note);
await b.close();

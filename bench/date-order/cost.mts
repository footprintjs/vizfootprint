/**
 * D30 integrated temporal-fold cost, not Browser or whole-update latency.
 * Supply an immutable base temporal module and its full commit as arguments:
 * node --import tsx bench/date-order/cost.mts BASE_MODULE BASE_HEAD
 * Clock reads measure work; there are no timers, sleeps, retries or providers.
 */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { temporal, dateOrderConflictOf } from '../../src/encoding/temporal.js';
const [basePath,baseHead]=process.argv.slice(2);
if (!basePath || !/^[a-f0-9]{40}$/.test(baseHead ?? '')) throw new Error('Supply exact base temporal module and full commit.');
const {temporal:baseline}=await import(pathToFileURL(basePath).href);
const n=100_000, epoch=Date.UTC(1900,0,1);
const mixed=['2026-04-01T23:00:00-05:00','2026-04-02T01:00:00Z','2026-04-02T05:00:00Z'];
const datasets=[
 {name:'uniform date-only',cells:Array.from({length:n},(_,i)=>new Date(epoch+i*86_400_000).toISOString().slice(0,10))},
 {name:'uniform UTC Z',cells:Array.from({length:n},(_,i)=>new Date(epoch+i*3_600_000).toISOString().replace('.000Z','Z'))},
 {name:'mixed offsets',cells:Array.from({length:n},(_,i)=>mixed[i%3]!)},
];
const measures=[];
for (const {name,cells} of datasets) {
 const methods={baselineTemporal:()=>baseline(cells),integratedTemporal:()=>temporal(cells),ownExtentHelper:()=>dateOrderConflictOf(cells)};
 for (const fn of Object.values(methods)) fn(); // one explicit warm-up per method
 const entries=Object.entries(methods),samples:Record<string,number[]>=Object.fromEntries(entries.map(([key])=>[key,[]]));
 for (let round=0;round<15;round++) for (let slot=0;slot<entries.length;slot++) {
   const [key,fn]=entries[(round+slot)%entries.length]!;
   const start=performance.now();fn();samples[key]!.push(performance.now()-start);
 }
 const medianMs=Object.fromEntries(Object.entries(samples).map(([key,v])=>[key,[...v].sort((a,b)=>a-b)[7]!]));
 measures.push({name,cells:n,samplesMs:samples,medianMs,overheadMs:medianMs['integratedTemporal']!-medianMs['baselineTemporal']!,witness:dateOrderConflictOf(cells)??null});
}
console.log(JSON.stringify({baseHead,node:process.version,zone:Intl.DateTimeFormat().resolvedOptions().timeZone,samplesPerMethod:15,scope:'actual integrated temporal fold, baseline exact module; not Browser, provider, full update or memory timing',measures},null,2));

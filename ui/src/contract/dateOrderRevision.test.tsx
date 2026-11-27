// @vitest-environment jsdom
/**
 * First D30 source read, red before correction:
 * middle/negative-year brush exclusions -> truthful words, unchanged clauses;
 * layer-read sum -> named occurrence basis; every mark -> fact vs selectable consequence;
 * compact sizes -> marks remain + full accessible words; frame pad -> real coordinates;
 * brush state -> stable assessment, rows/field -> new assessment; public type is importable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { fireEvent } from '@testing-library/react';
import * as def from 'vizfootprint/def';
import { matchesClause } from 'vizfootprint/data';
import type { DateOrderReading } from '../index.js';
import { VizLine } from '../charts/VizLine.js';
import { lineRenderer, layeredRenderer } from './renderers.js';
import { emptySelection } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type RenderState, type Renderer } from './types.js';
const dates=['2026-04-01T23:00:00-05:00','2026-04-02T01:00:00Z','2026-04-02T05:00:00Z'];
const rows=dates.map((d,i)=>({d,v:i+1}));
const reading:DateOrderReading={scope:'drawn rows',witness:{compared:3,conflicted:2}};
const state=(extra:Partial<RenderState>={}):RenderState=>({rows,encodings:{x:'d',y:'v'},selection:emptySelection('v'),hover:null,theme:{},size:{width:520,height:340},...extra});
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(f=>f());vi.restoreAllMocks();document.body.innerHTML='';});
function mount(renderer:Renderer,initial:RenderState) {
 const el=document.createElement('div');document.body.append(el);const cb={emit:vi.fn(),hover:vi.fn(),reencodeRequest:vi.fn(),navigate:vi.fn()};
 const handle=renderer.mount(el,{protocolVersion:RENDERER_PROTOCOL_VERSION,viewId:'v',callbacks:cb});handle.update(initial);
 cleanups.push(()=>handle.unmount());return {el,cb};
}
function words(el:HTMLElement){return [...el.querySelectorAll('.vzf-date-order-note')].map(n=>n.textContent??'').join(' ');}
function pointerSupport(){
 if(typeof window.PointerEvent==='undefined'){
  class PE extends MouseEvent{pointerId:number;constructor(t:string,p:PointerEventInit={}){super(t,p);this.pointerId=p.pointerId??1;}}
  (window as unknown as {PointerEvent:typeof PE}).PointerEvent=PE;
 }
}
function drag(svg:Element,width=520){pointerSupport();fireEvent.pointerDown(svg,{clientX:0,pointerId:1});fireEvent.pointerMove(svg,{clientX:width,pointerId:1});fireEvent.pointerUp(svg,{clientX:width,pointerId:1});}
function stack(cells:readonly string[]=dates,kind='line',count=2,size={width:520,height:340},basis:'table'|'rows'='table',different=false){
 const layers=Array.from({length:count},(_,i)=>({layerId:String(i),table:different?'t'+i:'t',rows:(different ? cells.slice(0,cells.length-i) : cells).map((d,j)=>({d,v:j+1})),encodings:{x:'d',y:'v',category:'d'}}));
 const frame=def.frameDomains(layers.map(l=>({layerId:l.layerId,chartKind:'line' as const,channels:{x:{type:'date' as const,values:l.rows.map(r=>r.d)}}})),{x:{mode:'shared',basis}});
 return mount(layeredRenderer({layers:Object.fromEntries(layers.map(l=>[l.layerId,{kind}]))} as never),state({layers,frame,size}));
}
describe('D30 first source review regressions',()=>{
 it.each([
  {cells:['2026-01-15','04/02/2026','2026-06-01'],bounds:['2026-01-15','2026-06-01'],kept:['2026-01-15','2026-06-01']},
  {cells:['-000100-01-01','-000050-01-01','-000001-01-01'],bounds:['-000100-01-01','-000001-01-01'],kept:[]},
 ])('full brush keeps the existing text predicate and warns about any date: $cells',({cells,bounds,kept})=>{
  const rr=cells.map((d,i)=>({d,v:i+1}));const {el,cb}=mount(lineRenderer(),state({rows:rr}));
  drag(el.querySelector('svg.vzf-line')!);
  expect(cb.emit).toHaveBeenCalledTimes(1);expect(cb.emit.mock.calls[0]![0]).toEqual({rawValue:bounds,encoding:{kind:'interval',field:'d'}});
  expect(rr.filter(r=>matchesClause(r,{kind:'interval',field:'d',value:bounds as [string,string]})).map(r=>r.d)).toEqual(kept);
  expect(words(el)).not.toContain('near its ends');expect(words(el)).toContain('any of these dates');
 });
 it.each(['table','rows'] as const)('labels repeated cells as %s-basis reads across binding layers',basis=>{
  const {el}=stack(dates,'line',2,undefined,basis);
  expect(words(el)).toContain('4 of 6');expect(words(el)).toContain(basis+'-basis reads across 2 binding layers');
  expect(words(el)).not.toContain("frame's inspected table");
 });
 it('counts different-table/different-row-set reads without pretending they are one table',()=>{
  const {el}=stack(dates,'line',2,undefined,'rows',true);
  expect(words(el)).toContain('4 of 5');expect(words(el)).toContain('rows-basis reads across 2 binding layers');
 });
 it.each(['line','point','bar','histogram','boxplot'])('%s stack shows the fact; only a line can emit a date interval',kind=>{
  const {el}=stack(dates,kind,1);
  expect(words(el)).toContain('2 of 3');expect(words(el).includes('A selected date range')).toBe(kind==='line');
 });
 it('a y witness is a fact, not an x date-interval consequence',()=>{
  const layers=[{layerId:'a',table:'t',rows,encodings:{x:'v',y:'d'}}];
  const frame=def.frameDomains([{layerId:'a',channels:{y:{type:'date',values:dates}}}]);
  const {el}=mount(layeredRenderer({layers:{a:{kind:'point'}}}),state({layers,frame}));
  expect(words(el)).toContain('2 of 3');expect(words(el)).not.toContain('A selected date range');
 });
 it.each([{width:260,height:180}])('small dated line retains dots and complete accessible explanation at $width x $height',size=>{
  const {el}=mount(lineRenderer(),state({size})); // renderer uses original cells
  expect(el.querySelector('.vzf-date-order-refusal')).toBeNull();expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(3);
  expect(words(el)).toContain('2/3');expect(words(el)).toContain('text');expect(words(el)).toContain('time');
  expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('any of these dates');
  expect(el.querySelectorAll('.vzf-date-order-note tspan')).toHaveLength(1);
 });
 it('two-line 300 x 200 stack uses compact words and retains all marks',()=>{
  const {el}=stack(dates,'line',2,{width:300,height:200});
  expect(el.querySelector('.vzf-date-order-refusal')).toBeNull();expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(6);
  expect(words(el)).toContain('4/6');expect(el.querySelector('[role="group"]')?.getAttribute('aria-label')).toContain('table-basis reads across 2 binding layers');
 });
 it('even an equal-instant spelling pair leaves the small chart drawn',()=>{
  const cells=['2026-04-01','2026-04-01T00:00:00Z'];const {el}=stack(cells,'line',2,{width:300,height:200});
  expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(4);expect(words(el)).toContain('4/4');
 });
 it('frame annotation, zero note and plot are separated by their real coordinates',()=>{
  const layers=[{layerId:'a',table:'t',rows,encodings:{x:'d',y:'v'}}];
  const frame={...def.frameDomains([{layerId:'a',channels:{x:{type:'date',values:dates}}}]),y:{mode:'shared' as const,basis:'table' as const,guide:'merged' as const,scale:'quantitative' as const,domain:[1,3] as const,zeroGuide:true}};
  const {el}=mount(layeredRenderer({layers:{a:{kind:'line'}}}),state({layers,frame}));
  const last=Math.max(...[...el.querySelectorAll('.vzf-date-order-note tspan')].map(n=>Number(n.getAttribute('y'))));
  const axis=el.querySelector('.vzf-frame-guide [data-axis-orient="left"] .vzf-axis')!;
  const plotTop=Number(axis.getAttribute('y1'));const zero=Number(el.querySelector('.vzf-frame-guide .vzf-zero-note')!.getAttribute('y'));
  expect({last,zero,plotTop}).toEqual({last:66,zero:84,plotTop:90});expect(plotTop).toBe(last+24);expect(zero).toBe(last+18);expect(plotTop).toBeGreaterThan(zero);
 });
 it('a pointer-only render reuses the witness; new rows or field recompute it',()=>{
  pointerSupport();const spy=vi.spyOn(def,'dateOrderConflictOf');const el=document.createElement('div');document.body.append(el);const root=createRoot(el);cleanups.push(()=>root.unmount());
  const data=rows.map(r=>({date:r.d,value:r.v}));flushSync(()=>root.render(<VizLine data={data}/>));expect(spy).toHaveBeenCalledTimes(1);
  const svg=el.querySelector('svg.vzf-line')!;fireEvent.pointerDown(svg,{clientX:65,pointerId:1});fireEvent.pointerMove(svg,{clientX:180,pointerId:1});
  expect(spy).toHaveBeenCalledTimes(1);
  const next=[...data];flushSync(()=>root.render(<VizLine data={next}/>));expect(spy).toHaveBeenCalledTimes(2);
  flushSync(()=>root.render(<VizLine data={next} dateField="changed"/>));expect(spy).toHaveBeenCalledTimes(3);
  flushSync(()=>root.render(<VizLine data={data} dateOrder={reading}/>));expect(spy).toHaveBeenCalledTimes(3);
 });
});

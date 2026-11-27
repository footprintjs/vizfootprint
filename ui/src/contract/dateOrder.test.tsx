// @vitest-environment jsdom
/**
 * D30: source -> session store -> adapter -> renderer, plus legacy/direct doors.
 * A positive warning names inspected cells; no-conflict/unknown is never a safety claim.
 * The table fold wins even when drawn rows would disagree; independent line notes
 * belong to their layer. Date objects and category/summary labels are not row text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { buildDashboard } from 'vizfootprint/agent';
import { frameDomains } from 'vizfootprint/def';
import { VizLine } from '../charts/VizLine.js';
import { frameFor, viewFrameFor } from '../adapter/frame.js';
import { createSessionView, sessionSource } from '../adapter/sessionView.js';
import { lineRenderer, layeredRenderer } from './renderers.js';
import { emptySelection } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type RenderState, type Renderer, type ResolvedChannel } from './types.js';
const dates=['2026-04-01T23:00:00-05:00','2026-04-02T01:00:00Z','2026-04-02T05:00:00Z'];
const rows=dates.map((d,i)=>({d,v:i+1}));
const callbacks=()=>({emit:vi.fn(),hover:vi.fn(),reencodeRequest:vi.fn(),navigate:vi.fn()});
const state=(extra:Partial<RenderState>={}):RenderState=>({rows,encodings:{x:'d',y:'v'},selection:emptySelection('v'),hover:null,theme:{},size:{width:520,height:340},...extra});
function mount(renderer:Renderer, initial:RenderState) {
 const el=document.createElement('div'); document.body.append(el);
 const cb=callbacks(); const handle=renderer.mount(el,{protocolVersion:RENDERER_PROTOCOL_VERSION,viewId:'v',callbacks:cb});
 handle.update(initial); cleanups.push(()=>handle.unmount()); return {el,handle,cb};
}
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(f=>f());document.body.innerHTML='';});
function visible(el:HTMLElement) {return [...el.querySelectorAll('.vzf-date-order-note')].map(n=>n.textContent??'').join(' ');}
function folded(cells:readonly unknown[]=dates,basis:'table'|'rows'='table') {
 return frameDomains([{layerId:'a',chartKind:'line',channels:{x:{type:'date',values:cells}}}],{x:{mode:'shared',basis}}) as Readonly<Record<string,ResolvedChannel>>;
}
async function live(typed:boolean, layered=false, independent=false) {
 const layers=[{layerId:'a',table:'t',chartKind:'line',channels:['x','y'],initial:{x:'d',y:'v'}},{layerId:'b',table:'t',chartKind:'line',channels:['x','y'],initial:{x:'d',y:'v'}}];
 const frame=layered?{x:{mode:independent?'independent':'shared'},y:{mode:'shared'}}:{x:{basis:'table'}};
 const session=buildDashboard({meta:{title:'dates'},data:{t:{rows,...(typed?{columns:{d:{type:'date'}}}:{})}},actors:{v:{actor:'user',label:'dates'}},encodings:[{viewId:'v',chartKind:'line',channels:['x','y'],initial:{x:'d',y:'v'},...(layered?{layers}:{}),frame}],defaultTable:'t'} as never).createSession({as:'user'});
 const store=createSessionView(sessionSource(session),{as:'user'});await store.refresh();
 const view=store.getState().views.find(v=>v.viewId==='v')!;
 const columns=store.getState().columns;
 const asked:unknown[]=[];const spy={viewQuery:(q:any)=>{asked.push(q);return session.viewQuery(q);}};
 const request={viewId:'v',columns,frame:view.frame!};
 const frameAnswer=layered?await frameFor(spy,{...request,layers:layers.map(l=>({...l,encodings:l.initial}))} as never):await viewFrameFor(spy,{...request,table:'t',chartKind:'line',encodings:{x:'d',y:'v'}} as never);
 return {frame:frameAnswer,asked,layers,session,store};
}
describe('date-order words at the real and legacy doors',()=>{
 it('shared typed source cells reach visible and accessible words once, with no added reads',async()=>{
  const liveState=await live(true,true);expect(liveState.frame.x).toMatchObject({dateOrder:{compared:6,conflicted:4}});
  const count=liveState.asked.length;const {el}=mount(layeredRenderer({layers:{a:{kind:'line'},b:{kind:'line'}}}),state({frame:liveState.frame,layers:liveState.layers.map(l=>({...l,encodings:l.initial,rows})) as never}));
  expect(el.querySelectorAll('.vzf-date-order-note')).toHaveLength(1);
  expect(visible(el)).toContain('4 of 6');expect(visible(el)).toContain("frame's inspected table");
  expect(el.querySelector('[role="group"]')?.getAttribute('aria-label')).toContain(visible(el));
  expect(liveState.asked).toHaveLength(count);
 });
 it('plain typed source/store/frame door carries its basis and refresh removes the old note',async()=>{
  const liveState=await live(true);expect(liveState.frame.x).toMatchObject({dateOrder:{compared:3,conflicted:2}});
  const {el,handle,cb}=mount(lineRenderer(),state({frame:liveState.frame}));
  expect(visible(el)).toContain('2 of 3');expect(visible(el)).toContain("frame's inspected table");
  expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain(visible(el));
  handle.update(state({rows:[{d:'2026-04-01',v:1}],frame:folded(['2026-04-01'])}));
  expect(visible(el)).toBe('');expect(cb.emit).not.toHaveBeenCalled();
 });
 it('untyped plain source is a categorical fold and does not assess date-looking labels',async()=>{
  const liveState=await live(false);expect(liveState.frame.x).toMatchObject({scale:'categorical'});
  expect(visible(mount(lineRenderer(),state({frame:liveState.frame})).el)).toBe('');
 });
 it('legacy frame-less and direct dated lines use original drawn-row cells',()=>{
  const {el}=mount(lineRenderer(),state());expect(visible(el)).toContain('2 of 3');expect(visible(el)).toContain('drawn rows');
  const direct=document.createElement('div');const root=createRoot(direct);cleanups.push(()=>root.unmount());
  flushSync(()=>root.render(<VizLine data={rows.map(r=>({date:r.d,value:r.v}))}/>));
  expect(visible(direct)).toBe(visible(el));
 });
 it('a folded no-witness answer suppresses a second count of conflicting drawn rows',()=>{
  expect(visible(mount(lineRenderer(),state({frame:folded(['2026-04-01','2026-04-02'])})).el)).toBe('');
 });
 it('independent axes read no date cells and name each line layer in the fallback',async()=>{
  const liveState=await live(true,true,true);expect(liveState.frame.x).toEqual({mode:'independent',guide:'per-layer'});
  expect(liveState.asked).toHaveLength(2); // y only, one existing read per layer
  const {el}=mount(layeredRenderer({layers:{a:{kind:'line'}}}),state({frame:liveState.frame,layers:liveState.layers.slice(0,1).map(l=>({...l,encodings:l.initial,rows})) as never}));
  expect(el.querySelectorAll('.vzf-date-order-note')).toHaveLength(1);expect(visible(el)).toContain('layer a');
 });
 it('Date objects are not converted into counted original strings; a re-encode recomputes from its actual column',()=>{
  const {el,handle}=mount(lineRenderer(),state({rows:[...rows,{d:new Date(dates[0]!),v:4}]}));
  expect(visible(el)).toContain('2 of 3');
  handle.update(state({rows:rows.map(r=>({...r,n:1})),encodings:{x:'n',y:'v'}}));expect(visible(el)).toBe('');
 });
 it('frame rows basis names inspected frame rows and never sums with a fallback',()=>{
  const {el}=mount(lineRenderer(),state({frame:folded(dates,'rows')}));
  expect(visible(el)).toContain('2 of 3');expect(visible(el)).toContain("frame's inspected rows");
 });
 it('reserves a separate band above the legend/marks and preserves excluded/outside notes',()=>{
  const {el}=mount(lineRenderer(),state({rows:[...rows,{d:dates[0]!,v:-1}],frame:{...folded(),y:{mode:'shared',basis:'table',guide:'merged',scale:'quantitative',domain:[1,2],transform:'log'}} as never}));
  const warning=el.querySelector('.vzf-date-order-note')!;expect(warning).not.toBeNull();
  const last=Math.max(...[...warning.querySelectorAll('tspan')].map(n=>Number(n.getAttribute('y'))));
  const axis=el.querySelector('[data-axis-orient="left"] .vzf-axis')!;
  expect(last+10).toBeLessThan(Number(axis.getAttribute('y2')));
  expect(el.querySelector('.vzf-excluded-note')).not.toBeNull();expect(el.querySelector('.vzf-outside-note')).not.toBeNull();
 });
 it('keeps the existing refusal for two independent x axes instead of changing that gate',async()=>{
  const liveState=await live(true,true,true);
  const {el}=mount(layeredRenderer({layers:{a:{kind:'line'},b:{kind:'line'}}}),state({frame:liveState.frame,layers:liveState.layers.map(l=>({...l,encodings:l.initial,rows})) as never}));
  expect(el.textContent).toContain('one frame has one x');expect(visible(el)).toBe('');
 });
 it('keeps the same categorical stack picture without inventing a date warning',async()=>{
  const liveState=await live(false,true);
  const {el}=mount(layeredRenderer({layers:{a:{kind:'line'},b:{kind:'line'}}}),state({frame:liveState.frame,layers:liveState.layers.map(l=>({...l,encodings:l.initial,rows})) as never}));
  expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(6);expect(visible(el)).toBe('');
 });
 it('an undersized plain or layered chart preserves the words and asks for room',()=>{
  const {el}=mount(lineRenderer(),state({size:{width:160,height:80}}));
  expect(el.querySelector('.vzf-date-order-refusal')?.textContent).toContain('2 of 3');expect(el.textContent).toContain('Enlarge');
  const stack=mount(layeredRenderer({layers:{a:{kind:'line'}}}),state({size:{width:160,height:80},frame:folded(),layers:[{layerId:'a',table:'t',rows,encodings:{x:'d',y:'v'}}]}));
  expect(stack.el.querySelector('.vzf-date-order-refusal')?.textContent).toContain("frame's inspected table");
 });
 it('a zero note and multi-series legend remain below the date annotation band',()=>{
  const withSeries=rows.flatMap(r=>[{...r,s:'one'},{...r,v:r.v+1,s:'two'}]);
  const {el}=mount(lineRenderer(),state({rows:withSeries,encodings:{x:'d',y:'v',color:'s'},frame:{...folded(),y:{mode:'shared',basis:'table',guide:'merged',scale:'quantitative',domain:[1,5],zeroGuide:true}} as never}));
  const warning=el.querySelector('.vzf-date-order-note')!;
  const last=Math.max(...[...warning.querySelectorAll('tspan')].map(n=>Number(n.getAttribute('y'))));
  const legend=el.querySelector('.vzf-line-legend > g')!.getAttribute('transform')!;
  expect(Number(legend.split(',')[1]!.replace(')',''))).toBeGreaterThan(last+10);
 });

});

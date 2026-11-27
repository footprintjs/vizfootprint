// @vitest-environment jsdom
/**
 * D27 case table (red before source):
 * bound shared axis/no span -> named refusal, never silent own extents;
 * every frame mark and channel alias -> same rule;
 * every axis declaration/basis -> no invented failure cause;
 * unbound/independent/omitted/fully folded -> original picture;
 * real source/store/frame -> same refusal; follow advice -> next true result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDashboard } from 'vizfootprint/agent';
import { frameDomains } from 'vizfootprint/def';
import { createSessionView, sessionSource } from '../adapter/sessionView.js';
import { frameFor } from '../adapter/frame.js';
import { layeredRenderer, lineRenderer } from './renderers.js';
import { emptySelection } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type RenderLayer, type RenderState, type ResolvedChannel } from './types.js';
const cb=()=>({emit:vi.fn(),hover:vi.fn(),navigate:vi.fn(),reencodeRequest:vi.fn()});
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(f=>f());document.body.innerHTML='';});
const unresolved=(declared:object={}):ResolvedChannel=>({mode:'shared',basis:'table',guide:'merged',unfolded:true,scaleKind:'quantitative',...declared}) as ResolvedChannel;
const rows=[{x:1,y:2,c:'a',count:2},{x:2,y:5,c:'b',count:5}];
const layer=(kind='line',id='a'):RenderLayer=>({layerId:id,table:'t',rows,encodings:kind==='bar'?{category:'c',y:'count'}:{x:'x',y:'y'}});
function draw(kinds:readonly string[],layers:readonly RenderLayer[],frame?:Readonly<Record<string,ResolvedChannel>>){
 const el=document.createElement('div');document.body.append(el);const callbacks=cb();
 const handle=layeredRenderer({layers:Object.fromEntries(layers.map((l,i)=>[l.layerId,{kind:kinds[i]}]))} as never).mount(el,{protocolVersion:RENDERER_PROTOCOL_VERSION,viewId:'v',callbacks});
 cleanups.push(()=>handle.unmount());const state:RenderState={rows:[],encodings:{},selection:emptySelection('v'),hover:null,theme:{},size:{width:520,height:340},layers,...(frame===undefined?{}:{frame})};handle.update(state);
 return {el,callbacks,handle,state};
}
const refusal=(el:HTMLElement)=>el.querySelector('.vzf-chart-refusal')?.textContent??'';
describe('a stack never drops a bound shared declaration without a span',()=>{
 it.each(['line','point','bar','histogram','boxplot'])('%s names the missing shared y domain before drawing any shared picture',kind=>{
  const {el,callbacks}=draw([kind],[layer(kind)],{y:unresolved({zeroGuide:true})});
  expect(refusal(el)).toContain('no shared domain');expect(refusal(el)).toContain('"y"');expect(el.querySelector('.vzf-frame')).toBeNull();
  expect(callbacks.emit).not.toHaveBeenCalled();
 });
 it.each([{transform:'log'},{transform:'linear'},{zeroGuide:true},{zeroGuide:false},{zero:true},{zero:false},{bounds:[0,10]},{guide:'per-layer'},{}])('names a missing domain for any carried declaration: %j',declared=>{
  const {el}=draw(['line','line'],[layer('line','a'),layer('line','b')],{y:unresolved(declared)});
  expect(refusal(el)).toContain('no shared domain');expect(refusal(el)).not.toMatch(/failed|timed out|no data/);
 });
 it.each(['table','rows'] as const)('does not invent the cause of a %s-basis unfolded domain',basis=>{
  expect(refusal(draw(['line'],[layer()],{x:unresolved({basis})}).el)).toContain('no shared domain');
 });
 it('uses the bar category binding, not a guessed x channel',()=>{
  const {el}=draw(['bar'],[layer('bar')],{category:{...unresolved(),scaleKind:'categorical'}});
  expect(refusal(el)).toContain('"category"');
 });
 it('does not refuse an unbound channel or an independent axis',()=>{
  const l={...layer('bar'),encodings:{category:'c'}};
  const omitted=draw(['bar'],[l]).el.innerHTML;
  expect(draw(['bar'],[l],{y:unresolved()}).el.innerHTML).toBe(omitted);
  const own=draw(['line'],[layer()],{y:{mode:'independent',guide:'per-layer'}}).el;
  expect(refusal(own)).toBe('');expect(own.querySelector('.vzf-line-dot')).not.toBeNull();
 });
 it('a supplied folded domain follows the refusal advice and draws the same ordinary stack',()=>{
  const layers=[layer('line','a'),layer('line','b')];
  const folded=frameDomains(layers.map(l=>({layerId:l.layerId,chartKind:'line',channels:{x:{type:'number',values:rows.map(r=>r.x)},y:{type:'number',values:rows.map(r=>r.y)}}})));
  expect(refusal(draw(['line','line'],layers,{...folded,y:unresolved()}).el)).toContain('Supply a folded shared domain');
  const {el}=draw(['line','line'],layers,folded);expect(refusal(el)).toBe('');expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(4);
 });
 it('plain views retain their own-extent handling of an unfolded declaration',()=>{
  const el=document.createElement('div');const h=lineRenderer().mount(el,{protocolVersion:RENDERER_PROTOCOL_VERSION,viewId:'v',callbacks:cb()});cleanups.push(()=>h.unmount());
  h.update({rows,encodings:{x:'x',y:'y'},selection:emptySelection('v'),hover:null,theme:{},size:{width:520,height:340},frame:{y:unresolved({transform:'log'})}});
  expect(refusal(el)).toBe('');expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(2);
 });
 it.each(['line','point','bar','histogram','boxplot'])('%s can follow the advice by receiving its actual folded axis domains',kind=>{
  const l=layer(kind);const channels=kind==='bar'?{category:{type:'string',values:rows.map(r=>r.c)},y:{type:'number',values:rows.map(r=>r.count)}}:{x:{type:'number',values:rows.map(r=>r.x)},y:{type:'number',values:rows.map(r=>r.y)}};
  const frame=frameDomains([{layerId:l.layerId,chartKind:kind,channels}] as never);
  const {el}=draw([kind],[l],frame);expect(refusal(el)).toBe('');expect(el.querySelector('.vzf-frame')).not.toBeNull();
 });
 it('a folded -> unfolded -> folded update refuses only while the shared domain is missing',()=>{
  const l=layer();const frame=frameDomains([{layerId:'a',chartKind:'line',channels:{x:{type:'number',values:[1,2]},y:{type:'number',values:[2,5]}}}]);
  const {el,handle,state,callbacks}=draw(['line'],[l],frame);const before=el.innerHTML;
  handle.update({...state,frame:{...frame,y:unresolved({zeroGuide:false})}});expect(refusal(el)).toContain('no shared domain');
  handle.update(state);expect(el.innerHTML).toBe(before);expect(callbacks.emit).not.toHaveBeenCalled();
 });
 it('real untyped source rows retain their normal fully folded stack',async()=>{
  const refs=['a','b'].map(layerId=>({layerId,table:'t',chartKind:'line',encodings:{x:'x',y:'y'}}));
  const session=buildDashboard({meta:{title:'shared values'},data:{t:{rows}},actors:{v:{actor:'user',label:'values'}},encodings:[{viewId:'v',chartKind:'line',channels:['x','y'],initial:{x:'x',y:'y'},layers:refs.map(l=>({layerId:l.layerId,table:'t',chartKind:'line',channels:['x','y'],initial:l.encodings})),frame:{y:{mode:'shared',transform:'log'}}}],defaultTable:'t'} as never).createSession({as:'user'});
  const store=createSessionView(sessionSource(session),{as:'user'});await store.refresh();const view=store.getState().views.find(v=>v.viewId==='v')!;
  const frame=await frameFor(session,{viewId:'v',layers:refs,columns:store.getState().columns,frame:view.frame});
  expect(frame.y).toMatchObject({scale:'quantitative',transform:'log'});
  const {el}=draw(['line','line'],refs.map(l=>({...l,rows})),frame);expect(refusal(el)).toBe('');expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(4);
 });
 it('real typed source -> store -> frame door -> renderer reports the missing shared domain',async()=>{
  const refs=['a','b'].map(layerId=>({layerId,table:'t',chartKind:'line',encodings:{x:'x',y:'y'}}));
  const session=buildDashboard({meta:{title:'empty shared axis'},data:{t:{rows:[],columns:{x:{type:'number'},y:{type:'number'}}}},actors:{v:{actor:'user',label:'values'}},encodings:[{viewId:'v',chartKind:'line',channels:['x','y'],initial:{x:'x',y:'y'},layers:refs.map(l=>({layerId:l.layerId,table:'t',chartKind:'line',channels:['x','y'],initial:l.encodings})),frame:{y:{mode:'shared',transform:'log'}}}],defaultTable:'t'} as never).createSession({as:'user'});
  const store=createSessionView(sessionSource(session),{as:'user'});await store.refresh();const view=store.getState().views.find(v=>v.viewId==='v')!;
  const frame=await frameFor(session,{viewId:'v',layers:refs,columns:store.getState().columns,frame:view.frame});
  expect(frame.y).toMatchObject({unfolded:true,transform:'log'});
  const {el}=draw(['line','line'],refs.map(l=>({...l,rows:[]})),frame);expect(refusal(el)).toContain('no shared domain');
 });
});

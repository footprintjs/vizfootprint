// @vitest-environment jsdom
/**
 * D27 case table (red before source):
 * bound shared axis/no span -> named refusal, never silent own extents;
 * every frame mark and channel alias -> same rule;
 * every axis declaration/basis -> no invented failure cause;
 * unbound/independent/omitted/fully folded -> original picture;
 * real empty source/store/frame -> refusal; supply axis values -> visible marks;
 * all five marks on y, plus line/point/histogram x -> follow the public data advice;
 * only a later layer binds y -> name that layer, never the first layer.
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
type UnfoldedChannel = Extract<ResolvedChannel, { readonly unfolded: true }>;
const unresolved=(declared:object={}):UnfoldedChannel=>({mode:'shared',basis:'table',guide:'merged',unfolded:true,scaleKind:'quantitative',...declared});
const rows=[{x:1,y:2,c:'a',count:2},{x:2,y:5,c:'b',count:5}];
const histogramRows=[{x0:1,x1:2,count:2},{x0:3,x1:4,count:5}];
const boxRows=[{category:'a',q1:2,median:3,q3:4,whiskerLo:1,whiskerHi:5,count:4},{category:'b',q1:5,median:6,q3:7,whiskerLo:4,whiskerHi:8,count:4}];
const layer=(kind='line',id='a'):RenderLayer=>({
 layerId:id,table:'t',
 rows:kind==='histogram'?histogramRows:kind==='boxplot'?boxRows:rows,
 encodings:kind==='bar'?{category:'c',y:'count'}:kind==='histogram'?{x:'x0',y:'count'}:kind==='boxplot'?{x:'category',y:'median'}:{x:'x',y:'y'},
});
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
 it('a fully folded domain draws the same ordinary stack',()=>{
  const layers=[layer('line','a'),layer('line','b')];
  const folded=frameDomains(layers.map(l=>({layerId:l.layerId,chartKind:'line',channels:{x:{type:'number',values:rows.map(r=>r.x)},y:{type:'number',values:rows.map(r=>r.y)}}})));
  expect(refusal(draw(['line','line'],layers,{...folded,y:unresolved()}).el)).toContain('no shared domain');
  const {el}=draw(['line','line'],layers,folded);expect(refusal(el)).toBe('');expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(4);
 });
 it('plain views retain their own-extent handling of an unfolded declaration',()=>{
  const el=document.createElement('div');const h=lineRenderer().mount(el,{protocolVersion:RENDERER_PROTOCOL_VERSION,viewId:'v',callbacks:cb()});cleanups.push(()=>h.unmount());
  h.update({rows,encodings:{x:'x',y:'y'},selection:emptySelection('v'),hover:null,theme:{},size:{width:520,height:340},frame:{y:unresolved({transform:'log'})}});
  expect(refusal(el)).toBe('');expect(el.querySelectorAll('.vzf-line-dot')).toHaveLength(2);
 });
 it('names the binding layer when a preceding histogram binds no y',()=>{
  const histogram={...layer('histogram','bins'),encodings:{x:'x0'}};
  const line=layer('line','trend');
  const {el}=draw(['histogram','line'],[histogram,line],{y:unresolved()});
  expect(refusal(el)).toContain('channel "y" on layer "trend"');
  expect(refusal(el)).not.toContain('layer "bins"');
 });
 it.each(['line','point','bar','histogram','boxplot'])('%s follows the data advice through source/store/frame',async kind=>{
  const l=layer(kind);
  const columns=Object.fromEntries(Object.entries(l.rows[0]!).map(([key,value])=>[key,{type:typeof value==='number'?'number':'string'}]));
  const selectors:Record<string,string>={line:'.vzf-line-dot',point:'.vzf-dot',bar:'.vzf-barrect',histogram:'.vzf-histbar',boxplot:'.vzf-box'};
  const channels=Object.keys(l.encodings);
  // Empty categorical columns have no domain entry in the store path; do not fabricate one.
  for(const channel of kind==='bar'||kind==='boxplot'?['y']:channels){
   const declaration={mode:'shared',bounds:[0,10]};
   // A real definition may supply data and axis settings; it cannot supply a folded domain.
   const config={ [channel]:declaration };
   const render=async(sourceRows:typeof l.rows)=>{
    const session=buildDashboard({
     meta:{title:'axis values'},data:{t:{rows:sourceRows,columns}},
     actors:{v:{actor:'user',label:'values'}},
     encodings:[{viewId:'v',chartKind:kind,channels,initial:l.encodings,
      layers:[{layerId:l.layerId,table:'t',chartKind:kind,channels,initial:l.encodings}],frame:config}],
     defaultTable:'t',
    } as never).createSession({as:'user'});
    const store=createSessionView(sessionSource(session),{as:'user'});await store.refresh();
    const view=store.getState().views.find(v=>v.viewId==='v')!;
    const frame=await frameFor(session,{viewId:'v',layers:[{layerId:l.layerId,table:'t',chartKind:kind,encodings:l.encodings}],columns:store.getState().columns,frame:view.frame});
    return {...draw([kind],[{...l,rows:sourceRows}],frame),frame};
   };
   const empty=await render([]);
   expect(empty.frame[channel],channel).toMatchObject({unfolded:true});
   expect(refusal(empty.el),channel).toBe('channel '+JSON.stringify(channel)+' on layer "a" is declared shared, but no shared domain was folded. Give channel '+JSON.stringify(channel)+' values the shared axis can place.');
   expect(empty.el.querySelector(selectors[kind]!)).toBeNull();
   // Follow the only advice: populate the same typed table; change no setting or binding.
   const supplied=await render(l.rows);
   expect(supplied.frame[channel],channel).not.toHaveProperty('unfolded');
   expect(refusal(supplied.el),channel).toBe('');
   const marks=[...supplied.el.querySelectorAll(selectors[kind]!)];
   expect(marks,channel).toHaveLength(l.rows.length);
   for(const mark of marks){
    for(const name of kind==='line'||kind==='point'?['cx','cy','r']:['x','y','width','height']){
     expect(mark.hasAttribute(name),name).toBe(true);
     expect(Number.isFinite(Number(mark.getAttribute(name))),name).toBe(true);
    }
    for(const name of kind==='line'||kind==='point'?['r']:['width','height']) expect(Number(mark.getAttribute(name)),name).toBeGreaterThan(0);
   }
   expect(supplied.callbacks.emit).not.toHaveBeenCalled();
  }
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

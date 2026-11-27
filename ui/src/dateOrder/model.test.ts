// @vitest-environment node
/**
 * One word owner and no unobserved summary assessment. The layout is a band,
 * not a footer that can obscure an excluded/outside/zero note.
 */
import { describe, expect, it } from 'vitest';
import { frameDomains, type ResolvedChannel } from 'vizfootprint/def';
import { dateOrderNote, dateOrderLayout, foldedDateOrder, frameDateOrderNotes, lineDateOrder } from './model.js';
const mixed=['2026-04-01T23:00:00-05:00','2026-04-02T01:00:00Z','2026-04-02T05:00:00Z'];
const frame=frameDomains([{layerId:'a',channels:{x:{type:'date',values:mixed}}}]);
const layer=(kind='line',cells:readonly unknown[]=mixed)=>({kind,layer:{layerId:'a',table:'t',encodings:{x:'d'},rows:cells.map(d=>({d}))}});
describe('date-order presentation reads one observed owner',()=>{
 it('absence and a folded no-witness answer do not mean safe and do not fall back',()=>{
   expect(dateOrderNote(undefined)?.full ?? '').toBe('');expect(dateOrderNote(false)?.full ?? '').toBe('');
   const clean=frameDomains([{layerId:'a',channels:{x:{type:'date',values:['2026-04-01']}}}]);
   expect(dateOrderNote(lineDateOrder(clean,mixed))?.full ?? '').toBe('');
   expect(foldedDateOrder({x:{mode:'independent',guide:'per-layer'}},'x')).toBeUndefined();
 });
 it('labels shared x/y facts once per bound channel and does not assess unbound color',()=>{
   const f={...frame,y:frame.x!,color:frame.x!};
   expect(frameDateOrderNotes([{...layer(),layer:{...layer().layer,encodings:{x:'d',y:'d'}}}],f)).toHaveLength(2);
   expect(frameDateOrderNotes([layer()],{color:frame.x!})).toHaveLength(1); // only the line's own original x cells
   expect(frameDateOrderNotes([layer('scatter')],{color:frame.x!})).toEqual([]);
   expect(frameDateOrderNotes([layer()],frame)).toHaveLength(1);
 });
 it('never treats bins, quartiles, categorical labels or numeric axes as a fallback',()=>{
   for (const kind of ['histogram','heatmap','boxplot','scatter']) expect(frameDateOrderNotes([layer(kind)],undefined)).toEqual([]);
   const categorical={x:{mode:'shared',basis:'table',guide:'merged',scale:'categorical',domain:mixed}} as const;
   expect(frameDateOrderNotes([layer()],categorical)).toEqual([]);
   expect(frameDateOrderNotes([{kind:'line',layer:{...layer().layer,encodings:{}}}],undefined)).toEqual([]);
 });
 it('absent, refused/unfolded and old frame entries never invent a table count',()=>{
   const old={x:{mode:'shared',basis:'table',guide:'merged',scale:'temporal',domain:[mixed[1]!,mixed[2]!]}} as const;
   expect(dateOrderNote(lineDateOrder(old,mixed))?.full ?? '').toBe('');
   const refused={x:{mode:'shared',guide:'merged',basis:'table',unfolded:true,scaleKind:'temporal'}} as const;
   expect(dateOrderNote(lineDateOrder(refused,mixed))?.full ?? '').toContain('drawn rows');
   expect(frameDateOrderNotes([layer('line',[])],refused as Readonly<Record<string,ResolvedChannel>>)).toEqual([]);
 });
 it('wraps without dropping a character and takes zero room for no note',()=>{
   expect(dateOrderLayout([],400)).toEqual({notes:[],height:0});
   expect(dateOrderLayout([''],400)).toEqual({notes:[],height:0});
   const words=dateOrderNote(lineDateOrder(undefined,mixed))!.full;const layout=dateOrderLayout([words],200);
   expect(layout.notes[0]!.join('')).toBe(words);expect(layout.height).toBe(layout.notes[0]!.length*12+24);
   expect(dateOrderLayout(['xy'],0).notes).toEqual([['x','y']]);
 });
 it('wraps a Unicode layer name without splitting surrogate pairs or losing its words',()=>{
   const words='日'.repeat(27)+'🧪';
   const layout=dateOrderLayout([words],200);
   expect(layout.notes[0]!.join('')).toBe(words);
   for (const line of layout.notes[0]!) expect(Array.from(line).every(cell=>cell.length===2||cell.charCodeAt(0)<0xd800||cell.charCodeAt(0)>0xdfff)).toBe(true);
   expect(layout.notes[0]!.length).toBeGreaterThan(dateOrderLayout(['a'.repeat(28)],200).notes[0]!.length);
 });

});

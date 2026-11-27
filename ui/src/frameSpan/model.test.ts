// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ResolvedChannel } from 'vizfootprint/def';
import { stackSpan } from './model.js';
const missing={mode:'shared',basis:'table',guide:'merged',unfolded:true,scaleKind:'quantitative'} as const;
describe('stack span boundary',()=>{
 it('keeps undefined, independent and folded answers and removes only unrelated unfolded entries',()=>{
  expect(stackSpan(undefined,[])).toEqual({frame:undefined});
  const folded={mode:'shared',basis:'table',guide:'merged',scale:'quantitative',domain:[0,1]} as const;
  const independent={mode:'independent',guide:'per-layer'} as const;
  const frame={x:folded,y:independent,color:missing};
  const answer=stackSpan(frame,[{layerId:'a',encodings:{x:'v',y:'v'},channels:['x','y']}]);
  expect(answer).toEqual({frame:{x:folded,y:independent}});
  if('frame' in answer){expect(answer.frame?.x).toBe(folded);expect(answer.frame?.y).toBe(independent);}
 });
 it('uses the passed axis binding and names only the first missing domain, without attributing a cause',()=>{
  const frame:Record<string,ResolvedChannel>={x:missing,y:missing};
  const answer=stackSpan(frame,[{layerId:'right',encodings:{y:'v'},channels:['x','y']}]);
  expect(answer).toHaveProperty('refused');
  if('refused' in answer){expect(answer.refused).toContain('channel "y" on layer "right"');expect(answer.refused).not.toContain('failed');}
 });
});

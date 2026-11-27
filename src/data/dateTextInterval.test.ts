/**
 * Reviewer D30 probe, now a source regression: declared dates and untyped
 * original text take the SAME interval through real memory and DuckDB sessions.
 * This pins the user-facing warning's premise without normalizing stored rows.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboardAsync } from '../def/index.js';
import { duckdbConnection } from './duckdbConnection.js';
import { canLoad, type LoadingConnection } from './sqlConnection.js';
const cases = [
  { name: 'mixed offsets', values: ['2026-04-01T23:00:00-05:00','2026-04-02T01:00:00Z','2026-04-02T05:00:00Z'], range: ['2026-04-02T01:00:00Z','2026-04-02T05:00:00Z'], ids: ['1','2'] },
  { name: 'same instant', values: ['2026-04-02T01:00:00Z','2026-04-01T20:00:00-05:00','2026-04-02T05:00:00Z'], range: ['2026-04-02T01:00:00Z','2026-04-02T05:00:00Z'], ids: ['0','2'] },
  { name: 'uniform UTC', values: ['2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','2026-04-02T05:00:00Z'], range: ['2026-04-02T00:00:00Z','2026-04-02T05:00:00Z'], ids: ['0','1','2'] },
];
describe.each([true,false])('original date text on memory and SQL (declared date: %s)', declared => {
  it.each(cases)('$name retains the same original rows on both engines', async test => {
    const rows=test.values.map((when,id)=>({id:String(id),when,value:id+1}));
    const before=JSON.stringify(rows);
    for (const engine of ['memory','wasm'] as const) {
      const schemas: (readonly Record<string,unknown>[])[]=[];
      const opener=duckdbConnection({host:'node'});
      const dashboard=await buildDashboardAsync({
        meta:{title:'Date interval parity'},
        data:{t:{engine,key:'id',rows,...(declared?{columns:{id:{role:'identifier'},when:{type:'date',role:'dimension'}}}:{})}},
        actors:{view:{actor:'user'}},defaultTable:'t',
      },{openSqlConnection:async()=>{
        const conn=await opener();
        if (!canLoad(conn)) throw new Error('DuckDB must expose its loading port');
        const tapped: LoadingConnection = {query:sql=>conn.query(sql),load:async(table,data)=>{
          await conn.load(table,data);
          const quoted='"'+table.replaceAll('"','""')+'"';
          schemas.push(await conn.query('DESCRIBE '+quoted));
        },close:async()=>{await conn.close?.();}};
        return tapped;
      }});
      try {
        const session=dashboard.createSession();
        const landed=await session.viewQuery({table:'t'});expect(landed.ok).toBe(true);
        if (!landed.ok) throw new Error('expected landed rows');
        expect(landed.rows.map(row=>row['when'])).toEqual(test.values);
        const dispatched=await session.dispatch({verb:'filter',viewId:'view',field:'when',range:[test.range[0]!,test.range[1]!],cause:{requestedBy:'user',computedBy:'user',intent:'filter on a date interval'}});
        expect(dispatched.ok).toBe(true);
        const answer=await session.viewQuery({table:'t'});expect(answer.ok).toBe(true);
        if (!answer.ok) throw new Error('expected filtered rows');
        expect(answer.rows.map(row=>String(row['id'])).sort()).toEqual(test.ids);
        expect(answer.count).toBe(test.ids.length);
        if (engine==='wasm') expect(schemas.flat().find(row=>row['column_name']==='when')?.['column_type']).toBe('VARCHAR');
      } finally { await dashboard.close(); }
    }
    expect(JSON.stringify(rows)).toBe(before);
  });
});

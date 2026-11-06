// Load the retained archives through their installed package doors, not source aliases.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const source = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const provenance = JSON.parse(await readFile(join(output, 'provenance.json'), 'utf8'));
const consumer = await mkdtemp(join(source, '.private-runtime-consumer-'));
try {
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  for (const pkg of provenance.packages) {
    const destination = join(consumer, 'node_modules', pkg.name);
    await mkdir(destination, { recursive: true });
    execFileSync('tar', ['-xzf', join(output, pkg.archive), '--strip-components=1', '-C', destination]);
    assert.equal(await realpath(destination), destination);
    assert.equal(await readFile(join(destination, 'package.json'), 'utf8'),
      await readFile(join(source, pkg.name === 'vizfootprint' ? '' : 'ui', 'package.json'), 'utf8'));
    const installed = [];
    async function walk(relative = '') {
      for (const entry of await readdir(join(destination, relative))) {
        const name = relative ? relative + '/' + entry : entry;
        const info = await lstat(join(destination, name));
        assert.equal(info.isSymbolicLink(), false);
        if (info.isDirectory()) await walk(name);
        else {
          assert.equal(info.isFile(), true);
          const data = await readFile(join(destination, name));
          installed.push({path: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')});
        }
      }
    }
    await walk();
    installed.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    assert.deepEqual(installed, pkg.files);
  }
  const child = `
    import assert from 'node:assert/strict';
    import {buildDashboard,vizAsTools} from 'vizfootprint/agent';
    import {createArrayProfileProvider,createFieldNamespace,profileData,profileStatisticAssertion,summarizeDataResult,summarizeProfileResult,summarizeRankResult} from 'vizfootprint/data';
    import {defineAnalysis} from 'vizfootprint/analysis';
    import {Sheet,VizBar,VizCockpit,VizFrame,VizLine,brightPredicate,defaultLayout,mapPollState,selectionForView} from 'vizfootprint-ui';
    for(const value of [buildDashboard,vizAsTools,createArrayProfileProvider,createFieldNamespace,profileData,profileStatisticAssertion,summarizeDataResult,summarizeProfileResult,summarizeRankResult,defineAnalysis])assert.equal(typeof value,'function');
    for(const value of [Sheet,VizBar,VizCockpit,VizFrame,VizLine,brightPredicate,defaultLayout,mapPollState,selectionForView])assert.notEqual(value,undefined);
    const ns=createFieldNamespace({datasetRef:'retained-runtime',table:'items',fields:['value']});
    assert.equal(ns.resolve(ns.field('value').nativeField).reference.table,'items');
    const schema={source:{id:'synthetic-retained-source',version:'1'},table:'requests',grain:'One synthetic request',columns:[{name:'duration',type:'number',role:'measure',meaning:'Completed duration',unit:'ms'}]};
    const result=await profileData(createArrayProfileProvider(schema,[{duration:10},{duration:20},{duration:null}]),{kind:'profile',version:1,ops:1,source:schema.source,selectionRef:'all',fields:[{field:'duration',statistics:['mean']}]},{operationId:'retained-profile',resultRef:'retained-result'});
    const observation=profileStatisticAssertion(result,{field:'duration',statistic:'mean',scope:'retained-consumer',epoch:1,stratum:'asserted'});
    assert.equal(observation.value,15);
    assert.ok(summarizeProfileResult(result));
    const dashboard=buildDashboard({actors:{},data:{items:{rows:[{id:'synthetic-key',value:1}],key:'id',engine:'memory'}}});
    assert.equal(typeof vizAsTools(dashboard.createSession({as:'agent'}),{as:'agent'}).call,'function');
    console.log('retained-public-doors-profile-session-ok');
  `;
  await writeFile(join(consumer, 'probe.mjs'), child);
  const publicProbe = execFileSync(process.execPath, [join(consumer, 'probe.mjs')], { encoding: 'utf8', timeout: 60_000 });
  assert.match(publicProbe, /retained-public-doors-profile-session-ok/);
  const rootRequire = createRequire(join(source, 'package.json'));
  const require = createRequire(join(consumer, 'package.json'));
  const uiRequire = createRequire(require.resolve('vizfootprint-ui/package.json'));
  const coreRequire = createRequire(require.resolve('vizfootprint/package.json'));
  const agentRequire = createRequire(rootRequire.resolve('agentfootprint'));
  assert.equal(uiRequire.resolve('vizfootprint/agent'), require.resolve('vizfootprint/agent'));
  const owners = {};
  for (const name of ['footprintjs', 'foottrace']) {
    const owner = await realpath(rootRequire.resolve(name));
    for (const from of [require, coreRequire, uiRequire, agentRequire]) assert.equal(await realpath(from.resolve(name)), owner);
    owners[name] = owner;
  }
  assert.ok((await readFile(require.resolve('vizfootprint-ui/styles.css'))).length);
  await writeFile(join(output, 'PROBE.json'), JSON.stringify({
    result: 'PASS', qualification: 'retained archives; native installed dependency graph; synthetic data only',
    source: provenance.source, namedImports: 19, publicDoors: 4, actualProfileMean: 15,
    uiResolvesExtractedCore: true, sharedOwners: owners, applicationAcceptanceClaimed: false,
  }, null, 2) + '\n');
  console.log(publicProbe.trim());
} finally {
  await rm(consumer, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, readFileSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { npmEnvironment } from './setup.mjs';

test('separate empty native npm config files load without credentials or double-loading',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'viz-npm-config-')));
  try {
    const env=npmEnvironment(root,{PATH:process.env.PATH,HOME:process.env.HOME,
      GH_TOKEN:'inert-not-a-credential',NODE_OPTIONS:'not inherited'});
    assert.notEqual(env.NPM_CONFIG_USERCONFIG,env.NPM_CONFIG_GLOBALCONFIG);
    for(const path of [env.NPM_CONFIG_USERCONFIG,env.NPM_CONFIG_GLOBALCONFIG]) {
      assert.equal(readFileSync(path).length,0);assert.equal(lstatSync(path).mode & 0o777,0o600);
    }
    assert.equal(env.HOME,process.env.HOME);assert(!Object.hasOwn(env,'GH_TOKEN'));assert(!Object.hasOwn(env,'NODE_OPTIONS'));
    const registry=execFileSync('npm',['config','get','registry'],{cwd:root,env,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});
    assert.equal(registry.trim(),'https://registry.npmjs.org/');
    console.log('read-only npm config intake',execFileSync('npm',['--version'],{cwd:root,env,encoding:'utf8',timeout:15000}).trim());
  } finally {rmSync(root,{recursive:true});}
});

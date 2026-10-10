import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectBridge } from './arthur-agent-bridge-status.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-bridge-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const controlRoot=path.join(root,'control');
  const codexRoot=path.join(root,'codex');
  for(const s of ['pending','running','approval','blocked','done','failed','quarantine']) {
    fs.mkdirSync(path.join(controlRoot,'queue',s),{recursive:true});
  }
  fs.mkdirSync(path.join(controlRoot,'config'),{recursive:true});
  fs.mkdirSync(path.join(codexRoot,'tasks'),{recursive:true});
  fs.writeFileSync(path.join(codexRoot,'.arthur-codex-queue-ready'),'ready');
  fs.writeFileSync(path.join(controlRoot,'config','config.json'),JSON.stringify({
    codex:{enabled:true},kimi:{enabled:false},
  }));
  return {controlRoot,codexRoot};
}
const id='12345678-1234-1234-1234-1234567890ab';

test('reports both queues but never reads descriptions or owner IDs into its output',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.codexRoot,'tasks',id+'.json'),JSON.stringify({
    id,project:'arthur',state:'needs_review',updatedAt:'2026-10-11T00:00:00.000Z',
    description:'secret user request',actorId:'secret actor',
  }));
  fs.writeFileSync(path.join(f.controlRoot,'queue','approval','task.json'),'{}');
  const result=inspectBridge({...f,now:Date.parse('2026-10-11T01:00:00Z')});
  assert.equal(result.ok,true);
  assert.equal(result.codex.needs_review,1);
  assert.equal(result.control.approval,1);
  assert.equal(result.attention.needsReview,1);
  const printed=JSON.stringify(result);
  assert.equal(printed.includes('secret'),false);
  assert.equal(printed.includes(id),false);
});

test('fails safe when Kimi enabled or a queue is unavailable',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.controlRoot,'config','config.json'),JSON.stringify({
    codex:{enabled:true},kimi:{enabled:true},
  }));
  fs.rmSync(path.join(f.codexRoot,'tasks'),{recursive:true,force:true});
  const out=inspectBridge(f);
  assert.equal(out.ok,false);
  assert.ok(out.problems.some(x=>x.includes('Kimi still enabled')));
  assert.ok(out.problems.some(x=>x.includes('tasks directory unavailable')));
});

test('detects stale run and malformed records without executing anything',t=>{
  const f=fixture(t);
  const task={id,project:'miska',state:'running',updatedAt:'2026-10-10T00:00:00Z'};
  fs.writeFileSync(path.join(f.codexRoot,'tasks',id+'.json'),JSON.stringify(task));
  fs.writeFileSync(path.join(f.codexRoot,'tasks','99999999-9999-9999-9999-999999999999.json'),'{bad');
  const out=inspectBridge({...f,now:Date.parse('2026-10-11T12:00:00Z')});
  assert.equal(out.codex.running,1);
  assert.equal(out.codex.malformed,1);
  assert.equal(out.ok,false);
  assert.ok(out.problems.some(x=>x.includes('over four hours')));
  assert.deepEqual(out.codex.projects,['miska']);
});

test('ignores non-UUID task files, no write effects',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.codexRoot,'tasks','README.json'),'{"state":"queued"}');
  const before=fs.readdirSync(path.join(f.codexRoot,'tasks'));
  const out=inspectBridge(f);
  assert.equal(out.codex.total,0);
  assert.deepEqual(fs.readdirSync(path.join(f.codexRoot,'tasks')),before);
});

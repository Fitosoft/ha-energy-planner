import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { batterySoc } from '../src/sources.mjs';
import { scenarioId, suggestedScenario, localTime, recordDecision, decisionContext, decisionPage } from '../src/decisions.mjs';
import { archiveRun, atomicJson, json, validateArchive } from '../src/archive.mjs';
import { demo } from '../examples/demo.mjs';
import { plan } from '../src/cli.mjs';
import * as render from '../src/report.mjs';
import { startService } from '../src/service.mjs';

const now=Date.parse('2026-11-15T20:55:29+01:00');
test('zero SOC unchanged for hours is valid with a fresh report; invalid and stale data remain errors',()=>{
  const soc={state:'0',last_changed:'2026-11-15T08:00:00Z',last_updated:'2026-11-15T08:00:00Z',last_reported:'2026-11-15T19:55:08Z',server_now:'2026-11-15T20:55:29+01:00'};
  assert.equal(batterySoc(soc,now),0);
  assert.equal(batterySoc({...soc,last_reported:'2026-11-15T20:55:08+01:00'},now),0);
  assert.throws(()=>batterySoc({...soc,last_reported:'2026-11-15T18:00:00Z'},now),/veraltet/);
  assert.throws(()=>batterySoc({...soc,last_reported:'2026-11-15T20:55:08Z'},now),/Zukunft/);
  for(const state of ['', ' ', 'unknown','unavailable','NaN','-1','101'])assert.throws(()=>batterySoc({...soc,state},now));
  assert.throws(()=>batterySoc({...soc,last_reported:'2026-11-15T20:55:08'},now),/Zeitzone/);
  assert.throws(()=>batterySoc({...soc,server_now:'2026-11-15T22:55:29+01:00'},now),/Uhr/);
  assert.throws(()=>batterySoc({...soc,last_reported:undefined},now),/veraltet/);
  assert.equal(batterySoc({...soc,last_reported:undefined,last_updated:soc.last_reported},now),0);
});
test('Vienna implementation window conversion rejects ambiguous and missing DST times',()=>{
  assert.equal(localTime('2026-11-16T01:30','Europe/Vienna'),Date.parse('2026-11-16T00:30Z'));
  assert.equal(localTime('2026-06-16T01:30','Europe/Vienna'),Date.parse('2026-06-15T23:30Z'));
  assert.throws(()=>localTime('2026-10-25T02:30','Europe/Vienna'),/doppeldeutig/);
  assert.throws(()=>localTime('2026-03-29T02:30','Europe/Vienna'),/existiert/);
});
async function fixture(){
  const base=resolve('local/test-temp');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'decisions-'));
  for(const folder of ['runs','actual'])await mkdir(join(dir,folder));
  const{config,snapshot}=demo(),report=plan(config,snapshot,true);const id=await archiveRun(dir,snapshot,config,report,render,'test');
  const folder=join(dir,'runs',id),manifest=await json(join(folder,'manifest.json'));
  return{dir,folder,config,report,id,manifest};
}
test('four stable scenario IDs, explicit confirmation and append-only changes survive restart and stay per run',async()=>{
  const f=await fixture();assert.deepEqual(f.report.scenarios.map(s=>s.id),['z0-w0','z0-w1','z1-w0','z1-w1']);
  assert.equal((await decisionContext(f.folder,f.report)).planned,null);
  const first=await recordDecision(f.folder,f.manifest,f.report,f.config,{kind:'planned',scenarioId:'z1-w1',expectedRevision:0},now);
  const second=await recordDecision(f.folder,f.manifest,f.report,f.config,{kind:'planned',scenarioId:'z0-w0',expectedRevision:1},now+1);
  assert.notEqual(first.id,second.id);
  const reloaded=await decisionContext(f.folder,f.report);assert.equal(reloaded.history[0].scenarioId,'z1-w1');assert.equal(reloaded.planned.scenarioId,'z0-w0');assert.equal(reloaded.history[0].runId,f.id);assert.deepEqual(reloaded.planned.horizon,{start:f.manifest.start,end:f.manifest.end});
  await assert.rejects(recordDecision(f.folder,f.manifest,f.report,f.config,{kind:'planned',scenarioId:'z0-w1',expectedRevision:0}),/inzwischen/);
  const other=await fixture();assert.equal((await decisionContext(other.folder,other.report)).planned,null);
  assert.equal(suggestedScenario({...f.report,defaultZoe:null}),null);
  assert.ok(!render.html({...f.report,defaultZoe:null},f.config).includes(' · VORWAHL'));
});
test('implemented windows are separate user declarations tied to the exact planned event',async()=>{
  const f=await fixture();
  const planned=await recordDecision(f.folder,f.manifest,f.report,f.config,{kind:'planned',scenarioId:'z1-w0',expectedRevision:0});
  const input={kind:'implemented',scenarioId:'z1-w0',expectedRevision:1,confirmImplemented:true,windows:[{start:'2026-11-09T01:00',end:'2026-11-09T02:00',targetSoc:20}]};
  await assert.rejects(recordDecision(f.folder,f.manifest,f.report,f.config,{...input,confirmImplemented:false}),/ausdrücklich/);
  await assert.rejects(recordDecision(f.folder,f.manifest,f.report,f.config,{...input,windows:[{...input.windows[0],targetSoc:101}]}),/Ziel-SOC/);
  await assert.rejects(recordDecision(f.folder,f.manifest,f.report,f.config,{...input,windows:[
    {start:'2026-11-08T23:00',end:'2026-11-09T00:00',targetSoc:60},
    {start:'2026-11-09T00:00',end:'2026-11-09T01:00',targetSoc:10},
    {start:'2026-11-09T01:00',end:'2026-11-09T07:00',targetSoc:100}
  ]}),/zwei Fenster insgesamt/);
  const implemented=await recordDecision(f.folder,f.manifest,f.report,f.config,input);
  assert.equal(implemented.plannedEventId,planned.id);assert.equal(implemented.windows[0].start,Date.parse('2026-11-09T00:00Z'));assert.match(implemented.evidence,/not_device_verified/);
  await recordDecision(f.folder,f.manifest,f.report,f.config,{kind:'planned',scenarioId:'z0-w1',expectedRevision:2});
  const context=await decisionContext(f.folder,f.report);assert.equal(context.implemented.scenarioId,'z1-w0');assert.equal(context.planned.scenarioId,'z0-w1');
});
test('historical validation revisions preserve their own confirmed scenario',async()=>{
  const f=await fixture(),at=f.report.end+3*3600000;
  await recordDecision(f.folder,f.manifest,f.report,f.config,{kind:'planned',scenarioId:'z0-w0',expectedRevision:0},at-1);
  await validateArchive(f.dir,{loadPower:'load',pvPower:'pv'},at);
  assert.equal((await json(join(f.folder,'validation.json'))).selection.planned.scenarioId,'z0-w0');
  await recordDecision(f.folder,f.manifest,f.report,f.config,{kind:'planned',scenarioId:'z1-w1',expectedRevision:1},at+1);
  await validateArchive(f.dir,{loadPower:'load',pvPower:'pv'},at+2);
  assert.equal((await json(join(f.folder,'validation.json'))).selection.planned.scenarioId,'z1-w1');
  const{readdir}=await import('node:fs/promises');const history=await readdir(join(f.folder,'validation-history'));assert.equal(history.length,2);
  const versions=await Promise.all(history.map(n=>json(join(f.folder,'validation-history',n))));assert.deepEqual(new Set(versions.map(v=>v.selection.planned.scenarioId)),new Set(['z0-w0','z1-w1']));
});
test('live latest redirect recovers from wrong state pointer; report banner and confirmation POST use the exact run',async()=>{
  const f=await fixture();await atomicJson(join(f.dir,'state.json'),{latest:'wrong-old-run',lastSuccess:'2020-01-01T00:00Z'});
  const service=await startService(f.dir,{port:0,host:'127.0.0.1',ingressOnly:false,timers:false}),base=`http://127.0.0.1:${service.server.address().port}/`;
  try{
    const latest=await fetch(base+'latest',{redirect:'manual'});assert.equal(latest.headers.get('location'),`runs/${f.id}/report.html`);
    const archivedBefore=await readFile(join(f.folder,'report.html'),'utf8');const page=await(await fetch(base+`runs/${f.id}/report.html`)).text();assert.match(page,/Geplante Variante: nicht bestätigt/);assert.equal(await(await fetch(base+`runs/${f.id}/report.html?download=1`)).text(),archivedBefore);
    const review=await(await fetch(base+`runs/${f.id}/review`)).text();assert.doesNotThrow(()=>new Function(review.match(/<script>([\s\S]*?)<\/script>/)[1]));const token=JSON.parse(review.match(/const token=("[^"]+")/)[1]);
    const response=await fetch(base+`runs/${f.id}/decision`,{method:'POST',headers:{'X-Planner-CSRF':token},body:JSON.stringify({kind:'planned',scenarioId:'z0-w1',expectedRevision:0})});assert.equal(response.status,200);
    const result=await(await fetch(base+`runs/${f.id}/decisions.json`)).json();assert.equal(result.planned.scenarioId,'z0-w1');assert.equal(result.runId,f.id);
    assert.equal(await readFile(join(f.folder,'report.html'),'utf8'),archivedBefore);
  }finally{await service.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
async function testDirectory(prefix){const base=resolve('local/test-temp');await mkdir(base,{recursive:true});return mkdtemp(join(base,prefix));}
import { join } from 'node:path';
import { apiUrl, websocketRequest } from '../src/ha.mjs';
import { archiveRun, atomicJson, mergeStatistics, validateForecast, validateArchive, json } from '../src/archive.mjs';
import { scheduleDue, sendNotifications, DEFAULT_NOTIFICATIONS, startService } from '../src/service.mjs';
import { eligibleHours } from '../src/learning.mjs';
import { demo } from '../examples/demo.mjs';
import { plan } from '../src/cli.mjs';
import * as render from '../src/report.mjs';

test('HA proxy REST queries and websocket path are correct', async()=>{
  assert.equal(apiUrl('http://supervisor/core','history/period/DATE?no_attributes').href,'http://supervisor/core/api/history/period/DATE?no_attributes');
  assert.equal(apiUrl('http://homeassistant:8123/','states').href,'http://homeassistant:8123/api/states');
  let observed;
  class Socket extends EventTarget {
    constructor(url){super();observed=url.href;queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:'{"type":"auth_ok"}'})));}
    send(){queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:'{"type":"result","id":1,"success":true,"result":{}}'})));}
    close(){}
  }
  await websocketRequest('http://supervisor/core','test',{type:'energy/get_prefs'},Socket);
  assert.equal(observed,'ws://supervisor/core/websocket');
});
test('20:00 scheduler catches up same evening and never repeats an attempted date',()=>{
  assert.equal(scheduleDue(Date.parse('2026-11-09T18:59Z'),{},'Europe/Vienna'),false);
  assert.equal(scheduleDue(Date.parse('2026-11-09T19:00Z'),{},'Europe/Vienna'),true);
  assert.equal(scheduleDue(Date.parse('2026-11-09T21:00Z'),{attemptDate:'2026-11-09'},'Europe/Vienna'),false);
  assert.equal(scheduleDue(Date.parse('2026-11-10T08:00Z'),{attemptDate:'2026-11-09'},'Europe/Vienna'),false);
  assert.equal(scheduleDue(Date.parse('2026-06-01T18:00Z'),{},'Europe/Vienna'),true);
});
test('iPhone and all six Alexa entities use requested HA actions; failures are independent',async()=>{
  const calls=[];
  const result=await sendNotifications(DEFAULT_NOTIFICATIONS,'Fertig','/hassio/ingress/test',async(path,body)=>{calls.push({path,body});if(path.includes('mobile'))throw Error('unavailable');});
  assert.deepEqual(result,{mobile:'failed',alexa:'sent'});
  assert.equal(calls[0].body.data.url,'/hassio/ingress/test');
  assert.equal(calls[1].path,'services/notify/send_message');
  assert.deepEqual(calls[1].body.entity_id,DEFAULT_NOTIFICATIONS.alexa);
});
test('validation requires all three five-minute means; zeros are valid and gaps stay missing',()=>{
  const report={exportTariff:{eurPerKwh:.18},scenarios:[{name:'Test',plan:{trace:[{start:0,end:900000,loadKwh:.25,pvKwh:0,soc:20,price:.3}]}}]};
  const series=mean=>[0,1,2].map(i=>({start:i*300000,end:(i+1)*300000,mean}));
  const stats={load:series(1000),pv:series(0)};
  const entities={loadPower:'load',pvPower:'pv'};
  const v=validateForecast(report,stats,entities).scenarios[0];
  assert.equal(v.load.coverage,1);assert.equal(v.load.maeKwhPerSlot,0);assert.equal(v.pv.actualKwhOnCoveredSlots,0);
  stats.load.pop();
  assert.equal(validateForecast(report,stats,entities).scenarios[0].rows[0].loadActualKwh,null);
  stats.load=series(1000);stats.load[1].mean=null;
  assert.equal(validateForecast(report,stats,entities).scenarios[0].load.coverage,0);
});
test('forecast archive is reproducible, immutable and validates only after horizon plus lag',async()=>{
  const dir=await testDirectory('archive-');for(const s of ['runs','actual'])await mkdir(join(dir,s));
  const {config,snapshot}=demo();const report=plan(config,snapshot,true);
  const id=await archiveRun(dir,snapshot,config,report,render,'test');
  assert.equal((await json(join(dir,'runs',id,'input.json'))).generatedAt,snapshot.generatedAt);
  assert.match(await readFile(join(dir,'runs',id,'forecast.csv'),'utf8'),/chargeKwh/);
  await assert.rejects(archiveRun(dir,snapshot,config,report,render,'test'),{code:'EEXIST'});
  await validateArchive(dir,{loadPower:'load',pvPower:'pv'},report.end+3600000);
  assert.equal(await json(join(dir,'runs',id,'validation.json'),null),null);
  await validateArchive(dir,{loadPower:'load',pvPower:'pv'},report.end+7200001);
  assert.equal((await json(join(dir,'runs',id,'validation.json'))).complete,false);
  assert.match(await readFile(join(dir,'runs',id,'validation.html'),'utf8'),/Prognose und Ist/);
});
test('statistics archive merges overlap without duplicate rows',async()=>{
  const dir=await testDirectory('stats-');await mkdir(join(dir,'actual'));
  const row={start:Date.parse('2026-11-09T00:00Z'),end:Date.parse('2026-11-09T00:05Z'),mean:1000};
  await mergeStatistics(dir,{load:[row]},'Europe/Vienna');await mergeStatistics(dir,{load:[{...row,mean:1100}]},'Europe/Vienna');
  const d=await json(join(dir,'actual','2026-11-09-statistics.json'));assert.equal(d.load.length,1);assert.equal(d.load[0].mean,1100);
});
test('automatic profile learning rejects unknown Zoe status and legionella buffer',()=>{
  const {config}=demo();const start=Date.parse('2026-11-09T08:00Z');
  const statistics={load:Array.from({length:12},(_,i)=>({start:start+i*300000,end:start+(i+1)*300000,mean:1000}))};
  assert.equal(eligibleHours(statistics,[],config,'load').length,0);
  const h=[[{entity_id:'binary_sensor.zoe_ladestatus',state:'off',last_changed:new Date(start).toISOString()}]];
  h[0].push({entity_id:'sensor.letzte_batterieaktivitat',state:new Date(start).toISOString(),last_changed:new Date(start).toISOString()});
  assert.equal(eligibleHours(statistics,h,config,'load')[0].baseKw,1);
  h[0].push({entity_id:'binary_sensor.zoe_ladestatus',state:'on',last_changed:new Date(start+600000).toISOString()});
  assert.equal(eligibleHours(statistics,h,config,'load').length,0);
});
test('web UI requires CSRF, exposes no secrets and serves only allowlisted archives',async()=>{
  const dir=await testDirectory('ui-');
  await atomicJson(join(dir,'options.json'),{solcast_api_key:'NEVER-EXPOSE-THIS'});
  const service=await startService(dir,{port:0,host:'127.0.0.1',ingressOnly:false,timers:false});
  const base=`http://127.0.0.1:${service.server.address().port}/`;
  try{
    const page=await(await fetch(base)).text();assert.match(page,/Einrichtung erforderlich/);assert.ok(!page.includes('NEVER-EXPOSE-THIS'));
    assert.equal((await fetch(base+'settings',{method:'POST',body:'{}'})).status,400);
    assert.equal((await fetch(base+'private.json')).status,404);
    assert.equal((await fetch(base+'health')).status,200);
  }finally{await service.close();}
});
test('complete service run archives four variants, publishes success and notifies after saving',async()=>{
  const dir=await testDirectory('e2e-');const{config}=demo();
  config.entities=JSON.parse(await readFile('config.example.json','utf8')).entities;
  await atomicJson(join(dir,'options.json'),{planner_json:JSON.stringify(config),solcast_resource_id:'test-site',solcast_api_key:'test-key'});
  const originalFetch=globalThis.fetch, originalWS=globalThis.WebSocket;
  const originalEnv={HA_URL:process.env.HA_URL,HA_TOKEN:process.env.HA_TOKEN,SOLCAST_API_KEY:process.env.SOLCAST_API_KEY,SOLCAST_RESOURCE_ID:process.env.SOLCAST_RESOURCE_ID};
  process.env.HA_URL='http://ha.test';process.env.HA_TOKEN='test-token';
  const now=Date.now(),hour=Math.floor(now/3600000)*3600000;
  const calls=[];
  class Socket extends EventTarget{
    constructor(){super();queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:'{"type":"auth_ok"}'})));}
    send(){queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'result',id:1,success:true,result:{energy_sources:[{type:'grid',stat_energy_to:'test.export',number_energy_price_export:.18}]}})})));}
    close(){}
  }
  globalThis.WebSocket=Socket;
  globalThis.fetch=async(url,options={})=>{
    const u=new URL(url);let data;
    if(u.hostname==='api.awattar.at')data={data:Array.from({length:72},(_,i)=>({start_timestamp:hour+i*3600000,end_timestamp:hour+(i+1)*3600000,marketprice:100,unit:'Eur/MWh'}))};
    else if(u.hostname==='api.solcast.com.au')data={forecasts:Array.from({length:144},(_,i)=>({period_end:new Date(hour+(i+1)*1800000).toISOString(),period:'PT30M',pv_estimate:0}))};
    else if(u.pathname.startsWith('/api/states/')){
      const id=decodeURIComponent(u.pathname.split('/').at(-1));
      data={entity_id:id,state:id===config.entities.batterySoc?'50':id===config.entities.zoeSoc?'84':id===config.entities.zoeActivity?new Date().toISOString():id===config.entities.zoePlug?'off':'unplugged',last_updated:new Date().toISOString(),attributes:{}};
    }else if(u.pathname.startsWith('/api/services/')){
      assert.ok((await json(join(dir,'state.json'))).latest,'run must be committed before notification');calls.push(u.pathname);data=[];
    }else throw Error('Unexpected request');
    return{ok:true,status:200,json:async()=>data};
  };
  let service;
  try{
    service=await startService(dir,{port:0,host:'127.0.0.1',ingressOnly:false,timers:false});
    const id=await service.run(true);
    const report=await json(join(dir,'runs',id,'plan.json'));assert.equal(report.scenarios.length,4);assert.ok(report.scenarios.every(s=>s.plan));
    const state=await json(join(dir,'state.json'));assert.equal(state.status,'success');assert.equal(state.notification.mobile,'sent');assert.equal(calls.length,2);
    assert.ok(!(await readFile(join(dir,'runs',id,'input.json'),'utf8')).includes('test-key'));
  }finally{
    if(service)await service.close();globalThis.fetch=originalFetch;globalThis.WebSocket=originalWS;
    for(const[k,v]of Object.entries(originalEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});

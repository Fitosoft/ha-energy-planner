import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendRisk } from '../src/risk.mjs';
import { simulate, validWindows } from '../src/model.mjs';
import { windowEndSoc, html, markdown } from '../src/report.mjs';
import { STEP } from '../src/time.mjs';
import { demo } from '../examples/demo.mjs';
import { plan } from '../src/cli.mjs';

function fixture(feed){
  const{config}=demo();config.exportEurPerKwh=feed;config.battery={...config.battery,capacityKwh:1,chargeKw:4,dischargeKw:4,chargeEfficiency:1,dischargeEfficiency:1};
  const slots=[{start:0,end:STEP,date:'2026-11-16',loadKwh:0,pvKwh:0,price:.3},{start:STEP,end:2*STEP,date:'2026-11-16',loadKwh:1,pvKwh:0,price:.5}];
  const cases=['P10','P50','P90'].map((name,i)=>({name,slots:slots.map((s,n)=>({...s,pvKwh:n===1&&i===2?2:0}))}));
  return{config,cases};
}

test('PV risk search evaluates intermediate targets instead of choosing only extreme proposals',()=>{
  const {config,cases}=fixture(.05),p=recommendRisk(cases,config,0);
  assert.ok(p.windows.some(w=>w.targetSoc>0&&w.targetSoc<100));
  assert.ok(p.risk.maxExtraCostEur<p.risk.candidates.find(c=>c.windows.length===0).maxExtraCostEur);
});
test('feed-in tariff changes the PV-risk decision under target-limited charging',()=>{
  const low=fixture(.05),high=fixture(.25);
  const a=recommendRisk(low.cases,low.config,0),b=recommendRisk(high.cases,high.config,0);
  assert.notDeepEqual(a.windows,b.windows);
  assert.notEqual(b.cost,a.cost);
  for(const[c,p]of [[low,a],[high,b]]){
    assert.ok(validWindows(c.cases[1].slots,p.windows,c.config.battery));
    assert.ok(p.risk.cases.every(r=>r.extraCost>=-1e-9));
    assert.equal(p.risk.maxExtraCostEur,Math.min(...p.risk.candidates.map(c=>c.maxExtraCostEur)));
  }
});
test('risk comparison requires consistent load and prices and remains reference-case reproducible',()=>{
  const{config,cases}=fixture(.25),p=recommendRisk(cases,config,0);
  assert.equal(p.cost,simulate(cases[1].slots,config.battery,0,p.windows,config.exportEurPerKwh).cost);
  cases[0].slots[1].price=.6;
  assert.throws(()=>recommendRisk(cases,config,0),/dieselben Preise/);
});
test('hourly charging is power limited; high target is not promised at window end',()=>{
  const{config}=demo();const b={...config.battery,capacityKwh:16,chargeKw:10};
  const slots=Array.from({length:4},(_,i)=>({start:i*STEP,end:(i+1)*STEP,loadKwh:0,pvKwh:0,price:.3}));
  const w={start:0,end:4*STEP,targetSoc:100},p=simulate(slots,b,0,[w],0,true);
  assert.equal(p.finalSoc,59.375);assert.equal(windowEndSoc(p,w).reached,false);
  assert.equal(windowEndSoc(p,w).soc,59.375);
});
test('four load scenarios retain their identity with price-risk recommendations and explicit reporting',()=>{
  const{config,snapshot}=demo();config.pvStrategy='price_risk';
  snapshot.solar.forecasts=snapshot.solar.forecasts.map(r=>({...r,pv_estimate10:r.pv_estimate*.5,pv_estimate90:r.pv_estimate*1.5}));
  const report=plan(config,snapshot,true);
  assert.equal(report.scenarios.length,4);assert.ok(report.scenarios.every(s=>s.plan?.risk.cases.length===3));
  assert.ok(report.scenarios.every(s=>s.plan.windows.length<=2));
  assert.match(html(report,config),/PV-Preisrisiko/);assert.match(markdown(report,config),/Modell-SOC am Ende/);
});

test('low target preserves a higher existing SOC while grid supplies household consumption',()=>{
  const {config}=demo(),slots=[{start:0,end:STEP,loadKwh:1,pvKwh:0,price:.3}];
  const w={start:0,end:STEP,targetSoc:10},p=simulate(slots,config.battery,70,[w],0,true);
  assert.deepEqual(windowEndSoc(p,w),{soc:70,reached:true});
  assert.equal(p.chargedKwh,0);assert.equal(p.importKwh,1);assert.equal(p.dischargedKwh,0);
});

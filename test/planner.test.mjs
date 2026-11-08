import test from 'node:test';
import assert from 'node:assert/strict';
import { awattar, solcast, resample, plugDefault, fresh } from '../src/inputs.mjs';
import { midnight, nextDate, STEP } from '../src/time.mjs';
import { simulate, makeSlots, recommend, validWindows } from '../src/model.mjs';
import { getJson } from '../src/sources.mjs';
import { demo } from '../examples/demo.mjs';
import { refreshProfiles } from '../src/profiles.mjs';

const b = demo().config.battery;
const slot = (start, loadKwh = 1, pvKwh = 0, price = 0.3) => ({ start, end: start + STEP, date: '2026-11-09', loadKwh, pvKwh, price });
test('market units, negative prices and explicit confirmation', () => {
  const input = { data: [{ start_timestamp: 0, end_timestamp: STEP, marketprice: -50, unit: 'Eur/MWh' }] };
  assert.ok(Math.abs(awattar(input, { confirmed: true, marketMultiplier: 1.2, fixedEurPerKwh: 0.1 })[0].value - 0.04) < 1e-12);
  assert.throws(() => awattar(input, { confirmed: false }), /bestätigt/);
});
test('missing evening prices do not silently become zero', () => {
  assert.throws(() => resample([{ start: 0, end: STEP, value: 0.2 }], 0, STEP * 2, 'Preis'), /Datenlücke/);
  assert.throws(() => resample([{ start: 0, end: STEP, value: 1 }, { start: 0, end: STEP, value: 1 }], 0, STEP, 'PV'), /Überlapp/);
});
test('Solcast period_end is end, kW becomes two equal quarter-hour powers', () => {
  const rows = solcast({ forecasts: [{ period_end: '1970-01-01T00:30:00Z', period: 'PT30M', pv_estimate: 2 }] });
  assert.deepEqual(resample(rows, 0, STEP * 2, 'PV'), [2, 2]);
  assert.throws(() => solcast({ forecasts: [{ period_end: '1970-01-01T00:30Z', period: 'PT30M' }] }), /Ungültiger/);
});
test('Vienna day boundaries respect both DST changes', () => {
  assert.equal((midnight('2026-10-26') - midnight('2026-10-25')) / 3_600_000, 25);
  assert.equal((midnight('2026-03-30') - midnight('2026-03-29')) / 3_600_000, 23);
  assert.equal(nextDate('2026-12-31'), '2027-01-01');
});
test('unknown or contradictory plug states stay unknown', () => {
  assert.equal(plugDefault('unavailable', 'unknown'), null);
  assert.equal(plugDefault('on', 'unplugged'), null);
  assert.equal(plugDefault('on', 'plugged'), true);
  assert.equal(plugDefault('off', 'unplugged'), false);
  assert.throws(() => fresh('2026-01-01T00:00Z', Date.parse('2026-01-03T00:00Z'), 24, 'Zoe'), /veraltet/);
});
test('forced window supplies house from grid after reaching target', () => {
  const p = simulate([slot(0)], b, 50, [{ start: 0, end: STEP, targetSoc: 50 }], 0, true);
  assert.equal(p.importKwh, 1); assert.equal(p.finalSoc, 50); assert.equal(p.dischargedKwh, 0);
  assert.equal(simulate([slot(0)], b, 50).importKwh, 0);
});
test('PV surplus can still fill battery above forced target', () => {
  const p = simulate([slot(0, 0, 1)], b, 50, [{ start: 0, end: STEP, targetSoc: 40 }]);
  assert.ok(p.finalSoc > 50); assert.equal(p.importKwh, 0);
});
test('storage bounds, power limits and energy balance', () => {
  const a = Array.from({ length: 24 }, (_, i) => slot(i * STEP, i < 12 ? 0 : 2, i < 12 ? 3 : 0));
  const p = simulate(a, b, 99, [], 0, true);
  for (const t of p.trace) {
    assert.ok(t.soc >= -1e-8 && t.soc <= 100 + 1e-8);
    assert.ok(t.chargeKwh <= b.chargeKw / 4 + 1e-8);
    assert.ok(Math.abs(t.pvKwh + t.importKwh + t.dischargeKwh - t.loadKwh - t.exportKwh - t.chargeKwh) < 1e-8);
  }
});
test('battery reserve stops discharge and inefficient shifting is not free', () => {
  const p = simulate([slot(0, 2)], { ...b, minSoc: 20 }, 20);
  assert.equal(p.importKwh, 2); assert.equal(p.finalSoc, 20);
});
test('no window crosses midnight, overlaps or exceeds two per day', () => {
  const slots = Array.from({ length: 5 }, (_, i) => slot(i * STEP));
  slots[4].date = '2026-11-10';
  assert.equal(validWindows(slots, [{ start: 0, end: 5 * STEP, targetSoc: 50 }], b), false);
  assert.equal(validWindows(slots, [0,1,2].map(i => ({ start: i * STEP, end: (i+1) * STEP, targetSoc: 50 })), b), false);
  assert.equal(validWindows(slots, [{ start: 0, end: 2 * STEP, targetSoc: 50 }, { start: STEP, end: 3 * STEP, targetSoc: 50 }], b), false);
});
test('no forced charge is a valid result at flat prices', () => {
  const { config } = demo();
  const p = recommend(Array.from({ length: 8 }, (_, i) => slot(i * STEP, 0.2, 0, 0.3)), config, 50);
  assert.deepEqual(p.windows, []);
});
test('cheap slot can fund later expensive consumption', () => {
  const { config } = demo();
  const p = recommend([slot(0, 0, 0, 0.05), ...[1,2,3,4].map(i => slot(i * STEP, 0.3, 0, 0.6))], config, 0);
  assert.ok(p.windows.length > 0); assert.ok(p.savings > 0.3);
  assert.ok(validWindows([slot(0), ...[1,2,3,4].map(i => slot(i * STEP))], p.windows, b));
});
test('Zoe end at 16:05 is represented as five minutes, not fifteen', () => {
  const { config, snapshot } = demo(); const start = Date.parse('2026-11-09T15:00Z');
  const a = makeSlots(config, snapshot, start, start + STEP, [0.2], [0], true);
  assert.ok(Math.abs(a[0].zoeKwh - 1.45 / 12) < 1e-10);
});
test('legionella-day windows exclude the program; overlap fails', () => {
  const { config, snapshot } = demo(); const start = Date.parse('2026-11-08T11:00Z');
  assert.equal(makeSlots(config, snapshot, start, start + STEP, [0.2], [0], true)[0].zoeKwh, 0);
  config.zoe.legionellaWindows = [['08:15','16:05']];
  assert.throws(() => makeSlots(config, snapshot, start, start + STEP, [0.2], [0], true), /Stromkreis/);
});
test('unknown SOC blocks only the Zoe scenario and no lower target is invented', () => {
  const { config, snapshot } = demo(); const start = Date.parse('2026-11-09T08:00Z');
  snapshot.zoeSoc = null;
  assert.throws(() => makeSlots(config, snapshot, start, start + STEP, [0.2], [0], true), /Zoe-SOC/);
  assert.equal(makeSlots(config, snapshot, start, start + STEP, [0.2], [0], false)[0].zoeKwh, 0);
  snapshot.zoeSoc = 100;
  assert.equal(makeSlots(config, snapshot, start, start + STEP, [0.2], [0], true)[0].zoeKwh, 0);
});
test('HTTP errors do not expose API credentials', async () => {
  await assert.rejects(getJson('https://example.com', 'secret', async () => ({ ok: false, status: 401 })), /^Error: Datenabruf fehlgeschlagen \(HTTP 401\)$/);
});
test('rolling profile excludes unapproved, old and future rows, keeps sparse buckets', () => {
  const { config } = demo(); const now = Date.parse('2026-11-09T00:00Z');
  const rows = ['02','03','04'].map(d => ({ start: `2026-11-${d}T09:00Z`, baseKw: 1.2, eligible: true }));
  rows.push({ start: '2026-11-05T09:00Z', baseKw: 9, eligible: false },
    { start: '2026-08-05T09:00Z', baseKw: 9, eligible: true }, { start: '2026-11-10T09:00Z', baseKw: 9, eligible: true });
  const p = refreshProfiles(rows, now, config.profiles);
  assert.ok(Math.abs(p.profiles.weekday[10] - 1.2) < 1e-12);
  assert.equal(p.counts.weekday[10], 3); assert.equal(p.profiles.sunday[10], 0.8);
  assert.throws(() => refreshProfiles([...rows, rows[0]], now, config.profiles), /Doppelter/);
});
test('ambiguous autumn clock hours are not proposed as device timer windows', () => {
  const { config, snapshot } = demo();
  const start = midnight('2026-10-25'), end = midnight('2026-10-26');
  const n = (end - start) / STEP;
  const slots = makeSlots(config, snapshot, start, end, Array(n).fill(0.2), Array(n).fill(0), false);
  assert.equal(slots.filter(s => s.ambiguousClock).length, 8);
  const repeated = slots.find(s => s.ambiguousClock);
  assert.equal(validWindows(slots, [{ start: repeated.start, end: repeated.end, targetSoc: 50 }], b), false);
});

test('fixed export tariff reads modern and legacy Energy preferences without guessing', async () => {
  const { exportTariffFromPreferences: read } = await import('../src/energy.mjs');
  assert.equal(read({energy_sources:[{type:'grid',stat_energy_to:'sensor.export',number_energy_price_export:0.1836}]}).eurPerKwh,0.1836);
  assert.equal(read({energy_sources:[{type:'grid',flow_to:[{stat_energy_to:'sensor.export',number_energy_price:0.18}]}]}).eurPerKwh,0.18);
  assert.throws(()=>read({energy_sources:[]}),/eindeutig/);
  assert.throws(()=>read({energy_sources:[{type:'grid',stat_energy_to:'sensor.export',number_energy_price_export:null}]}),/Ungültiger/);
});
test('laundry adds exactly two cycles and reserves full Zoe timer despite full SOC', () => {
  const {config,snapshot}=demo(); snapshot.zoeSoc=100;
  const start=midnight(snapshot.targetDate), end=midnight(nextDate(snapshot.targetDate));
  const n=(end-start)/STEP;
  const slots=makeSlots(config,snapshot,start,end,Array(n).fill(.3),Array(n).fill(0),true,true);
  const washing=slots.filter(s=>s.laundryKwh>0);
  assert.equal(washing.length,16);
  assert.equal(washing.reduce((sum,s)=>sum+s.laundryKwh,0),2);
  assert.ok(washing.every(s=>!s.applianceBlocked && s.minute>=16*60+15));
  config.laundry.latest='18:00';
  assert.throws(()=>makeSlots(config,snapshot,start,end,Array(n).fill(.3),Array(n).fill(0),true,true),/Kein vollständiges/);
});
test('four report scenarios retain their identity even when Zoe SOC is missing', async () => {
  const {plan}=await import('../src/cli.mjs'); const {html}=await import('../src/report.mjs');
  const {config,snapshot}=demo(); snapshot.zoeSoc=null; snapshot.warnings=['<script>unsafe</script>'];
  const report=plan(config,snapshot,true);
  assert.equal(report.scenarios.length,4);
  assert.deepEqual(report.scenarios.map(s=>[s.withZoe,s.withLaundry]),[[false,false],[false,true],[true,false],[true,true]]);
  assert.ok(report.scenarios[2].error);
  const page=html(report,config);
  assert.ok(page.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(!page.includes('<script>unsafe</script>'));
  assert.ok(page.includes('Netto-Stromsaldo'));
});
test('HA websocket reads preferences after authentication and sanitizes rejection', async () => {
  const {energyPreferences}=await import('../src/energy.mjs');
  class Socket extends EventTarget {
    constructor(){ super(); queueMicrotask(()=>this.emit({type:'auth_required'})); }
    emit(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
    send(raw){const m=JSON.parse(raw); queueMicrotask(()=>this.emit(m.type==='auth'?{type:'auth_ok'}:{type:'result',id:1,success:true,result:{energy_sources:[]}}));}
    close(){}
  }
  assert.deepEqual(await energyPreferences('http://example.com','test-token',Socket),{energy_sources:[]});
  class Denied extends Socket {send(){queueMicrotask(()=>this.emit({type:'auth_invalid',message:'test-token'}));}}
  await assert.rejects(energyPreferences('http://example.com','test-token',Denied),/^Error: HA-Zugang für Energiekonfiguration abgelehnt$/);
});

test('report distinguishes discharge blocking from actual battery charging', async () => {
  const {windowExplanation}=await import('../src/report.mjs');
  const windows=[{start:0,end:STEP,targetSoc:10}];
  const p={...simulate([slot(0)],b,50,windows,0,true),windows};
  assert.match(windowExplanation(p),/Keine Batterieladung/);
  assert.match(windowExplanation(p),/1,00 kWh Netzbezug/);
  const q={...simulate([slot(0)],b,0,windows,0,true),windows};
  assert.match(windowExplanation(q),/Batterieladung.*AC-seitig/);
});

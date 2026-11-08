import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { localParts, nextDate } from './time.mjs';

export async function json(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && arguments.length > 1) return fallback; throw e; }
}
const pendingWrites = new Map();
export async function atomicJson(file, value) {
  const text=JSON.stringify(value,null,2);
  const current=(pendingWrites.get(file)??Promise.resolve()).catch(()=>{}).then(async()=>{
    await writeFile(`${file}.tmp`,text,{flush:true});
    await rename(`${file}.tmp`,file);
  });
  pendingWrites.set(file,current);
  try { await current; } finally { if(pendingWrites.get(file)===current)pendingWrites.delete(file); }
}
export function csv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const cell = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [keys.map(cell).join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\n');
}
export async function archiveRun(directory, snapshot, config, report, render, version) {
  const id = snapshot.generatedAt.replace(/[:.]/g, '-');
  const folder = join(directory, 'runs', id);
  await mkdir(folder, { recursive: false });
  await atomicJson(join(folder, 'input.json'), snapshot);
  await atomicJson(join(folder, 'config.json'), { ...config, exportEurPerKwh: report.exportTariff.eurPerKwh });
  await atomicJson(join(folder, 'plan.json'), report);
  await writeFile(join(folder, 'report.html'), render.html(report, config));
  await writeFile(join(folder, 'report.md'), render.markdown(report, config));
  await writeFile(join(folder, 'forecast.csv'), csv(report.scenarios.flatMap((s, scenario) => (s.plan?.trace ?? []).map(t => ({
    scenario, withZoe: s.withZoe, withLaundry: s.withLaundry, start: new Date(t.start).toISOString(), end: new Date(t.end).toISOString(),
    baseKwh: t.baseKwh, zoeKwh: t.zoeKwh, laundryKwh: t.laundryKwh, legionellaKwh: t.legionellaKwh,
    loadKwh: t.loadKwh, pvKwh: t.pvKwh, priceEurPerKwh: t.price, importKwh: t.importKwh, exportKwh: t.exportKwh,
    chargeKwh: t.chargeKwh, dischargeKwh: t.dischargeKwh, soc: t.soc, forced: t.forced, targetSoc: t.targetSoc
  })))));
  // Commit marker last: incomplete runs are retained but never published as valid.
  await atomicJson(join(folder, 'manifest.json'), { schemaVersion: 1, version, id, generatedAt: snapshot.generatedAt,
    start: report.start, end: report.end, targetDate: snapshot.targetDate, scenarioErrors: report.scenarios.filter(s => s.error).map(s => s.error) });
  return id;
}
export async function mergeStatistics(directory, statistics, zone) {
  const days = new Map();
  for (const [entity, rows] of Object.entries(statistics)) for (const row of rows) {
    const date = localParts(row.start, zone).date;
    if (!days.has(date)) days.set(date, {});
    (days.get(date)[entity] ??= []).push(row);
  }
  for (const [date, additions] of days) {
    const file = join(directory, 'actual', `${date}-statistics.json`);
    const previous = await json(file, {});
    for (const [entity, rows] of Object.entries(additions)) {
      const merged = new Map((previous[entity] ?? []).map(r => [r.start, r]));
      for (const row of rows) merged.set(row.start, row);
      previous[entity] = [...merged.values()].sort((a, b) => a.start - b.start);
    }
    await atomicJson(file, previous);
  }
}
function observed(rows, start, end, mode) {
  const selected = rows.filter(r => r.start >= start && r.end <= end).sort((a,b) => a.start-b.start);
  let cursor = start, value = 0;
  for (const r of selected) {
    if (r.start !== cursor || !Number.isFinite(r.mean) || r.end <= r.start) return null;
    value += r.mean * (r.end - r.start); cursor = r.end;
  }
  if (cursor !== end) return null;
  return mode === 'energy' ? value / 3_600_000 / 1000 : value / (end-start);
}
export function validationHtml(result) {
  const n=v=>v===null?'fehlend':v.toLocaleString('de-AT',{maximumFractionDigits:3});
  const pv=result.pvSources;
  const comparison=pv?`<section><h2>PV-Tagesprognosen: ${pv.date}</h2><p>Gemessener Tagesertrag: ${n(pv.actualKwh)} kWh. Eine Tagesabweichung wird nur bei vollständiger Messreihe berechnet.</p><table><tr><th>Quelle</th><th>Prognose</th><th>Ist minus Prognose</th></tr>${pv.sources.map(s=>`<tr><td>${s.name}</td><td>${n(s.kwh)} kWh</td><td>${n(s.errorKwh)} kWh</td></tr>`).join('')}</table></section>`:'';
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Prognoseprüfung</title><style>body{font:16px/1.5 system-ui;max-width:1100px;margin:30px auto;padding:20px;background:#f2f5f0;color:#173a37}section{background:white;padding:24px;margin:20px 0;border-radius:14px}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:right}th:first-child,td:first-child{text-align:left}table{width:100%;border-collapse:collapse}</style><h1>Prognose und Ist</h1>${comparison}<p>${result.warning}</p><p>Fehler = Ist minus Prognose. Vergleichssummen verwenden ausschließlich vollständig abgedeckte Viertelstunden. Fehlende Werte werden nicht als Null gerechnet.</p>${result.scenarios.map(s=>`<section><h2>${s.name.replaceAll('&','&amp;').replaceAll('<','&lt;')}</h2><table><tr><th>Messgröße</th><th>Abdeckung</th><th>Prognose</th><th>Ist</th><th>Fehler</th><th>Mittlerer absoluter Fehler je 15 min</th></tr>${[['Hausverbrauch',s.load],['PV',s.pv]].map(([name,m])=>`<tr><td>${name}</td><td>${m.coveredSlots}/${m.expectedSlots}</td><td>${n(m.forecastKwhOnCoveredSlots)} kWh</td><td>${n(m.actualKwhOnCoveredSlots)} kWh</td><td>${n(m.actualKwhOnCoveredSlots-m.forecastKwhOnCoveredSlots)} kWh</td><td>${n(m.maeKwhPerSlot)} kWh</td></tr>`).join('')}</table></section>`).join('')}<p>Viertelstundenwerte, SOC, Energiefluss-Bilanzrest und gemessener Stromsaldo stehen in der zugehörigen CSV-/JSON-Datei. Der Bilanzrest kann Umwandlungsverluste und versetzte Messzeitpunkte enthalten. Gemessener Stromsaldo ist Bezug minus Einspeiseerlös ohne Batterieverschleiß; keine nachgewiesene Optimierungsersparnis.</p></html>`;
}
export function validateForecast(report, statistics, entities) {
  const comparison=report.pvComparison;
  const actual=comparison?observed(statistics[entities.pvPower]??[],comparison.start,comparison.end,'energy'):null;
  return { schemaVersion: 1, pvSources:comparison?{...comparison,actualKwh:actual,sources:comparison.sources.map(s=>({...s,errorKwh:actual===null||s.kwh===null?null:actual-s.kwh}))}:null, errorSign: 'Ist minus Prognose',
    warning: 'Szenarienvergleich, kein Nachweis erzielter Einsparungen. Tatsächliche Verbraucherwahl und Wechselrichterfenster können abweichen. SOC-Ist ist der Intervallmittelwert; Prognose-SOC ist der Endwert.',
    scenarios: report.scenarios.filter(s => s.plan).map(s => {
      const rows = s.plan.trace.map(t => {
        const load = observed(statistics[entities.loadPower] ?? [], t.start, t.end, 'energy');
        const pv = observed(statistics[entities.pvPower] ?? [], t.start, t.end, 'energy');
        const soc = observed(statistics[entities.batterySoc] ?? [], t.start, t.end, 'mean');
        const imported = observed(statistics[entities.importPower] ?? [], t.start,t.end,'energy');
        const exported = observed(statistics[entities.exportPower] ?? [], t.start,t.end,'energy');
        const charged = observed(statistics[entities.chargePower] ?? [], t.start,t.end,'energy');
        const discharged = observed(statistics[entities.dischargePower] ?? [], t.start,t.end,'energy');
        return { start: new Date(t.start).toISOString(), loadForecastKwh: t.loadKwh, loadActualKwh: load,
          loadErrorKwh: load === null ? null : load-t.loadKwh, pvForecastKwh: t.pvKwh, pvActualKwh: pv,
          pvErrorKwh: pv === null ? null : pv-t.pvKwh, socForecast: t.soc, socActualMean: soc,
          importActualKwh:imported, exportActualKwh:exported, chargeActualKwh:charged, dischargeActualKwh:discharged,
          measuredNetCostEur: imported===null||exported===null?null:imported*t.price-exported*report.exportTariff.eurPerKwh,
          // PV may be DC-side; this residual includes conversion losses and sensor timing offsets.
          balanceResidualKwh:[load,pv,imported,exported,charged,discharged].some(v=>v===null)?null:pv+imported+discharged-load-exported-charged };
      });
      const metrics = key => {
        const good = rows.filter(r => r[`${key}ActualKwh`] !== null);
        return { coveredSlots: good.length, expectedSlots: rows.length, coverage: good.length / rows.length,
          actualKwhOnCoveredSlots: good.reduce((n,r)=>n+r[`${key}ActualKwh`],0),
          forecastKwhOnCoveredSlots: good.reduce((n,r)=>n+r[`${key}ForecastKwh`],0),
          maeKwhPerSlot: good.length ? good.reduce((n,r)=>n+Math.abs(r[`${key}ErrorKwh`]),0)/good.length : null };
      };
      return { name: s.name, withZoe: s.withZoe, withLaundry: s.withLaundry, load: metrics('load'), pv: metrics('pv'), rows };
    }) };
}
export async function validateArchive(directory, entities, now = Date.now()) {
  for (const id of await readdir(join(directory, 'runs'))) {
    const folder = join(directory, 'runs', id), manifest = await json(join(folder, 'manifest.json'), null);
    if (!manifest || manifest.end > now - 2*3_600_000) continue;
    const previous = await json(join(folder, 'validation.json'), null);
    if (previous?.complete || previous?.finalized) continue;
    const config=await json(join(folder,'config.json'));
    const all={};
    for(let date=localParts(manifest.start,config.timeZone).date;date<=localParts(manifest.end-1,config.timeZone).date;date=nextDate(date)) {
      const data=await json(join(directory,'actual',`${date}-statistics.json`),{});
      for(const[entity,rows]of Object.entries(data))(all[entity]??=[]).push(...rows);
    }
    const result = validateForecast(await json(join(folder, 'plan.json')), all, entities);
    result.checkedAt = new Date(now).toISOString();
    result.complete = result.scenarios.length > 0 && result.scenarios.every(s => s.load.coverage === 1 && s.pv.coverage === 1);
    result.finalized = result.complete || now-manifest.end>7*86400_000;
    await atomicJson(join(folder, 'validation.json'), result);
    await writeFile(join(folder, 'validation.html'), validationHtml(result));
    await writeFile(join(folder, 'validation.csv'), csv(result.scenarios.flatMap((s, scenario) => s.rows.map(r => ({ scenario, ...r })))));
  }
}

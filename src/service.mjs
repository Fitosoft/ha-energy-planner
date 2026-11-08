import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { collect } from './sources.mjs';
import { plan } from './cli.mjs';
import * as render from './report.mjs';
import { haRequest, websocketRequest } from './ha.mjs';
import { archiveRun, atomicJson, json, mergeStatistics, validateArchive } from './archive.mjs';
import { learnProfiles } from './learning.mjs';
import { localParts, midnight, label } from './time.mjs';

export const VERSION = '0.2.1';
export const DEFAULT_NOTIFICATIONS = {
  mobile: 'mobile_app_toms_iphone',
  alexa: ['notify.echo_badezimmer_durchsagen','notify.thomas_echo_show_8_durchsagen','notify.echo_schlafzimmer_durchsagen',
    'notify.echo_wohnzimmer_durchsagen','notify.echo_arbeitszimmer_durchsagen','notify.echo_show_eingang_durchsagen']
};
export const ACTUAL_ENTITIES = {
  loadPower: 'sensor.sungrow_load_power', pvPower: 'sensor.sungrow_pv_power', batterySoc: 'sensor.sungrow_battery_level',
  batteryPower: 'sensor.sungrow_battery_power', meterPower: 'sensor.sungrow_meter_active_power',
  importPower: 'sensor.sungrow_grid_import_power', exportPower: 'sensor.sungrow_grid_export_power',
  chargePower: 'sensor.sungrow_battery_charge_power', dischargePower: 'sensor.sungrow_battery_discharge_power',
  pvEnergy: 'sensor.sungrow_pv_energy', importEnergy: 'sensor.sungrow_grid_import_energy', exportEnergy: 'sensor.sungrow_grid_export_energy',
  chargeEnergy: 'sensor.sungrow_battery_charge_energy', dischargeEnergy: 'sensor.sungrow_battery_discharge_energy',
  zoeSoc: 'sensor.zoe_batterie'
};
export function scheduleDue(now, state, zone) {
  const p = localParts(now, zone);
  return p.minute >= 20*60 && state.attemptDate !== p.date;
}
export async function sendNotifications(notifications, message, url, send = haRequest) {
  const tasks = [
    ['mobile', `services/notify/${notifications.mobile}`, { title: 'PV- und Ladeplanung', message,
      data: { url, push: { sound: 'default' } } }],
    ['alexa', 'services/notify/send_message', { message, entity_id: notifications.alexa }]
  ];
  const result = {};
  for (const [channel, path, body] of tasks) {
    try { await send(path, body); result[channel] = 'sent'; }
    catch { result[channel] = 'failed'; }
  }
  return result;
}
export function announcement(report) {
  const partial = report.scenarios.some(s => s.error);
  const selected = report.scenarios.find(s => s.withZoe === report.defaultZoe && !s.withLaundry)?.plan;
  return `Die PV- und Ladeplanung für morgen ist ${partial ? 'mit Einschränkungen ' : ''}fertig. ${selected && !selected.windows.length ? 'In der vorgewählten Variante ist keine Zwangsladung vorgesehen. ' : ''}Bitte prüfe die vier Varianten und die Batteriefenster im Energieplaner in Home Assistant. Geräte wurden nicht umgestellt.`;
}
const escape = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeError(error) {
  let message=String(error.message??'Unbekannter Fehler').replace(/https?:\/\/\S+/g,'[Adresse]');
  for(const secret of [process.env.HA_TOKEN,process.env.SUPERVISOR_TOKEN,process.env.SOLCAST_API_KEY,process.env.SOLCAST_RESOURCE_ID])if(secret)message=message.replaceAll(secret,'[privat]');
  return message.slice(0,400);
}

export async function startService(directory = '/data', { port = 8099, host = '0.0.0.0', ingressOnly = true, timers = true } = {}) {
  for (const sub of ['runs','actual','cache','failures','profiles']) await mkdir(join(directory, sub), { recursive: true });
  let options = await json(join(directory,'options.json'), {});
  let privateSettings = await json(join(directory,'private.json'), {});
  let state = await json(join(directory,'state.json'), {});
  let busy = false, ticking = false;
  const csrf = randomBytes(24).toString('hex');
  if (process.env.SUPERVISOR_TOKEN) {
    process.env.HA_URL = 'http://supervisor/core'; process.env.HA_TOKEN = process.env.SUPERVISOR_TOKEN;
  }
  async function settings() {
    const input = privateSettings.planner_json ?? options.planner_json;
    if (!input) throw Error('Persönliche Planerkonfiguration fehlt. Bitte zuerst einrichten.');
    const config = typeof input === 'string' ? JSON.parse(input) : input;
    const learned=await json(join(directory,'profiles-current.json'),null);
    if(learned){config.profiles=learned.profiles;config.assumptions=[...(config.assumptions??[]),`Verbrauchsprofil automatisch nachgezogen: ${learned.generatedAt}. ${learned.warnings.length} dünn belegte Stunden/Gruppen behalten ihren bisherigen Wert.`];}
    config.cacheDirectory = join(directory,'cache');
    process.env.SOLCAST_API_KEY = privateSettings.solcast_api_key || options.solcast_api_key || process.env.SOLCAST_API_KEY;
    process.env.SOLCAST_RESOURCE_ID = privateSettings.solcast_resource_id || options.solcast_resource_id || process.env.SOLCAST_RESOURCE_ID;
    return config;
  }
  async function persist() { await atomicJson(join(directory,'state.json'),state); }
  const notifyConfig = () => ({ mobile: options.mobile_service ?? DEFAULT_NOTIFICATIONS.mobile, alexa: options.alexa_entities ?? DEFAULT_NOTIFICATIONS.alexa });
  async function reportUrl() {
    if (options.report_url) return options.report_url;
    if (process.env.SUPERVISOR_TOKEN) {
      try {
        const r = await fetch('http://supervisor/addons/self/info', { headers:{Authorization:`Bearer ${process.env.SUPERVISOR_TOKEN}`}, signal:AbortSignal.timeout(10_000) });
        if (r.ok) { const d=await r.json(); if(d.data?.slug) return `/${d.data.slug}`; }
      } catch { /* Sidebar remains available even without a notification deep link. */ }
    }
    return '/config/apps/dashboard';
  }
  async function run(manual = false) {
    if (busy) throw Error('Eine Berechnung läuft bereits.');
    busy = true;
    const at = new Date().toISOString();
    let config, snapshot, stage='configuration';
    try {
      config = await settings();
      state.attemptDate = localParts(Date.now(),config.timeZone).date; state.lastAttempt = at; state.status = 'running'; await persist();
      stage='inputs'; snapshot = await collect(config);
      stage='planning'; const report = plan(config,snapshot);
      if (!report.scenarios.some(s=>s.plan)) throw Error('Keine der vier Varianten konnte berechnet werden.');
      stage='archive'; const id = await archiveRun(directory,snapshot,config,report,render,VERSION);
      state.latest = id; state.status = report.scenarios.some(s=>s.error) ? 'partial' : 'success'; state.lastSuccess = at;
      state.notification = { attemptedAt:new Date().toISOString(), status:'attempting' }; await persist();
      const delivery=await sendNotifications(notifyConfig(),announcement(report),await reportUrl());
      state.notification = { ...state.notification, status:Object.values(delivery).every(s=>s==='sent')?'sent':'partial', ...delivery }; await persist();
      return id;
    } catch (e) {
      // Strip credentials and network URLs before retaining diagnostics.
      state.status = 'failed'; state.lastFailure = at; state.failureStage=stage;
      state.failureReason=safeError(e);
      await atomicJson(join(directory,'failures',`${at.replace(/[:.]/g,'-')}.json`), { at, manual, stage, config, snapshot, error:state.failureReason, version:VERSION });
      await persist();
      state.failureNotification = await sendNotifications(notifyConfig(),'Die Energieplanung konnte heute keinen neuen gültigen Plan erstellen. Bitte prüfe den Status im Energieplaner. Ein älterer Bericht ist keine neue Empfehlung.',await reportUrl()); await persist();
      throw Error('Planung fehlgeschlagen. Konfiguration, Zugänge und Datenabdeckung prüfen.');
    } finally { busy = false; }
  }
  async function capture(config, now) {
    const ids = new Set([...Object.values(ACTUAL_ENTITIES), ...Object.values(config.entities).filter(Boolean),
      'binary_sensor.zoe_ladestatus','sensor.zoe_ladezustand','device_tracker.zoe_standort']);
    const states = (await haRequest('states')).filter(s=>ids.has(s.entity_id)).map(s=>({ entity_id:s.entity_id,state:s.state,last_updated:s.last_updated,last_changed:s.last_changed,
      unit:s.attributes.unit_of_measurement, attributes:s.entity_id===config.entities.forecastSolar?s.attributes:undefined }));
    await appendFile(join(directory,'actual',`${localParts(now,config.timeZone).date}-samples.jsonl`),JSON.stringify({at:new Date(now).toISOString(),states})+'\n');
  }
  async function statistics(config, now) {
    const end = Math.floor((now-15*60_000)/300_000)*300_000;
    let start = state.actualUntil ? Math.max(state.actualUntil-3_600_000,end-7*86400_000) : midnight(localParts(now-86400_000,config.timeZone).date,config.timeZone);
    for (; start < end; start += 86400_000) {
      const to = Math.min(end,start+86400_000);
      const data = await websocketRequest(process.env.HA_URL,process.env.HA_TOKEN,{type:'recorder/statistics_during_period',
        start_time:new Date(start).toISOString(),end_time:new Date(to).toISOString(),period:'5minute',
        statistic_ids:Object.values(ACTUAL_ENTITIES),types:['mean','min','max','state','sum'],units:{power:'W',energy:'kWh'}});
      await mergeStatistics(directory,data,config.timeZone);
      state.actualUntil=to; await persist();
    }
    // Preserve exact on/off/plug transitions before HA purges detailed history.
    const date=localParts(now-86400_000,config.timeZone).date;
    const historyFile=join(directory,'actual',`${date}-zoe-history.json`);
    if (!await json(historyFile,null)) {
      const from=midnight(date,config.timeZone), to=midnight(localParts(now,config.timeZone).date,config.timeZone);
      const ids=['binary_sensor.zoe_ladestatus',config.entities.zoeSoc,config.entities.zoeActivity,config.entities.zoePlug,config.entities.zoePlugText,'sensor.zoe_ladezustand','device_tracker.zoe_standort'];
      const history=await haRequest(`history/period/${new Date(from).toISOString()}?end_time=${encodeURIComponent(new Date(to).toISOString())}&filter_entity_id=${encodeURIComponent(ids.join(','))}&no_attributes`);
      await atomicJson(historyFile,{from,to,entities:ids,history});
    }
    await validateArchive(directory,ACTUAL_ENTITIES,now);
    const local=localParts(now,config.timeZone);
    if(new Date(`${local.date}T12:00Z`).getUTCDay()===1&&local.minute>=120&&state.profileDate!==local.date){
      await learnProfiles(directory,config,ACTUAL_ENTITIES.loadPower,now);state.profileDate=local.date;await persist();
    }
  }
  async function tick(now=Date.now()) {
    if (ticking) return;
    ticking=true;
    try {
      const config=await settings();
      try { await capture(config,now); state.captureStatus='ok'; } catch { state.captureStatus='failed'; }
      if (Math.floor(now/3_600_000)!==state.statisticsHour) {
        try { await statistics(config,now); state.statisticsHour=Math.floor(now/3_600_000); state.statisticsStatus='ok'; }
        catch { state.statisticsStatus='failed'; }
      }
      await persist();
      if (scheduleDue(now,state,config.timeZone)) await run();
    } catch { /* Detailed status is visible without logging credentials. */ }
    finally { ticking=false; }
  }
  const files = new Set(['report.html','report.md','plan.json','input.json','config.json','forecast.csv','validation.json','validation.csv','validation.html','manifest.json']);
  async function handler(req,res) {
    if(req.method==='GET'&&req.url==='/health'){res.writeHead(200);res.end('ok');return;}
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    if (ingressOnly && !['172.30.32.2','::ffff:172.30.32.2'].includes(req.socket.remoteAddress)) { res.writeHead(403);res.end('Nur HA Ingress');return; }
    try {
      const path=new URL(req.url,'http://localhost').pathname.replace(/^\//,'');
      if (req.method==='POST') {
        let body='';for await(const chunk of req){body+=chunk;if(body.length>100_000)throw Error('Eingabe zu groß');}
        if(req.headers['x-planner-csrf']!==csrf)throw Error('Ungültige Formularsitzung');
        if(path==='settings') {
          const input=JSON.parse(body);const config=typeof input.planner_json==='string'?JSON.parse(input.planner_json):input.planner_json;
          if(config?.timeZone!=='Europe/Vienna'||!config?.profiles?.weekday||!config?.battery||!config?.entities)throw Error('Planerkonfiguration unvollständig');
          if(!input.solcast_api_key||!input.solcast_resource_id)throw Error('Solcast-Zugang fehlt');
          privateSettings={planner_json:config,solcast_api_key:input.solcast_api_key,solcast_resource_id:input.solcast_resource_id};
          await atomicJson(join(directory,'private.json'),privateSettings);
        } else if(path==='run') { if(busy)throw Error('Berechnung läuft'); run(true).catch(()=>{}); }
        else throw Error('Unbekannte Aktion');
        res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;
      }
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      const match=path.match(/^runs\/([\dTZ-]+)\/([a-z.]+)$/);
      if(match&&files.has(match[2])) {
        const data=await readFile(join(directory,'runs',match[1],match[2]));
        res.setHeader('Content-Type',match[2].endsWith('.html')?'text/html; charset=utf-8':match[2].endsWith('.json')?'application/json':'text/plain; charset=utf-8');res.end(data);return;
      }
      const actual=path.match(/^actual\/([\d-]+-(?:statistics\.json|samples\.jsonl|zoe-history\.json))$/);
      if(actual){res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(await readFile(join(directory,'actual',actual[1])));return;}
      if(path!==''){res.writeHead(404);res.end('Nicht gefunden');return;}
      const runs=[];
      for(const id of (await readdir(join(directory,'runs'))).sort().reverse()){
        const m=await json(join(directory,'runs',id,'manifest.json'),null);if(m){m.validation=await json(join(directory,'runs',id,'validation.json'),null);runs.push(m);}
      }
      const actualFiles=(await readdir(join(directory,'actual'))).sort().reverse();
      const configured=!!(privateSettings.planner_json||options.planner_json);
      const dateLabel=value=>value?label(Date.parse(value),'Europe/Vienna'):'noch keiner';
      const statusLabel={success:'Berechnung erfolgreich',partial:'Bericht mit Einschränkungen',failed:'Berechnung fehlgeschlagen',running:'Berechnung läuft'}[state.status]??(configured?'Bereit':'Einrichtung erforderlich');
      const deliveryLabel=channel=>({sent:'gesendet',failed:'fehlgeschlagen'}[state.notification?.[channel]]??'noch nicht gesendet');
      const script=`const token=${JSON.stringify(csrf)};async function send(path,body){const r=await fetch(path,{method:'POST',headers:{'X-Planner-CSRF':token},body:JSON.stringify(body)});if(!r.ok){alert(await r.text());return;}location.reload();}document.querySelector('#run').onclick=()=>send('run',{});document.querySelector('#setup').onchange=async e=>{try{await send('settings',JSON.parse(await e.target.files[0].text()));}catch{alert('Ungültige Einstellungsdatei');}};`;
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Energieplaner</title><style>body{font:16px/1.5 system-ui;background:#f2f5f0;color:#173a37;max-width:1100px;margin:35px auto;padding:20px}section{background:white;padding:24px;border-radius:14px;margin:20px 0}a{color:#176d68}button{padding:12px;cursor:pointer}small{color:#576b66}li{margin:12px 0}table{border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}</style><h1>PV- und Ladeplanung</h1><p>Version ${VERSION} · täglich 20:00 Europe/Vienna · Empfehlungsbetrieb</p>
      <section><h2>Status: ${statusLabel}</h2><p>Letzter Versuch: ${dateLabel(state.lastAttempt)}<br>Letzter gültiger Plan: ${dateLabel(state.lastSuccess)}<br>Ist-Aufzeichnung: ${escape(state.captureStatus??'wartet')} · Statistik/Validierung: ${escape(state.statisticsStatus??'wartet')}<br>Handy: ${deliveryLabel('mobile')} · Alexa: ${deliveryLabel('alexa')}${state.status==='failed'?`<br>Hinweis: ${escape(state.failureReason??'Eingaben und Datenabdeckung prüfen.')}`:''}<br>Letzte Profilaktualisierung: ${escape(state.profileDate??'noch keine')}</p><p>Ein alter Bericht bleibt im Archiv. Maßgeblich sind sein Erstellungsdatum und Planungshorizont.</p><button id="run" ${busy||!configured?'disabled':''}>Jetzt berechnen und benachrichtigen</button>${state.latest?` <a href="runs/${state.latest}/report.html">Letzten Bericht öffnen</a>`:''}</section>
      <section><h2>Einrichtung</h2><p>${configured?'Persönliche Konfiguration vorhanden. Import ersetzt sie.':'Bitte die vorbereitete private ha-options.json importieren. Sie enthält deine Profile und Solcast-Zugänge.'} Diese Datei bleibt lokal und gehört nicht auf GitHub.</p><input id="setup" type="file" accept="application/json"><p><small>Benachrichtigung an ${escape(notifyConfig().mobile)} und ${notifyConfig().alexa.length} Alexa-Geräte. Keine Schaltbefehle an Batterie, Zoe oder Wärmepumpe.</small></p></section>
      <section><h2>Prognosearchiv</h2><table><tr><th>Erstellt (Ortszeit)</th><th>Berichte und vollständige Rechnung</th><th>Nachprüfung</th></tr>${runs.map(m=>`<tr><td>${dateLabel(m.generatedAt)}</td><td><a href="runs/${m.id}/report.html">HTML</a> · <a href="runs/${m.id}/forecast.csv">Viertelstunden CSV</a> · <a href="runs/${m.id}/input.json">Rohprognosen</a> · <a href="runs/${m.id}/config.json">Parameter</a> · <a href="runs/${m.id}/plan.json">JSON</a></td><td>${m.validation?`<a href="runs/${m.id}/validation.html">Prüfbericht</a> · <a href="runs/${m.id}/validation.json">JSON</a> · <a href="runs/${m.id}/validation.csv">CSV</a><br><small>${m.validation.complete?'vollständig':'enthält Datenlücken'}</small>`:`Prüfung ab ${label(m.end+7200000,'Europe/Vienna')}`}</td></tr>`).join('')}</table></section>
      <section><h2>Ist-Daten</h2><p>Minütliche Zustandsaufnahmen, fünfminütige Recorder-Statistiken und tägliche Zoe-Verläufe. Fehlende Daten werden nicht als Null interpretiert. Das Archiv wird nicht automatisch gelöscht und liegt im gesicherten App-Datenverzeichnis.</p><ul>${actualFiles.map(f=>`<li><a href="actual/${f}">${f}</a></li>`).join('')}</ul></section><script>${script}</script></html>`);
    } catch(e) {res.writeHead(e.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Nicht verfügbar oder ungültige Anfrage.');}
  }
  const server=createServer((req,res)=>handler(req,res).catch(()=>{res.writeHead(500);res.end('Interner Fehler');}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const timer=timers?setInterval(()=>tick(),60_000):null;
  if(timers)tick();
  return {server,tick,run,close:async()=>{clearInterval(timer);await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  startService(process.env.PLANNER_DATA??'/data').then(()=>console.log(`Energieplaner ${VERSION} bereit`)).catch(()=>{console.error('Energieplaner konnte nicht starten. Datenverzeichnis prüfen.');process.exitCode=1;});
}

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { localParts, midnight, nextDate, clockMinutes, label } from './time.mjs';

export const scenarioId = s => `z${Number(s.withZoe)}-w${Number(s.withLaundry)}`;
export function suggestedScenario(report) {
  if (typeof report.defaultZoe !== 'boolean') return null;
  const s=report.scenarios.find(s=>s.withZoe===report.defaultZoe&&!s.withLaundry&&s.plan);
  return s ? s.id??scenarioId(s) : null;
}
async function readJson(file) { return JSON.parse(await readFile(file,'utf8')); }
export async function decisionContext(folder, report) {
  let names;
  try { names=await readdir(join(folder,'decisions')); } catch(e) { if(e.code!=='ENOENT')throw e; names=[]; }
  const history=[];
  for(const name of names.sort()) if(/^\d{6}-[a-f0-9-]+\.json$/.test(name)) history.push(await readJson(join(folder,'decisions',name)));
  return { suggestedScenarioId:suggestedScenario(report), revision:history.length,
    planned:history.filter(e=>e.kind==='planned').at(-1)??null,
    implemented:history.filter(e=>e.kind==='implemented').at(-1)??null, history };
}
export function localTime(value, zone) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Datum und Uhrzeit erforderlich');
  const [date,clock]=value.split('T'),minute=clockMinutes(clock),matches=[];
  const start=midnight(date,zone),end=midnight(nextDate(date),zone);
  for(let t=start;t<end;t+=60_000)if(localParts(t,zone).minute===minute)matches.push(t);
  if(matches.length!==1)throw Error('Uhrzeit existiert nicht oder ist wegen Zeitumstellung doppeldeutig');
  return matches[0];
}
const writes=new Map();
export async function recordDecision(folder, manifest, report, config, input, now=Date.now()) {
  const previous=writes.get(folder)??Promise.resolve();
  const current=previous.catch(()=>{}).then(async()=>{
    const context=await decisionContext(folder,report);
    if(input.expectedRevision!==context.revision)throw Error('Die Auswahl wurde inzwischen geändert. Bitte Seite neu laden.');
    if(!['planned','implemented'].includes(input.kind))throw Error('Ungültige Bestätigung');
    const scenario=report.scenarios.find(s=>(s.id??scenarioId(s))===input.scenarioId&&s.plan);
    if(!scenario)throw Error('Diese Variante ist nicht berechenbar');
    let windows;
    if(input.kind==='implemented') {
      if(input.confirmImplemented!==true)throw Error('Manuelle Umsetzung ausdrücklich bestätigen');
      if(!context.planned||context.planned.scenarioId!==input.scenarioId)throw Error('Diese Variante zuerst als geplant bestätigen');
      if(!Array.isArray(input.windows)||input.windows.length>4)throw Error('Ungültige Fensterliste');
      windows=input.windows.map(w=>({start:localTime(w.start,config.timeZone),end:localTime(w.end,config.timeZone),targetSoc:w.targetSoc})).sort((a,b)=>a.start-b.start);
      const counts=new Map();
      for(let i=0;i<windows.length;i++){
        const w=windows[i],a=localParts(w.start,config.timeZone),b=localParts(w.end-1,config.timeZone);
        if(w.start<manifest.start||w.end>manifest.end||w.start>=w.end||a.date!==b.date||(i&&windows[i-1].end>w.start))throw Error('Fenster müssen im Planungshorizont liegen und dürfen sich nicht überschneiden oder Mitternacht überqueren');
        if(w.start%900000||w.end%900000||typeof w.targetSoc!=='number'||!Number.isFinite(w.targetSoc)||w.targetSoc<config.battery.minSoc||w.targetSoc>config.battery.maxSoc)throw Error('Viertelstunden und gültigen Ziel-SOC verwenden');
        counts.set(a.date,(counts.get(a.date)??0)+1);if(counts.get(a.date)>2)throw Error('Höchstens zwei Fenster je Tag');
      }
    }
    const event={schemaVersion:1,id:randomUUID(),sequence:context.revision+1,runId:manifest.id,
      horizon:{start:manifest.start,end:manifest.end},at:new Date(now).toISOString(),recordedAfterHorizon:now>manifest.end,kind:input.kind,scenarioId:input.scenarioId,
      ...(windows?{windows,plannedEventId:context.planned.id,evidence:'user_declaration_not_device_verified'}:{})};
    await mkdir(join(folder,'decisions'),{recursive:true});
    await writeFile(join(folder,'decisions',`${String(event.sequence).padStart(6,'0')}-${event.id}.json`),JSON.stringify(event,null,2),{flag:'wx',flush:true});
    return event;
  });
  writes.set(folder,current);
  try{return await current;}finally{if(writes.get(folder)===current)writes.delete(folder);}
}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localInput=(time,zone)=>{const p=localParts(time,zone);return `${p.date}T${String(Math.floor(p.minute/60)).padStart(2,'0')}:${String(p.minute%60).padStart(2,'0')}`;};
export function decisionPage(manifest, report, config, context, csrf) {
  const variants=report.scenarios.filter(s=>s.plan).map(s=>({id:s.id??scenarioId(s),name:s.name,windows:s.plan.windows.map(w=>({start:localInput(w.start,config.timeZone),end:localInput(w.end,config.timeZone),targetSoc:w.targetSoc}))}));
  const chosen=context.planned?.scenarioId??context.suggestedScenarioId??variants[0]?.id;
  const name=id=>variants.find(s=>s.id===id)?.name??'keine';
  const windowsText=windows=>(windows??[]).map(w=>`${label(w.start,config.timeZone)} – ${label(w.end,config.timeZone)}, Ziel ${w.targetSoc} %`).join('; ')||'Keine Zwangsladefenster';
  const existing=context.implemented?.scenarioId===chosen?context.implemented.windows.map(w=>({start:localInput(w.start,config.timeZone),end:localInput(w.end,config.timeZone),targetSoc:w.targetSoc})):null;
  const jsonSafe=v=>JSON.stringify(v).replaceAll('<','\\u003c');
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Variante und Umsetzung</title><style>body{font:16px/1.5 system-ui;background:#f2f5f0;color:#173a37;max-width:1100px;margin:30px auto;padding:20px}section{background:white;border-radius:14px;padding:24px;margin:20px 0}button,input,select{padding:10px;margin:5px;max-width:100%}table{width:100%}td{border-bottom:1px solid #ddd;padding:10px}small{display:block}a{color:#176d68}.window{display:flex;flex-wrap:wrap;align-items:center}</style><h1>Variante und manuelle Umsetzung</h1><p>Lauf <b>${esc(manifest.id)}</b><br>Erstellt ${label(Date.parse(manifest.generatedAt),config.timeZone)} · Horizont ${label(manifest.start,config.timeZone)} bis ${label(manifest.end,config.timeZone)}</p><p><a href="report.html">Bericht dieses Laufs</a> · <a href="../../">Zur Übersicht</a> · <a href="decisions.json">Vollständige Bestätigungshistorie</a></p>
  <section><h2>Drei getrennte Angaben</h2><p>Automatisch vorgeschlagen: <b>${esc(name(context.suggestedScenarioId))}</b><br>Als geplant bestätigt: <b>${context.planned?esc(name(context.planned.scenarioId)):'Noch nicht bestätigt'}</b><br>Manuelle Umsetzung protokolliert: <b>${context.implemented?esc(name(context.implemented.scenarioId)):'Noch keine Angabe'}</b></p>${context.implemented?`<p>${esc(windowsText(context.implemented.windows))}</p>`:''}<p>Eine Bestätigung gilt ausschließlich für diesen Lauf. Neue Berechnungen erhalten keine stillschweigend übernommene Bestätigung. Jede Änderung bleibt als eigener Eintrag erhalten.</p></section>
  <section><h2>Geplante Variante bestätigen</h2><label>Variante <select id="scenario">${variants.map(s=>`<option value="${s.id}" ${s.id===chosen?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><p>Die Auswahl im Feld allein speichert nichts.</p><button id="planned">Diese Variante als geplant bestätigen</button></section>
  <section><h2>Tatsächlich manuell eingestellte Fenster</h2><p>Die folgenden Werte werden zunächst aus dem Vorschlag übernommen. Passe sie an das an, was du wirklich am Wechselrichter eingestellt hast. Entferne alle Zeilen, wenn du bewusst keine Zwangsladefenster gesetzt hast. Die App sendet keine Gerätesteuerung.</p><p>Alle Uhrzeiten: Europe/Vienna.</p><div id="windows"></div><button id="add">Fenster hinzufügen</button><p><label><input type="checkbox" id="implemented-check"> Ich bestätige, dass ich diese Fenster/Ziel-SOC-Werte manuell am Wechselrichter eingestellt habe.</label></p><button id="implemented">Manuelle Umsetzung protokollieren</button><small>Das ist deine protokollierte Angabe, keine automatische Prüfung am Gerät. Eine spätere Änderung der geplanten Variante ersetzt keine frühere Umsetzungsmeldung.</small></section>
  <section><h2>Unveränderliche Historie</h2>${context.history.length?`<table>${context.history.map(e=>`<tr><td>${e.sequence}. ${label(Date.parse(e.at),config.timeZone)}</td><td>${e.kind==='planned'?'Als geplant bestätigt':'Umsetzung angegeben'}: ${esc(name(e.scenarioId))}${e.kind==='implemented'?`<small>${esc(windowsText(e.windows))}</small>`:''}<small>Eintrag ${e.id}</small></td></tr>`).join('')}</table>`:'Noch keine Bestätigung für diesen Lauf.'}</section>
  <script>const token=${jsonSafe(csrf)},variants=${jsonSafe(variants)},revision=${context.revision},existing=${jsonSafe(existing)};const select=document.querySelector('#scenario'),container=document.querySelector('#windows');function row(w={start:'',end:'',targetSoc:10}){const d=document.createElement('div');d.className='window';d.innerHTML='<label>Beginn <input class="start" type="datetime-local" step="900" required></label><label>Ende <input class="end" type="datetime-local" step="900" required></label><label>Ziel-SOC % <input class="soc" type="number" min="0" max="100" required></label><button>Entfernen</button>';d.querySelector('.start').value=w.start;d.querySelector('.end').value=w.end;d.querySelector('.soc').value=w.targetSoc;d.querySelector('button').onclick=()=>d.remove();container.append(d);}function reset(){container.replaceChildren();for(const w of variants.find(v=>v.id===select.value).windows)row(w);document.querySelector('#implemented-check').checked=false;}select.onchange=reset;reset();if(existing){container.replaceChildren();for(const w of existing)row(w);}document.querySelector('#add').onclick=()=>row();async function send(kind){const windows=[...container.children].map(d=>({start:d.querySelector('.start').value,end:d.querySelector('.end').value,targetSoc:d.querySelector('.soc').value.trim()===''?null:Number(d.querySelector('.soc').value)}));const r=await fetch('decision',{method:'POST',headers:{'Content-Type':'application/json','X-Planner-CSRF':token},body:JSON.stringify({kind,scenarioId:select.value,expectedRevision:revision,windows,confirmImplemented:document.querySelector('#implemented-check').checked})});if(!r.ok){alert(await r.text());return;}location.reload();}document.querySelector('#planned').onclick=()=>send('planned');document.querySelector('#implemented').onclick=()=>send('implemented');</script></html>`;
}

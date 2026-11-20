import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { json, atomicJson } from './archive.mjs';
import { refreshProfiles } from './profiles.mjs';
import { localParts, clockMinutes } from './time.mjs';

export function eligibleHours(statistics, history, config, loadEntity) {
  const status=history.flat().filter(s=>s.entity_id==='binary_sensor.zoe_ladestatus').map(s=>({at:Date.parse(s.last_updated??s.last_changed),state:s.state})).sort((a,b)=>a.at-b.at);
  const activity=history.flat().filter(s=>s.entity_id===(config.entities?.zoeActivity??'sensor.letzte_batterieaktivitat')).map(s=>({at:Date.parse(s.last_updated??s.last_changed),value:Date.parse(s.state)})).sort((a,b)=>a.at-b.at);
  const hours=new Map();
  for(const row of statistics[loadEntity]??[]){const hour=Math.floor(row.start/3_600_000)*3_600_000;(hours.get(hour)??(hours.set(hour,[]),hours.get(hour))).push(row);}
  const result=[];
  for(const[start,rows]of hours){
    rows.sort((a,b)=>a.start-b.start);
    if(rows.length!==12||rows.some((r,i)=>r.start!==start+i*300_000||r.end!==r.start+300_000||!Number.isFinite(r.mean)||r.mean<0))continue;
    const previous=status.filter(s=>s.at<=start).at(-1);
    if(previous?.state!=='off'||status.some(s=>s.at>start&&s.at<start+3_600_000&&s.state!=='off'))continue;
    const fresh=activity.filter(s=>s.at<=start).at(-1)?.value;
    if(!Number.isFinite(fresh)||fresh>start||start-fresh>24*3_600_000)continue;
    const p=localParts(start,config.timeZone);
    const weekday=new Date(`${p.date}T12:00Z`).getUTCDay();
    if(weekday===config.legionella.weekday&&(config.legionella.blockedWindows??[[config.legionella.start,config.legionella.end]]).some(([a,b])=>p.minute<clockMinutes(b)&&p.minute+60>clockMinutes(a)))continue;
    result.push({start:new Date(start).toISOString(),baseKw:rows.reduce((n,r)=>n+r.mean,0)/12/1000,eligible:true});
  }
  return result;
}
export async function learnProfiles(directory,config,loadEntity,now=Date.now()) {
  const rows=[];
  for(const name of await readdir(join(directory,'actual'))){
    if(!name.endsWith('-statistics.json'))continue;
    const date=name.slice(0,10);
    if(Date.parse(`${date}T00:00Z`)<now-43*86400_000)continue;
    const hist=await json(join(directory,'actual',`${date}-zoe-history.json`),null);
    if(!hist)continue;
    rows.push(...eligibleHours(await json(join(directory,'actual',name)),hist.history,config,loadEntity));
  }
  const result=refreshProfiles(rows,now,config.profiles,config.timeZone,config.temporaryLoads);
  result.eligibility='Nur vollständige Stunden mit explizit ausgeschaltetem Zoe-Ladestatus; gepuffertes Legionellenfenster ausgeschlossen. Normale Wäsche bleibt im Grundprofil.';
  const id=result.generatedAt.replace(/[:.]/g,'-');
  await atomicJson(join(directory,'profiles',`${id}.json`),result);
  await atomicJson(join(directory,'profiles-current.json'),result);
  return result;
}

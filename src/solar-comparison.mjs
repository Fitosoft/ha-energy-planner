import { midnight, nextDate } from './time.mjs';
import { solcast, resample } from './inputs.mjs';

export function solarComparison(config,snapshot) {
  if (!snapshot.targetDate) return null;
  const start=midnight(snapshot.targetDate,config.timeZone),end=midnight(nextDate(snapshot.targetDate),config.timeZone);
  const sources=[['Solcast niedrig (P10)','pv_estimate10'],['Solcast mittel (P50)','pv_estimate'],['Solcast hoch (P90)','pv_estimate90']].map(([name,field])=>{
    try{return{name,kwh:resample(solcast(snapshot.solar,field),start,end,name).reduce((n,p)=>n+p/4,0)};}
    catch{return{name,kwh:null};}
  });
  const daily=snapshot.forecastSolar?.daily;
  sources.push({name:'Forecast.Solar',kwh:daily?.date===snapshot.targetDate&&Number.isFinite(daily.kwh)?daily.kwh:null});
  return {date:snapshot.targetDate,start,end,sources,note:(config.pvStrategy==='price_risk'?'Die Empfehlung wägt die Kosten unter P10/P50/P90 ab; zentrale Diagramme und Salden zeigen P50. ':'')+'Tageswerte für denselben Folgetag; die zentrale Referenzkurve ist Solcast P50. P10/P90 sind die niedrigere/höhere Solcast-Schätzung, keine Garantie. Forecast.Solar wird aus dem bereits vorhandenen HA-Cache gelesen; Abrufzeit ist kein Beleg für den Zeitpunkt der ursprünglichen Prognose.'};
}

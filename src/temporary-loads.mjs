import {number} from './inputs.mjs';
export function temporaryEnergy(loads=[],start,end){
 if(!Array.isArray(loads))throw Error('Temporäre Lasten müssen eine Liste sein');
 return loads.reduce((sum,l)=>{const parse=v=>{if(typeof v!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Temporäre Last: Zeitstempel mit Zeitzone erforderlich');return Date.parse(v);};const a=parse(l.start),b=l.end===null?Infinity:parse(l.end);if(b<=a)throw Error('Temporäre Last: Ende vor Beginn');const kw=number(l.powerKw,'Temporäre Leistung',.001,100);return sum+kw*Math.max(0,Math.min(end,b)-Math.max(start,a))/3600000;},0);
}

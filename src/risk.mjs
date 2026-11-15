import { recommend, simulate, validWindows } from './model.mjs';

export function recommendRisk(cases, config, initialSoc) {
  const reference=cases.find(c=>c.name==='P50');
  if(!reference||cases.length!==3)throw Error('Preisrisiko benötigt P10, P50 und P90');
  for(const c of cases)if(c.slots.length!==reference.slots.length||c.slots.some((s,i)=>s.start!==reference.slots[i].start||s.end!==reference.slots[i].end||s.loadKwh!==reference.slots[i].loadKwh||s.price!==reference.slots[i].price))throw Error('PV-Vergleiche benötigen denselben Verbrauch und dieselben Preise');
  const candidates=[{source:'Keine Zwangsladung',windows:[]}];
  for(const c of cases){
    const windows=recommend(c.slots,config,initialSoc).windows;
    if(!candidates.some(p=>JSON.stringify(p.windows)===JSON.stringify(windows)))candidates.push({source:c.name,windows});
  }
  for(const p of candidates){
    if(!validWindows(reference.slots,p.windows,config.battery))throw Error('Ungültige Gerätefenster im Preisvergleich');
    p.outcomes=cases.map(c=>({name:c.name,...simulate(c.slots,config.battery,initialSoc,p.windows,config.exportEurPerKwh)}));
  }
  const best=cases.map((c,i)=>Math.min(...candidates.map(p=>p.outcomes[i].cost)));
  for(const p of candidates)p.maxExtraCost=Math.max(...p.outcomes.map((o,i)=>o.cost-best[i]));
  const referenceIndex=cases.indexOf(reference);
  // shortcut: compare the three existing heuristic plans plus no charge; no global robust optimum claimed.
  candidates.sort((a,b)=>Math.abs(a.maxExtraCost-b.maxExtraCost)>1e-8?a.maxExtraCost-b.maxExtraCost:a.outcomes[referenceIndex].cost-b.outcomes[referenceIndex].cost||a.windows.length-b.windows.length);
  const chosen=candidates[0],baseline=simulate(reference.slots,config.battery,initialSoc,[],config.exportEurPerKwh,true);
  return {baseline,windows:chosen.windows,...simulate(reference.slots,config.battery,initialSoc,chosen.windows,config.exportEurPerKwh,true),
    savings:baseline.cost-chosen.outcomes[referenceIndex].cost,
    method:'Preisrisiko-Vergleich: unter P10-, P50-, P90-Vorschlag und keiner Zwangsladung die größte vermeidbare Kostenabweichung minimieren; höchstens zwei Fenster insgesamt. Keine Eintrittswahrscheinlichkeiten oder globale Optimalität unterstellt.',
    risk:{reference:'P50',selectedSource:chosen.source,maxExtraCostEur:chosen.maxExtraCost,
      cases:cases.map((c,i)=>({name:c.name,pvKwh:c.slots.reduce((n,s)=>n+s.pvKwh,0),cost:chosen.outcomes[i].cost,bestCandidateCost:best[i],extraCost:chosen.outcomes[i].cost-best[i],finalSoc:chosen.outcomes[i].finalSoc,importKwh:chosen.outcomes[i].importKwh,exportKwh:chosen.outcomes[i].exportKwh})),
      candidates:candidates.map(p=>({source:p.source,windows:p.windows,maxExtraCostEur:p.maxExtraCost,outcomes:p.outcomes.map(({trace,...o})=>o)}))}};
}

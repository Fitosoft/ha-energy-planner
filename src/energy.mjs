import { number } from './inputs.mjs';
import { websocketRequest } from './ha.mjs';

export function energyPreferences(baseUrl, token, WebSocketClass = WebSocket) {
  return websocketRequest(baseUrl, token, { type: 'energy/get_prefs' }, WebSocketClass);
}
export function exportTariffFromPreferences(prefs, selectedMeter = null) {
  const candidates = [];
  for (const source of prefs.energy_sources ?? []) {
    if (source.type !== 'grid') continue;
    if (Array.isArray(source.flow_to)) {
      for (const flow of source.flow_to) candidates.push({ meter: flow.stat_energy_to, fixed: flow.number_energy_price, entity: flow.entity_energy_price });
    } else if (source.stat_energy_to) candidates.push({ meter: source.stat_energy_to, fixed: source.number_energy_price_export, entity: source.entity_energy_price_export });
  }
  const selected = selectedMeter ? candidates.filter(c => c.meter === selectedMeter) : candidates;
  if (selected.length !== 1) throw Error('Einspeisevergütung nicht eindeutig: genau einen Exportzähler in der Konfiguration auswählen');
  const c = selected[0];
  if (c.entity) throw Error('Einspeisetarif wird durch eine Entität geliefert; Unterstützung hierfür noch nicht eingerichtet');
  return { eurPerKwh: number(c.fixed, 'Feste Einspeisevergütung'), meter: c.meter, source: 'Home Assistant Energy: feste Einspeisevergütung' };
}

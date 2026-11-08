import { number } from './inputs.mjs';

export function energyPreferences(baseUrl, token, WebSocketClass = WebSocket) {
  const url = new URL('/api/websocket', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    const ws = new WebSocketClass(url);
    const timeout = setTimeout(() => finish(Error('HA-Energiekonfiguration: Zeitüberschreitung')), 20_000);
    let done = false;
    function finish(error, value) {
      if (done) return;
      done = true; clearTimeout(timeout); ws.close();
      error ? reject(error) : resolve(value);
    }
    ws.addEventListener('error', () => finish(Error('HA-WebSocket nicht erreichbar')));
    ws.addEventListener('close', () => { if (!done) finish(Error('HA-WebSocket vorzeitig geschlossen')); });
    ws.addEventListener('message', event => {
      try {
        const m = JSON.parse(event.data);
        if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
        else if (m.type === 'auth_invalid') finish(Error('HA-Zugang für Energiekonfiguration abgelehnt'));
        else if (m.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'energy/get_prefs' }));
        else if (m.type === 'result' && m.id === 1) m.success ? finish(null, m.result) : finish(Error('HA-Energiekonfiguration nicht verfügbar'));
      } catch { finish(Error('Ungültige HA-WebSocket-Antwort')); }
    });
  });
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

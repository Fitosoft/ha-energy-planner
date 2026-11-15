export function apiUrl(base, path) {
  const url = new URL(base);
  return new URL(`${url.pathname.replace(/\/$/, '')}/api/${path}`, url.origin);
}
export async function haRequest(path, body, fetcher = fetch) {
  const response = await fetcher(apiUrl(process.env.HA_URL, path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${process.env.HA_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000), redirect: 'error'
  });
  if (!response.ok) throw Error(`HA-Aufruf fehlgeschlagen (HTTP ${response.status})`);
  return response.json();
}
export async function reportedState(entity, request = haRequest) {
  if (!/^[a-z_]+\.[a-z0-9_]+$/.test(entity)) throw Error('Ungültige Messentität');
  // HA 2026.9 caches serialized REST state timestamps; read the live State property.
  return request('template', { template: `{% set s = states[${JSON.stringify(entity)}] %}{{ dict(entity_id=s.entity_id, state=s.state, attributes=dict(s.attributes), last_changed=s.last_changed.isoformat(), last_updated=s.last_updated.isoformat(), last_reported=s.last_reported.isoformat() if s.last_reported is defined else none, server_now=now().isoformat()) | to_json }}` });
}
export function websocketRequest(base, token, command, WebSocketClass = WebSocket, timeoutMs = 30_000) {
  const url = apiUrl(base, 'websocket');
  if (url.hostname === 'supervisor' && url.pathname === '/core/api/websocket') url.pathname = '/core/websocket';
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    const ws = new WebSocketClass(url);
    const timeout = setTimeout(() => finish(Error('HA-WebSocket: Zeitüberschreitung')), timeoutMs);
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
        else if (m.type === 'auth_ok') ws.send(JSON.stringify({ ...command, id: 1 }));
        else if (m.type === 'result' && m.id === 1) m.success ? finish(null, m.result) : finish(Error('HA-WebSocket-Anfrage abgelehnt'));
      } catch { finish(Error('Ungültige HA-WebSocket-Antwort')); }
    });
  });
}

import { STEP } from './time.mjs';

export function number(value, name, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`Ungültiger Wert: ${name}`);
  return value;
}
export function timestamp(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  number(ms, 'Zeitstempel');
  return ms;
}
export function intervals(rows) {
  const sorted = rows.toSorted((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    number(r.start, 'Start'); number(r.end, 'Ende'); number(r.value, 'Intervallwert');
    if (r.start >= r.end || (i && sorted[i - 1].end > r.start)) throw Error('Überlappende oder ungültige Intervalle');
  }
  return sorted;
}
export function awattar(payload, tariff) {
  if (!tariff?.confirmed) throw Error('Endkundenpreisformel noch nicht bestätigt');
  number(tariff.marketMultiplier, 'Preisfaktor', 0);
  number(tariff.fixedEurPerKwh, 'Variabler Verbrauchsaufschlag');
  const data = payload?.attributes?.data ?? payload?.data;
  if (!Array.isArray(data) || !data.length) throw Error('aWATTar-Daten fehlen');
  return intervals(data.map(r => {
    if (r.unit?.toLowerCase() !== 'eur/mwh') throw Error('Unerwartete aWATTar-Einheit');
    return { start: timestamp(r.start_timestamp), end: timestamp(r.end_timestamp),
      value: number(r.marketprice, 'Börsenpreis') / 1000 * tariff.marketMultiplier + tariff.fixedEurPerKwh };
  }));
}
export function solcast(payload, field = 'pv_estimate') {
  if (!['pv_estimate', 'pv_estimate10', 'pv_estimate90'].includes(field)) throw Error('Unbekannte PV-Prognosevariante');
  if (!Array.isArray(payload?.forecasts) || !payload.forecasts.length) throw Error('Solcast-Prognose fehlt');
  return intervals(payload.forecasts.map(r => {
    const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(r.period ?? '');
    const minutes = duration ? +(duration[1] ?? 0) * 60 + +(duration[2] ?? 0) : 0;
    if (minutes <= 0) throw Error('Ungültige Solcast-Periodendauer');
    const end = timestamp(r.period_end);
    return { start: end - minutes * 60_000, end, value: number(r[field], field, 0) };
  }));
}
export function resample(rows, start, end, name) {
  if (start % STEP || end % STEP || end <= start) throw Error('Horizont muss auf Viertelstunden liegen');
  rows = intervals(rows);
  const result = [];
  for (let t = start; t < end; t += STEP) {
    let covered = 0, weighted = 0;
    for (const r of rows) {
      const dt = Math.max(0, Math.min(t + STEP, r.end) - Math.max(t, r.start));
      covered += dt; weighted += dt * r.value;
    }
    if (covered !== STEP) throw Error(`${name}: Datenlücke bei ${new Date(t).toISOString()}`);
    result.push(weighted / STEP);
  }
  return result;
}
export function fresh(when, now, maxHours, name) {
  const age = now - timestamp(when);
  if (age < -5 * 60_000 || age > maxHours * 3_600_000) throw Error(`${name}: Daten veraltet oder Zeitstempel in der Zukunft`);
}
export function plugDefault(binary, text) {
  const a = binary === 'on' ? true : binary === 'off' ? false : null;
  const b = text === 'plugged' ? true : text === 'unplugged' ? false : null;
  if (a !== null && b !== null && a !== b) return null;
  return a ?? b;
}

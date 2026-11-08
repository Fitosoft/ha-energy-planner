export const STEP = 15 * 60_000;
const formats = new Map();
export function localParts(ms, zone = 'Europe/Vienna') {
  if (!formats.has(zone)) formats.set(zone, new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }));
  const p = Object.fromEntries(formats.get(zone).formatToParts(ms).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: +p.hour * 60 + +p.minute };
}
export function nextDate(date) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
export function midnight(date, zone = 'Europe/Vienna') {
  const anchor = Date.parse(`${date}T00:00:00Z`);
  for (let t = anchor - 14 * 3_600_000; t <= anchor + 14 * 3_600_000; t += STEP) {
    const p = localParts(t, zone);
    if (p.date === date && p.minute === 0) return t;
  }
  throw Error(`Keine lokale Mitternacht für ${date} in ${zone}`);
}
export function clockMinutes(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== '24:00') throw Error(`Ungültige Uhrzeit: ${value}`);
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
export function overlapMinutes(a, b, c, d) { return Math.max(0, Math.min(b, d) - Math.max(a, c)); }
export function label(ms, zone) {
  return new Intl.DateTimeFormat('de-AT', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' }).format(ms);
}

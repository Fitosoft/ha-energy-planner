import { localParts } from './time.mjs';
import { number, timestamp } from './inputs.mjs';

// Input rows must be explicitly approved as base load, not merely missing Zoe status.
export function refreshProfiles(rows, now, previous, zone = 'Europe/Vienna') {
  const maxAge = 42 * 86_400_000;
  const buckets = Object.fromEntries(['weekday','saturday','sunday'].map(k => [k, Array.from({ length: 24 }, () => [])]));
  const seen = new Set();
  for (const row of rows) {
    if (row.eligible !== true) continue;
    const t = timestamp(row.start), age = now - t;
    if (age < 0 || age > maxAge) continue;
    if (seen.has(t)) throw Error('Doppelter Profilzeitpunkt');
    seen.add(t);
    const p = localParts(t, zone);
    if (p.minute % 60 || t % 3_600_000) throw Error('Profil benötigt vollständige Stundenwerte');
    const day = new Date(`${p.date}T12:00Z`).getUTCDay();
    const key = day === 0 ? 'sunday' : day === 6 ? 'saturday' : 'weekday';
    buckets[key][Math.floor(p.minute / 60)].push({ value: number(row.baseKw, 'Basisleistung', 0), weight: 2 ** (-age / (14 * 86_400_000)) });
  }
  const profiles = {}, counts = {}, warnings = [];
  for (const [key, hours] of Object.entries(buckets)) {
    counts[key] = hours.map(a => a.length);
    profiles[key] = hours.map((a, h) => {
      if (a.length < 3) {
        warnings.push(`${key} ${h}:00: nur ${a.length} geeignete Werte; bisheriges Profil beibehalten.`);
        return number(previous[key]?.[h], 'Bisheriger Profilwert', 0);
      }
      return a.reduce((n, x) => n + x.value * x.weight, 0) / a.reduce((n, x) => n + x.weight, 0);
    });
  }
  return { profiles, counts, warnings, generatedAt: new Date(now).toISOString(), lookbackDays: 42, halfLifeDays: 14 };
}

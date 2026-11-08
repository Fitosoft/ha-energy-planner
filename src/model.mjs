import { STEP, localParts, clockMinutes, overlapMinutes } from './time.mjs';
import { number } from './inputs.mjs';

export function validateBattery(b) {
  number(b.capacityKwh, 'Kapazität', 0.1); number(b.minSoc, 'Mindest-SOC', 0, 100);
  number(b.maxSoc, 'Maximal-SOC', b.minSoc, 100);
  number(b.chargeKw, 'Ladeleistung', 0.01); number(b.dischargeKw, 'Entladeleistung', 0.01);
  number(b.chargeEfficiency, 'Ladewirkungsgrad', 0.01, 1);
  number(b.dischargeEfficiency, 'Entladewirkungsgrad', 0.01, 1);
  number(b.wearEurPerKwh, 'Verschleißkosten', 0);
}
function windowOverlap(minute, windows) {
  let lastEnd = -1;
  return windows.reduce((total, [a, b]) => {
    a = clockMinutes(a); b = clockMinutes(b);
    if (a >= b || a < lastEnd) throw Error('Verbraucherfenster müssen sortiert, überschneidungsfrei und innerhalb eines Tages liegen');
    lastEnd = b;
    return total + overlapMinutes(minute, minute + 15, a, b);
  }, 0);
}
export function makeSlots(config, snapshot, start, end, prices, pv, withZoe, withLaundry = false) {
  const b = config.battery;
  validateBattery(b);
  number(config.exportEurPerKwh, 'Einspeisetarif');
  number(config.zoe.powerKw, 'Zoe-Leistung', 0.01);
  number(config.zoe.capacityKwh, 'Zoe-Kapazität', 0.1);
  number(config.zoe.chargeEfficiency, 'Zoe-Ladewirkungsgrad', 0.01, 1);
  // Existing timer cannot enforce a lower SOC target: physical endpoint remains 100%.
  let zoeRemaining = withZoe ? (100 - number(snapshot.zoeSoc, 'Zoe-SOC', 0, 100)) / 100 * config.zoe.capacityKwh / config.zoe.chargeEfficiency : 0;
  const slots = [];
  for (let t = start, i = 0; t < end; t += STEP, i++) {
    const { date, minute } = localParts(t, config.timeZone);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const profileKey = weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : 'weekday';
    const profile = config.profiles[profileKey];
    if (!Array.isArray(profile) || profile.length !== 24) throw Error(`24 Profilwerte für ${profileKey} fehlen`);
    const baseKwh = number(profile[Math.floor(minute / 60)], 'Hausprofil kW', 0) / 4;
    const legionella = weekday === config.legionella.weekday;
    const programStart = clockMinutes(config.legionella.start);
    const programEnd = clockMinutes(config.legionella.end);
    if (programEnd <= programStart) throw Error('Ungültiges Legionellenfenster');
    const legionellaKwh = legionella ? number(config.legionella.extraKwh, 'Legionellenenergie', 0) * overlapMinutes(minute, minute + 15, programStart, programEnd) / (programEnd - programStart) : 0;
    const zoeMinutes = withZoe ? windowOverlap(minute, legionella ? config.zoe.legionellaWindows : config.zoe.normalWindows) : 0;
    const laundryMinutes = withLaundry && date === snapshot.targetDate ? windowOverlap(minute, config.laundry.windows) : 0;
    const laundryKwh = laundryMinutes ? number(config.laundry.powerKw, 'Wäscheleistung', 0) * laundryMinutes / 60 : 0;
    const zoeKwh = Math.min(zoeRemaining, config.zoe.powerKw * zoeMinutes / 60);
    zoeRemaining -= zoeKwh;
    // Conservative shared-circuit rule: do not combine any of the three loads.
    if ((zoeKwh > 0 && legionellaKwh > 0) || (laundryKwh > 0 && (zoeKwh > 0 || legionellaKwh > 0))) throw Error('Szenario verletzt die zeitliche Trennung am gemeinsamen Stromkreis');
    slots.push({ start: t, end: t + STEP, date, minute, baseKwh, zoeKwh, legionellaKwh, laundryKwh,
      loadKwh: baseKwh + zoeKwh + legionellaKwh + laundryKwh,
      pvKwh: number(pv[i], 'PV kW', 0) / 4, price: number(prices[i], 'Preis EUR/kWh') });
  }
  const localCounts = new Map();
  for (const s of slots) { const k = `${s.date}/${s.minute}`; localCounts.set(k, (localCounts.get(k) ?? 0) + 1); }
  // Device timers cannot distinguish the two occurrences of a repeated autumn hour.
  for (const s of slots) s.ambiguousClock = localCounts.get(`${s.date}/${s.minute}`) > 1;
  return slots;
}
export function simulate(slots, battery, initialSoc, windows = [], exportPrice = 0, detail = false) {
  let stored = battery.capacityKwh * initialSoc / 100;
  const min = battery.capacityKwh * battery.minSoc / 100, max = battery.capacityKwh * battery.maxSoc / 100;
  let cost = 0, importKwh = 0, exportKwh = 0, chargedKwh = 0, dischargedKwh = 0;
  const trace = [];
  for (const s of slots) {
    const w = windows.find(w => w.start <= s.start && w.end > s.start);
    const net = s.pvKwh - s.loadKwh;
    let imported = 0, exported = 0, charge = 0, discharge = 0;
    const pvSurplus = Math.max(net, 0);
    if (w) {
      // PV serves load first; forced mode prevents battery discharge even after target.
      const target = Math.min(max, battery.capacityKwh * w.targetSoc / 100);
      const forced = Math.min(battery.chargeKw / 4, Math.max(0, target - stored) / battery.chargeEfficiency);
      const solar = Math.min(battery.chargeKw / 4, pvSurplus, Math.max(0, max - stored) / battery.chargeEfficiency);
      charge = Math.max(forced, solar);
      imported = Math.max(-net, 0) + Math.max(charge - pvSurplus, 0);
      exported = Math.max(pvSurplus - charge, 0);
    } else if (net >= 0) {
      charge = Math.min(net, battery.chargeKw / 4, Math.max(0, max - stored) / battery.chargeEfficiency);
      exported = net - charge;
    } else {
      discharge = Math.min(-net, battery.dischargeKw / 4, Math.max(0, stored - min) * battery.dischargeEfficiency);
      imported = -net - discharge;
    }
    stored += charge * battery.chargeEfficiency - discharge / battery.dischargeEfficiency;
    cost += imported * s.price - exported * exportPrice + discharge * battery.wearEurPerKwh;
    importKwh += imported; exportKwh += exported; chargedKwh += charge; dischargedKwh += discharge;
    if (detail) trace.push({ ...s, forced: !!w, targetSoc: w?.targetSoc ?? null, importKwh: imported, exportKwh: exported,
      chargeKwh: charge, dischargeKwh: discharge, soc: stored / battery.capacityKwh * 100 });
  }
  return { cost, importKwh, exportKwh, chargedKwh, dischargedKwh, finalSoc: stored / battery.capacityKwh * 100, trace };
}
export function validWindows(slots, windows, battery) {
  const sorted = windows.toSorted((a, b) => a.start - b.start), counts = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i], first = slots.find(s => s.start === w.start), last = slots.find(s => s.end === w.end);
    if (!first || !last || w.start >= w.end || first.date !== last.date || (i && sorted[i - 1].end > w.start)) return false;
    if (slots.some(s => s.start >= w.start && s.start < w.end && s.ambiguousClock)) return false;
    if (!Number.isFinite(w.targetSoc) || w.targetSoc < battery.minSoc || w.targetSoc > battery.maxSoc) return false;
    counts.set(first.date, (counts.get(first.date) ?? 0) + 1);
    if (counts.get(first.date) > 2) return false;
  }
  return true;
}
export function recommend(slots, config, initialSoc) {
  const b = config.battery;
  validateBattery(b); number(initialSoc, 'Hausbatterie-SOC', 0, 100);
  const baseline = simulate(slots, b, initialSoc, [], config.exportEurPerKwh);
  let windows = [], best = baseline;
  const targets = [...new Set([...Array.from({ length: 10 }, (_, i) => (i + 1) * 10), b.maxSoc])].filter(x => x >= b.minSoc && x <= b.maxSoc);
  // shortcut: greedy window insertion and 10%-SOC grid; improve only when real comparisons justify it.
  for (let iteration = 0; iteration < new Set(slots.map(s => s.date)).size * 2; iteration++) {
    let addition = null, candidateBest = best;
    for (let a = 0; a < slots.length; a++) for (let z = a; z < slots.length && slots[z].date === slots[a].date; z++) {
      const w = { start: slots[a].start, end: slots[z].end, targetSoc: b.maxSoc };
      if (!validWindows(slots, [...windows, w], b)) continue;
      for (const targetSoc of targets) {
        w.targetSoc = targetSoc;
        const candidate = simulate(slots, b, initialSoc, [...windows, w], config.exportEurPerKwh);
        if (candidate.cost < candidateBest.cost - 0.005) { candidateBest = candidate; addition = { ...w }; }
      }
    }
    if (!addition) break;
    windows.push(addition); best = candidateBest;
  }
  windows.sort((a, b) => a.start - b.start);
  return { method: 'Greedy-Vergleich, 15-Minuten-Fenster, Ziel-SOC in 10%-Schritten; kein globales Optimum garantiert',
    baseline, windows, ...simulate(slots, b, initialSoc, windows, config.exportEurPerKwh, true), savings: baseline.cost - best.cost };
}

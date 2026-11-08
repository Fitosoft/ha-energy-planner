export function demo() {
  const start = Date.parse('2026-11-08T19:00Z'), end = Date.parse('2026-11-09T23:00Z');
  const config = {
    timeZone: 'Europe/Vienna', tariff: { confirmed: true, marketMultiplier: 1, fixedEurPerKwh: 0 }, exportEurPerKwh: 0.05,
    battery: { capacityKwh: 16, minSoc: 0, maxSoc: 100, chargeKw: 5, dischargeKw: 5, chargeEfficiency: 0.95, dischargeEfficiency: 0.95, wearEurPerKwh: 0 },
    profiles: { weekday: Array(24).fill(0.8), saturday: Array(24).fill(0.8), sunday: Array(24).fill(0.8) },
    zoe: { powerKw: 1.45, capacityKwh: 40, chargeEfficiency: 0.85, normalWindows: [['08:15','16:05']], legionellaWindows: [['08:15','11:30'],['15:30','16:05']] },
    legionella: { weekday: 0, start: '12:00', end: '14:30', extraKwh: 4.5 },
    laundry: { cycles: 2, cycleKwh: 1, durationMinutes: 120, earliest: '09:00', latest: '21:00' },
    assumptions: ['Synthetisches Verbrauchsprofil und künstliche Preise.', 'Wirkungsgrade und Leistungsgrenzen sind Beispielannahmen.']
  };
  const snapshot = { generatedAt: new Date(start).toISOString(), marketFetchedAt: new Date(start).toISOString(), solarFetchedAt: new Date(start).toISOString(),
    start, end, targetDate: '2026-11-09', initialSoc: 35, zoeSoc: 70, defaultZoe: true,
    market: { data: [] }, solar: { forecasts: [] }, warnings: [] };
  for (let t = start; t < end; t += 3_600_000) {
    const h = new Date(t).getUTCHours();
    snapshot.market.data.push({ start_timestamp: t, end_timestamp: t + 3_600_000, marketprice: h < 5 ? 80 : 320, unit: 'Eur/MWh' });
    for (let half = 0; half < 2; half++) snapshot.solar.forecasts.push({ period_end: new Date(t + (half + 1) * 1_800_000).toISOString(), period: 'PT30M', pv_estimate: h >= 9 && h < 14 ? 1.5 : 0 });
  }
  return { config, snapshot };
}

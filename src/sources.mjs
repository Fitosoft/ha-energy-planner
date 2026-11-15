import { apiUrl, haRequest, reportedState } from './ha.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { awattar, fresh, number, plugDefault, timestamp } from './inputs.mjs';
import { STEP, localParts, midnight, nextDate } from './time.mjs';
import { energyPreferences, exportTariffFromPreferences } from './energy.mjs';

export async function getJson(url, token, fetcher = fetch) {
  const response = await fetcher(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw Error(`Datenabruf fehlgeschlagen (HTTP ${response.status})`);
  return response.json();
}
export async function collect(config, now = Date.now()) {
  const start = Math.ceil(now / STEP) * STEP;
  const targetDate = nextDate(localParts(now, config.timeZone).date);
  const end = midnight(nextDate(targetDate), config.timeZone);
  const haUrl = process.env.HA_URL, haToken = process.env.HA_TOKEN;
  if (!haUrl || !haToken) throw Error('HA_URL und HA_TOKEN fehlen in der lokalen Umgebung');
  const base = new URL(haUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Ungültige HA_URL');
  const state = id => getJson(apiUrl(base, `states/${encodeURIComponent(id)}`), haToken);
  const exportTariff = exportTariffFromPreferences(await energyPreferences(base, haToken), config.exportMeter ?? null);
  const ids = config.entities;
  const [soc, zoeSoc, plug, plugText, activity, market] = await Promise.all([
    reportedState(ids.batterySoc), state(ids.zoeSoc), state(ids.zoePlug), state(ids.zoePlugText), state(ids.zoeActivity), state(ids.market)
  ]);
  const initialSoc = batterySoc(soc, now);
  let zoeFresh = true;
  try { fresh(activity.state, now, 24, 'Zoe-Aktivität'); } catch { zoeFresh = false; }
  const warnings = [];
  if (!zoeFresh) warnings.push('Zoe-Meldung älter als 24 Stunden oder unbekannt; kein automatischer Ansteck-Default.');
  const parsedZoe = ['unknown', 'unavailable', ''].includes(zoeSoc.state) ? null : Number(zoeSoc.state);
  const defaultZoe = zoeFresh ? plugDefault(plug.state, plugText.state) : null;
  if (defaultZoe === null) warnings.push('Ansteckzustand unbekannt, veraltet oder widersprüchlich: beide Varianten ohne Vorwahl.');
  // Explicit boundaries avoid the rolling-24-hour endpoint truncating tomorrow evening.
  const marketUrl = new URL('https://api.awattar.at/v1/marketdata');
  // aWATTar filters on interval start: include the current hour for off-hour runs.
  marketUrl.searchParams.set('start', String(Math.floor(start / 3_600_000) * 3_600_000)); marketUrl.searchParams.set('end', String(end));
  const marketData = await getJson(marketUrl);
  // Validate formula now, before consuming a Solcast request.
  awattar(marketData, config.tariff);
  const cacheDir = config.cacheDirectory ?? 'local/cache';
  await mkdir(cacheDir, { recursive: true });
  const site = process.env.SOLCAST_RESOURCE_ID;
  if (!site || !/^[a-zA-Z0-9-]+$/.test(site)) throw Error('SOLCAST_RESOURCE_ID fehlt oder ist ungültig');
  const cacheFile = join(cacheDir, `solcast-${site}-${localParts(now, config.timeZone).date}.json`);
  let solar;
  try { solar = JSON.parse(await readFile(cacheFile, 'utf8')); fresh(solar.fetchedAt, now, 24, 'Solcast-Cache'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw Error('Solcast-Cache ungültig/veraltet: bewusst lokal prüfen, kein automatischer Wiederholungsabruf');
    if (!process.env.SOLCAST_API_KEY) throw Error('SOLCAST_API_KEY fehlt');
    solar = { fetchedAt: new Date(now).toISOString(), data: await getJson(`https://api.solcast.com.au/rooftop_sites/${site}/forecasts?format=json`, process.env.SOLCAST_API_KEY) };
    await writeFile(cacheFile, JSON.stringify(solar));
  }
  // Forecast.Solar is archived only. No substitution for missing Solcast data.
  let forecastSolar = null;
  if (config.forecastSolar?.configEntry) {
    try {
      const result = await haRequest('services/forecast_solar/get_forecast?return_response', {
        config_entry: config.forecastSolar.configEntry, resolution: 'raw'
      });
      const daily = await state(config.forecastSolar.dailyEntity);
      if (!result.service_response?.wh_period || daily.attributes?.unit_of_measurement !== 'kWh' || !daily.state?.trim()) throw Error('Forecast.Solar-Daten fehlen');
      forecastSolar = { fetchedAt:new Date(now).toISOString(), source:'Home Assistant Forecast.Solar (vorhandener Cache)',
        resolution:'raw', data:result.service_response, daily:{date:targetDate,kwh:number(Number(daily.state),'Forecast.Solar Tagesenergie',0)}, dailyState:daily };
    } catch { warnings.push('Forecast.Solar konnte nicht vollständig aus HA gelesen werden; kein Ersatz durch Nullwerte.'); }
  } else if (ids.forecastSolar) {
    try { forecastSolar = await state(ids.forecastSolar); }
    catch { warnings.push('Forecast.Solar konnte für das parallele Logging nicht gelesen werden.'); }
  } else warnings.push('Forecast.Solar-Logging vorbereitet; noch keine Entität eingerichtet/zugeordnet.');
  return { generatedAt: new Date(now).toISOString(), start, end, targetDate, initialSoc,
    zoeSoc: zoeFresh && Number.isFinite(parsedZoe) ? parsedZoe : null, defaultZoe, warnings,
    marketFetchedAt: new Date(now).toISOString(), solarFetchedAt: solar.fetchedAt,
    market: marketData, solar: solar.data, forecastSolar, exportTariff,
    sourceState: { marketLastUpdated: market.last_updated, marketRange: market.attributes?.data?.map(r => [r.start_timestamp, r.end_timestamp]),
      batteryUpdated: soc.last_updated, batteryReported:soc.last_reported, batteryTimestampSource:'HA live template', haNow:soc.server_now,
      zoeActivity: activity.state, plug: plug.state, plugText: plugText.state } };
}
export function batterySoc(soc, now) {
  if (typeof soc?.state !== 'string' || !soc.state.trim()) throw Error('Hausbatterie-SOC fehlt');
  const value=number(Number(soc.state),'Hausbatterie-SOC',0,100);
  for(const when of [soc.last_reported??soc.last_updated,soc.server_now].filter(v=>v!==undefined))if(typeof when!=='string'||!/(Z|[+-]\d{2}:\d{2})$/i.test(when))throw Error('Hausbatterie-SOC: Zeitstempel ohne gültige Zeitzone');
  if (soc.server_now && Math.abs(timestamp(soc.server_now)-now)>5*60_000) throw Error('HA-Uhr und Planer-Uhr weichen um mehr als fünf Minuten ab');
  // A missing last_reported may fall back to a recent update; an old update is never assumed fresh.
  fresh(soc.last_reported ?? soc.last_updated,now,0.5,'Hausbatterie-SOC');
  return value;
}

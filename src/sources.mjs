import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { awattar, fresh, number, plugDefault, timestamp } from './inputs.mjs';
import { STEP, localParts, midnight, nextDate } from './time.mjs';

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
  const state = id => getJson(new URL(`/api/states/${encodeURIComponent(id)}`, base), haToken);
  const ids = config.entities;
  const [soc, zoeSoc, plug, plugText, activity, market] = await Promise.all([
    state(ids.batterySoc), state(ids.zoeSoc), state(ids.zoePlug), state(ids.zoePlugText), state(ids.zoeActivity), state(ids.market)
  ]);
  fresh(soc.last_updated, now, 0.5, 'Hausbatterie-SOC');
  if (soc.state === '' || ['unknown', 'unavailable'].includes(soc.state)) throw Error('Hausbatterie-SOC fehlt');
  const initialSoc = number(Number(soc.state), 'Hausbatterie-SOC', 0, 100);
  let zoeFresh = true;
  try { fresh(activity.state, now, 24, 'Zoe-Aktivität'); } catch { zoeFresh = false; }
  const warnings = [];
  if (!zoeFresh) warnings.push('Zoe-Meldung älter als 24 Stunden oder unbekannt; kein automatischer Ansteck-Default.');
  const parsedZoe = ['unknown', 'unavailable', ''].includes(zoeSoc.state) ? null : Number(zoeSoc.state);
  const defaultZoe = zoeFresh ? plugDefault(plug.state, plugText.state) : null;
  if (defaultZoe === null) warnings.push('Ansteckzustand unbekannt, veraltet oder widersprüchlich: beide Varianten ohne Vorwahl.');
  // Explicit boundaries avoid the rolling-24-hour endpoint truncating tomorrow evening.
  const marketUrl = new URL('https://api.awattar.at/v1/marketdata');
  marketUrl.searchParams.set('start', String(start)); marketUrl.searchParams.set('end', String(end));
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
  if (ids.forecastSolar) {
    try { forecastSolar = await state(ids.forecastSolar); }
    catch { warnings.push('Forecast.Solar konnte für das parallele Logging nicht gelesen werden.'); }
  } else warnings.push('Forecast.Solar-Logging vorbereitet; noch keine Entität eingerichtet/zugeordnet.');
  return { generatedAt: new Date(now).toISOString(), start, end, targetDate, initialSoc,
    zoeSoc: zoeFresh && Number.isFinite(parsedZoe) ? parsedZoe : null, defaultZoe, warnings,
    marketFetchedAt: new Date(now).toISOString(), solarFetchedAt: solar.fetchedAt,
    market: marketData, solar: solar.data, forecastSolar,
    sourceState: { marketLastUpdated: market.last_updated, marketRange: market.attributes?.data?.map(r => [r.start_timestamp, r.end_timestamp]),
      batteryUpdated: soc.last_updated, zoeActivity: activity.state, plug: plug.state, plugText: plugText.state } };
}

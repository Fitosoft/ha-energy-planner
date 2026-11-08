import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { awattar, solcast, resample, fresh, number } from './inputs.mjs';
import { makeSlots, recommend } from './model.mjs';
import { collect } from './sources.mjs';
import { markdown } from './report.mjs';
import { refreshProfiles } from './profiles.mjs';

export function plan(config, snapshot, demo = false) {
  const now = Date.parse(snapshot.generatedAt);
  fresh(snapshot.marketFetchedAt, now, 4, 'Preise');
  fresh(snapshot.solarFetchedAt, now, 24, 'PV-Prognose');
  number(snapshot.initialSoc, 'Hausbatterie-SOC', 0, 100);
  const prices = resample(awattar(snapshot.market, config.tariff), snapshot.start, snapshot.end, 'Strompreis');
  const pv = resample(solcast(snapshot.solar), snapshot.start, snapshot.end, 'PV');
  const report = { demo, generatedAt: snapshot.generatedAt, start: snapshot.start, end: snapshot.end,
    defaultZoe: snapshot.defaultZoe, warnings: [...(snapshot.warnings ?? []), ...(config.assumptions ?? [])], scenarios: [] };
  for (const withZoe of [false, true]) for (const withLaundry of config.laundry.enabled ? [false, true] : [false]) {
    const name = `${withZoe ? 'Mit' : 'Ohne'} Zoe${withLaundry ? ' + zusätzliche Wäsche' : ''}`;
    try {
      const slots = makeSlots(config, snapshot, snapshot.start, snapshot.end, prices, pv, withZoe, withLaundry);
      report.scenarios.push({ name, withZoe, withLaundry, plan: recommend(slots, config, snapshot.initialSoc) });
    } catch (e) { report.scenarios.push({ name, error: e.message }); }
  }
  if (!config.laundry.enabled) report.warnings.push('Zusatzwäsche noch nicht berechnet: Zeitfenster und zusätzliche Energie nicht kalibriert.');
  return report;
}
async function main() {
  const [command, configFile = 'local/config.json', inputFile] = process.argv.slice(2);
  if (!['demo', 'collect', 'plan', 'profiles'].includes(command)) throw Error('Aufruf: node src/cli.mjs demo | collect [config] | plan [config] [snapshot] | profiles [config] [history]');
  if (command === 'profiles') {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    const history = JSON.parse(await readFile(inputFile ?? 'local/profile-history.json', 'utf8'));
    const result = refreshProfiles(history, Date.now(), config.profiles, config.timeZone);
    await mkdir('output', { recursive: true });
    const prefix = `output/profile-${result.generatedAt.replace(/[:.]/g, '-')}`;
    await writeFile(`${prefix}.json`, JSON.stringify(result, null, 2));
    await writeFile(`${prefix}-config.json`, JSON.stringify({ ...config, profiles: result.profiles }, null, 2));
    console.log(`Aktualisiertes Profil zur Prüfung: ${prefix}-config.json`);
    return;
  }
  let config, snapshot;
  if (command === 'demo') {
    ({ config, snapshot } = await import('../examples/demo.mjs').then(m => m.demo()));
  } else {
    config = JSON.parse(await readFile(configFile, 'utf8'));
    snapshot = inputFile ? JSON.parse(await readFile(inputFile, 'utf8')) : await collect(config);
  }
  const id = snapshot.generatedAt.replace(/[:.]/g, '-');
  await mkdir('output', { recursive: true });
  const prefix = `output/${command === 'demo' ? 'demo-' : ''}${id}`;
  await writeFile(`${prefix}-input.json`, JSON.stringify(snapshot, null, 2));
  if (command === 'collect') { console.log(`Eingaben gespeichert: ${prefix}-input.json`); return; }
  const report = plan(config, snapshot, command === 'demo');
  await writeFile(`${prefix}-config.json`, JSON.stringify(config, null, 2));
  await writeFile(`${prefix}-plan.json`, JSON.stringify(report, null, 2));
  await writeFile(`${prefix}-bericht.md`, markdown(report, config));
  console.log(`Bericht: ${prefix}-bericht.md`);
  if (report.scenarios.some(s => s.error)) process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`Planung abgebrochen: ${e.message}`); process.exitCode = 1; });
}

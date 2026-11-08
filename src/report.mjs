import { label } from './time.mjs';
const f = (n, digits = 2) => n.toLocaleString('de-AT', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export function markdown(report, config) {
  const lines = ['# PV- und Ladeplanung', '', report.demo ? '**DEMO – synthetische Daten, keine reale Ladeempfehlung.**' : '**Prototyp – manuell zu prüfende Empfehlung, keine Gerätesteuerung.**', '',
    `Erstellt: ${label(Date.parse(report.generatedAt), config.timeZone)}. Horizont: ${label(report.start, config.timeZone)} bis ${label(report.end, config.timeZone)}.`, '',
    `Zoe-Vorwahl: ${report.defaultZoe === null ? 'unbekannt – beide Varianten prüfen' : report.defaultZoe ? 'Laden (angesteckt)' : 'nicht laden (nicht angesteckt)'}.`, '',
    '## Annahmen und Datenqualität', '', ...report.warnings.map(x => `- ${x}`),
    '- Kosten berücksichtigen Import, entgangene Einspeiseerlöse und konfigurierte Verschleißkosten; keine monatlichen Grundgebühren.',
    '- Unterschiedlicher End-SOC wird ausgewiesen, aber nicht mit einem erfundenen zukünftigen Preis bewertet.',
    '- PV versorgt im Modell zunächst die Hauslast; Zwangsladung sperrt Batterieentladung während des gesamten Fensters.',
    '- Zoe-Ladung endet modelliert bei 100 % oder Fensterende. 80 % wären nur mit manuellem Abstecken erreichbar.',
    '- Verbrauchertrennung am gemeinsamen Stromkreis ist eine Planungsregel, keine technische Verriegelung.', ''];
  for (const scenario of report.scenarios) {
    lines.push(`## ${scenario.name}`, '');
    if (scenario.error) { lines.push(`Nicht berechnet: ${scenario.error}`, ''); continue; }
    const p = scenario.plan;
    const total = key => p.trace.reduce((n, s) => n + s[key], 0);
    lines.push('| Energie im Planungshorizont | kWh |', '|---|---:|',
      `| Hausprofil | ${f(total('baseKwh'))} |`, `| Zoe zusätzlich | ${f(total('zoeKwh'))} |`,
      `| Legionellenprogramm zusätzlich | ${f(total('legionellaKwh'))} |`,
      `| Zusätzliche Wäsche | ${f(total('laundryKwh'))} |`, `| PV-Prognose | ${f(total('pvKwh'))} |`, '');
    lines.push(`Kosten ohne Zwangsladung: **${f(p.baseline.cost)} €**. Mit Vorschlag: **${f(p.cost)} €**. Modellvorteil: **${f(p.savings)} €**.`, '',
      `Netzbezug: ${f(p.importKwh)} kWh. Einspeisung: ${f(p.exportKwh)} kWh. End-SOC: ${f(p.finalSoc, 1)} % (ohne Zwangsladung ${f(p.baseline.finalSoc, 1)} %).`, '');
    if (!p.windows.length) lines.push('**Keine Zwangsladung vorgeschlagen.**', '');
    else {
      lines.push('| Beginn | Ende | Ziel-SOC |', '|---|---|---:|');
      for (const w of p.windows) lines.push(`| ${label(w.start, config.timeZone)} | ${label(w.end, config.timeZone)} | ${w.targetSoc} % |`);
      lines.push('');
    }
    lines.push(p.method, '');
  }
  return lines.join('\n');
}

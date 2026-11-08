import { label } from './time.mjs';
const f = (n, digits = 2) => n.toLocaleString('de-AT', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export function windowExplanation(plan) {
  if (!plan.windows.length) return '';
  const forced = plan.trace.filter(s => s.forced);
  const charged = total(forced, 'chargeKwh');
  const imported = total(forced, 'importKwh');
  return charged < 1e-8
    ? `Keine Batterieladung in diesen Fenstern: 0,00 kWh. Der vorhandene SOC liegt bereits über dem Ziel. Der Zwangslademodus dient hier ausschließlich als Entladesperre; ${f(imported)} kWh Netzbezug versorgen die Verbraucher. Der Ziel-SOC ist in diesem Fall kein benötigter Ladezustand.`
    : `In den Zwangsladefenstern: ${f(charged)} kWh Batterieladung (AC-seitig, einschließlich PV) und ${f(imported)} kWh Netzbezug für Batterie und Verbraucher.`;
}
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
    lines.push(windowExplanation(p), '', p.method, '');
  }
  return lines.join('\n');
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function total(trace, key) { return trace.reduce((n, s) => n + s[key], 0); }
function schedule(trace, key, zone) {
  const blocks = [];
  for (const s of trace) {
    if (!(s[key] > 0)) continue;
    const previous = blocks.at(-1);
    if (previous?.end === s.start) previous.end = s.end;
    else blocks.push({ start: s.start, end: s.end });
  }
  return blocks.length ? blocks.map(b => `${label(b.start, zone)} – ${label(b.end, zone)}`).join('<br>') : 'Nicht eingeplant';
}
function chart(trace, zone) {
  const width = 920, left = 45, plot = 850, top = 20, height = 140;
  const max = Math.max(1, ...trace.map(s => Math.max(s.loadKwh, s.pvKwh) * 4));
  const ceiling = Math.ceil(max);
  const x = i => left + i / Math.max(1, trace.length - 1) * plot;
  const path = (values, y0, scale) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${(y0 - v * scale).toFixed(1)}`).join(' ');
  const ticks = [0, ceiling / 2, ceiling].map(v => `<line x1="${left}" x2="895" y1="${top+height-v/ceiling*height}" y2="${top+height-v/ceiling*height}" stroke="#e3e9e8"/><text x="36" y="${top+height-v/ceiling*height+4}" text-anchor="end">${f(v,1)}</text>`).join('');
  const timeLabels = trace.filter((_,i) => i % 16 === 0).map(s => {
    const i = trace.indexOf(s);
    const short = new Intl.DateTimeFormat('de-AT',{timeZone:zone,hour:'2-digit',minute:'2-digit'}).format(s.start);
    return `<text x="${x(i)}" y="182" text-anchor="middle">${short}</text>`;
  }).join('');
  const bands = trace.map((s,i) => s.forced ? `<rect x="${left+i/trace.length*plot}" y="205" width="${plot/trace.length+0.2}" height="90" fill="#f9e3aa"/>` : '').join('');
  return `<svg viewBox="0 0 ${width} 325" role="img" aria-label="Prognostizierte PV-Leistung, Hausverbrauch und Batterie-SOC über den Planungshorizont">
    <g font-size="11" fill="#627572">${ticks}<text x="8" y="12">kW</text>${timeLabels}
    <text x="8" y="211">100 %</text><text x="24" y="299">0 %</text><text x="45" y="318">Batterie-SOC · gelb hinterlegt: Zwangsladefenster</text></g>
    <path d="${path(trace.map(s=>s.pvKwh*4),160,height/ceiling)}" fill="none" stroke="#d28b08" stroke-width="2.5"/>
    <path d="${path(trace.map(s=>s.loadKwh*4),160,height/ceiling)}" fill="none" stroke="#176d68" stroke-width="2.5"/>
    ${bands}<path d="${path(trace.map(s=>s.soc),295,.9)}" fill="none" stroke="#4669b1" stroke-width="2.5"/>
    </svg>`;
}
export function html(report, config) {
  const valid = report.scenarios.filter(s => s.plan);
  const preferred = valid.find(s => s.withZoe === report.defaultZoe && !s.withLaundry) ?? valid[0];
  const preferredIndex = report.scenarios.indexOf(preferred);
  const selected = preferred?.plan;
  const first = valid[0]?.plan.trace ?? [];
  const rates = first.map(s=>s.price);
  const range = rates.length ? `${f(Math.min(...rates)*100,1)}–${f(Math.max(...rates)*100,1)} ct/kWh` : 'Nicht verfügbar';
  const choices = report.scenarios.map((s,i) => `<a class="choice ${i===preferredIndex?'selected':''}" href="#scenario-${i}">
    <span class="eyebrow">VARIANTE ${i+1}${i===preferredIndex?' · VORWAHL':''}</span>
    <h3>${s.withZoe?'Zoe laden':'Zoe nicht laden'}</h3><p>${s.withLaundry?'Mit zwei zusätzlichen Waschladungen':'Ohne zusätzliche Wäsche'}</p>
    <strong>${s.plan?f(s.plan.cost)+' €':'Nicht berechenbar'}</strong>
    <span>${s.plan?'Netto-Stromsaldo im Planungshorizont':escape(s.error)}</span>
    ${s.plan?`<small>End-SOC: ${f(s.plan.finalSoc,1)} % · ${f(s.plan.savings)} € günstiger als dieselbe Variante ohne Zwangsladung</small>`:''}</a>`).join('');
  const sections = report.scenarios.map((s,i)=>{
    if (!s.plan) return `<section id="scenario-${i}"><h2>${escape(s.name)}</h2><p>${escape(s.error)}</p></section>`;
    const p=s.plan,t=p.trace;
    const windows = p.windows.length ? `<table><thead><tr><th>Beginn</th><th>Ende</th><th>Ziel-SOC</th></tr></thead><tbody>${p.windows.map(w=>`<tr><td>${label(w.start,config.timeZone)}</td><td>${label(w.end,config.timeZone)}</td><td><b>${w.targetSoc} %</b></td></tr>`).join('')}</tbody></table>` : '<div class="positive">Keine Zwangsladung vorgeschlagen.</div>';
    return `<section id="scenario-${i}"><div class="sectionhead"><span class="eyebrow">VARIANTE ${i+1}</span><h2>${escape(s.name)}</h2></div>
      <div class="columns"><div><h3>Vorgeschlagene Batteriefenster</h3>${windows}<p class="notice">${escape(windowExplanation(p))}</p><p class="muted">Während des gesamten Fensters bleibt die Batterieentladung im Modell gesperrt – auch nach Erreichen des Ziel-SOC.</p>
      <h3>Verbraucher im Tagesplan</h3><dl><dt>Zoe</dt><dd>${schedule(t,'zoeKwh',config.timeZone)}</dd><dt>Zusätzliche Wäsche</dt><dd>${schedule(t,'laundryKwh',config.timeZone)}</dd><dt>Legionellenprogramm</dt><dd>${schedule(t,'legionellaKwh',config.timeZone)}</dd></dl><p class="muted">Anzeige auf Viertelstunden gerundet; die Energierechnung berücksichtigt Zoe-Fenster minutengenau. Wäsche ist ein Vorschlag zur manuellen Durchführung. Das ganze Zoe-Timerfenster bleibt für Wäsche gesperrt, auch bei prognostiziert früherem Ladeende.</p></div>
      <div><h3>Energie und Kosten</h3><table><tbody>${[
        ['Hausprofil',`${f(total(t,'baseKwh'))} kWh`],['Zoe zusätzlich',`${f(total(t,'zoeKwh'))} kWh`],['Zusätzliche Wäsche',`${f(total(t,'laundryKwh'))} kWh`],
        ['Legionellenprogramm zusätzlich',`${f(total(t,'legionellaKwh'))} kWh`],['PV-Prognose',`${f(total(t,'pvKwh'))} kWh`],
        ['Netzbezug / Einspeisung',`${f(p.importKwh)} / ${f(p.exportKwh)} kWh`],['End-SOC mit / ohne Zwangsladung',`${f(p.finalSoc,1)} / ${f(p.baseline.finalSoc,1)} %`],
        ['Kosten ohne Zwangsladung',`${f(p.baseline.cost)} €`],['Kosten mit Vorschlag',`${f(p.cost)} €`],['Modellvorteil',`${f(p.savings)} €`]
      ].map(([a,b])=>`<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="chart"><h3>Tagesverlauf <span class="legend"><i class="pv"></i>PV <i class="load"></i>Verbrauch</span></h3>${chart(t,config.timeZone)}</div>
      <p class="muted">${escape(p.method)}</p></section>`;
  }).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PV- und Ladeplanung</title>
  <style>
  :root{color-scheme:light;--ink:#173a37;--muted:#5c716d;--line:#dce5e1}*{box-sizing:border-box}body{margin:0;background:#f2f5f0;color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:1190px;margin:auto;padding:40px 28px 70px}header{background:#123e39;color:#fff;padding:36px 40px;border-radius:22px}.eyebrow{font-size:11px;font-weight:750;letter-spacing:1.6px}header .eyebrow{color:#bbdacc}h1{font-size:clamp(29px,4vw,46px);line-height:1.15;margin:12px 0 16px;letter-spacing:-1px}h2{font-size:24px;line-height:1.3;margin:8px 0 22px}h3{font-size:17px;margin:0 0 12px}p{margin:8px 0 16px}.subtitle{color:#d2e3dc;max-width:850px}.badge{display:inline-block;padding:5px 11px;border:1px solid #789d90;border-radius:20px;font-size:12px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:28px}.metric{border-left:2px solid #6f9b88;padding-left:15px}.metric strong{display:block;font-size:25px}.metric span{font-size:12px;color:#d2e3dc}.intro{padding:26px 4px 8px}.choices{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:14px 0 30px}.choice{display:block;text-decoration:none;color:inherit;background:white;border:1px solid var(--line);border-radius:16px;padding:21px;transition:transform .15s}.choice:hover{transform:translateY(-3px)}.choice.selected{border:2px solid #2e8273;background:#f2fbf6}.choice .eyebrow{color:#5c716d;font-size:10px}.choice h3{margin:12px 0 6px}.choice p{font-size:13px;min-height:40px;color:var(--muted)}.choice strong{display:block;font-size:28px}.choice span:not(.eyebrow),.choice small{display:block;font-size:11px;color:var(--muted)}.choice small{margin-top:12px}section{background:white;border:1px solid var(--line);padding:30px;border-radius:18px;margin:22px 0;scroll-margin-top:20px}.columns{display:grid;grid-template-columns:1.15fr 1fr;gap:35px}.muted{font-size:12px;color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px}td,th{padding:10px 7px;text-align:left;border-bottom:1px solid var(--line)}th{font-size:11px;text-transform:uppercase;color:var(--muted)}td:last-child{text-align:right;font-variant-numeric:tabular-nums}dl{display:grid;grid-template-columns:130px 1fr;font-size:13px;gap:12px}dt{font-weight:650}dd{margin:0}.positive{padding:16px;background:#edf7f1;border-radius:10px;font-weight:650}.chart{margin-top:24px;border-top:1px solid var(--line);padding-top:22px}.chart svg{width:100%;height:auto}.legend{float:right;font-weight:400;font-size:12px}.legend i{display:inline-block;width:15px;height:3px;margin:0 6px 3px 14px}.pv{background:#d28b08}.load{background:#176d68}.notice{border-left:3px solid #c89939;padding:12px 18px;background:#faf6e9;font-size:13px}details{margin:20px 0}summary{cursor:pointer;font-weight:700}li{margin:7px 0;font-size:13px}footer{font-size:12px;color:var(--muted)}@media(max-width:850px){.choices,.metrics{grid-template-columns:repeat(2,1fr)}.columns{grid-template-columns:1fr}main{padding:20px 14px}header{padding:25px}section{padding:22px}}@media(max-width:470px){.choices{grid-template-columns:1fr}dl{grid-template-columns:1fr;gap:5px}}@media print{body{background:white}.choice,section{break-inside:avoid}header{background:#edf5ef;color:#173a37}header .subtitle,header .metric span{color:#173a37}.chart{break-inside:avoid}}
  </style></head><body><main><header><span class="eyebrow">ENERGIEPLAN · EUROPE/VIENNA</span><h1>Ein klarer Plan für morgen.</h1><p class="subtitle">${label(report.start,config.timeZone)} bis ${label(report.end,config.timeZone)} · erstellt ${label(Date.parse(report.generatedAt),config.timeZone)}</p><span class="badge">${report.demo?'DEMO · ausschließlich synthetische Daten':'PROTOTYP · reale Eingangsdaten, geschätzte Modellparameter'}</span>
  <div class="metrics"><div class="metric"><strong>${f(report.initialSoc??0,0)} %</strong><span>Batterie beim Planungsstart</span></div><div class="metric"><strong>${f(total(first,'pvKwh'))} kWh</strong><span>PV im Planungshorizont</span></div><div class="metric"><strong>${range}</strong><span>Bezugspreis inkl. Aufschläge</span></div><div class="metric"><strong>${f(report.exportTariff.eurPerKwh*100,2)} ct</strong><span>Einspeisevergütung je kWh</span></div></div></header>
  <div class="intro"><h2>Vier Varianten auf einen Blick</h2><p>Die Vorwahl folgt dem aktuellen Ansteckzustand des Zoe${report.defaultZoe===null?' – dieser ist derzeit unbekannt':''}. Wähle zusätzlich, ob zwei weitere Waschladungen geplant sind.</p><p class="muted">Negative Beträge bedeuten: Einspeiseerlöse übersteigen Bezugskosten und modellierten Verschleiß. Unterschiedliche Endfüllstände sind nicht eingepreist. Jede Einsparung vergleicht dieselben Verbraucher mit und ohne Zwangsladung. Weniger Wäsche oder weniger Fahrzeugladung ist keine Optimierungseinsparung.</p></div>
  <div class="choices">${choices}</div><div class="notice">${selected?`Vorwahl: <b>${escape(preferred.name)}</b>. ${selected.windows.length?`${selected.windows.length} vorgeschlagene Batteriefenster`:'Keine Zwangsladung vorgeschlagen'}. `:''}Empfehlungsbetrieb: Geräte werden nicht geschaltet. Zwei zusätzliche Waschladungen sind eine ausdrücklich geschätzte Mehrverbrauchsvariante. Kleine Modellvorteile können durch Prognose- und Wirkungsgradfehler verschwinden.</div>
  ${sections}<section><h2>Annahmen und Datenqualität</h2><ul>${report.warnings.map(w=>`<li>${escape(w)}</li>`).join('')}<li>Einspeisetarif: ${escape(report.exportTariff.source)}.</li><li>Der Endfüllstand wird gezeigt, aber nicht mit einem unbekannten zukünftigen Strompreis bewertet.</li><li>Zoe, Wäsche und Legionellenprogramm werden zeitlich getrennt. Das ersetzt keine technische Verriegelung des gemeinsamen Stromkreises.</li><li>Bei PV-Überschuss versorgt PV im Modell zuerst das Haus. Während Zwangsladung wird die Batterie nicht entladen.</li></ul></section>
  <footer>Lokaler Bericht ohne externe Schriften, Dienste oder Tracking. Die zugehörige JSON-Datei enthält die Viertelstundenrechnung für spätere Kontrollen.</footer></main></body></html>`;
}

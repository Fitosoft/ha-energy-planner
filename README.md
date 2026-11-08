# Home Assistant Energy Planner

Deterministischer, lokaler Empfehlungsplaner für PV, Hausbatterie und Elektroauto.
Node.js >=22, ausschließlich Standardbibliothek. Keine Gerätesteuerung.

## Entwicklungsstand

Die erste Version wird lokal entwickelt. Persönliche Konfiguration und Daten liegen
in `local/`, Ergebnisse in `output/`; beide Verzeichnisse sind von Git ausgeschlossen.
Beispieldaten und Tests sind synthetisch. Veröffentlichung und Push erfolgen getrennt.

```text
node --test
node src/cli.mjs demo
```

Der Demo-Bericht wird in `output/` gespeichert. Für reale Eingaben siehe
[Inbetriebnahme und Modellgrenzen](docs/home-assistant.md). Die erste Version hat
Preis-/PV-Adapter, Datenlückenprüfung, Batteriesimulation, vier Kombinationen aus Zoe und zwei zusätzlichen Waschladungen,
begrenzte Ladefenstersuche und HTML-/Markdown-/JSON-Ausgabe. Eine aktive HA-Automation
ist noch nicht installiert. Die Suche ist heuristisch und keine globale Optimierung.

## Geplanter Ablauf

Täglich um 20:00 Europe/Vienna: aktuelle Eingaben lesen, bis Ende des Folgetags
simulieren, Ladeempfehlungen und Alternativen als HTML/Markdown/JSON ablegen.
Ein vorhandenes Ladefenster bleibt im Modell auch nach Erreichen des Ziel-SOC aktiv:
die Batterie entlädt dann nicht zur Versorgung des Hauses.

## Quellen

- https://www.awattar.at/services/api (EUR/MWh, explizite Zeitgrenzen)
- https://docs.solcast.com.au/docs/section/rooftop-sites-hobbyist
- https://developers.home-assistant.io/docs/api/rest/

## Noch zu verifizieren

Nutzbare Batteriekapazität und Wirkungsgrade, tatsächliche
Lade-/Entladegrenzen, bereinigte Wochenendprofile und Waschmaschinen-Energie.
Ein Demo-Ergebnis ist keine Empfehlung für eine reale Anlage.

# Home Assistant Energy Planner

Deterministischer, lokaler Empfehlungsplaner für PV, Hausbatterie und Elektroauto.
Node.js >=22, ausschließlich Standardbibliothek. Keine Gerätesteuerung.

## Entwicklungsstand

Die erste Version wird lokal entwickelt. Persönliche Konfiguration und Daten liegen
in `local/`, Ergebnisse in `output/`; beide Verzeichnisse sind von Git ausgeschlossen.
Beispieldaten und Tests sind synthetisch. Veröffentlichung und Push erfolgen getrennt.

## Geplanter Ablauf

Täglich um 20:00 Europe/Vienna: aktuelle Eingaben lesen, bis Ende des Folgetags
simulieren, Ladeempfehlungen und Alternativen als Markdown/JSON ablegen.
Ein vorhandenes Ladefenster bleibt im Modell auch nach Erreichen des Ziel-SOC aktiv:
die Batterie entlädt dann nicht zur Versorgung des Hauses.

## Quellen

- https://www.awattar.at/services/api (EUR/MWh, explizite Zeitgrenzen)
- https://docs.solcast.com.au/docs/section/rooftop-sites-hobbyist
- https://developers.home-assistant.io/docs/api/rest/

## Noch zu verifizieren

Endkundenpreisformel, nutzbare Batteriekapazität und Wirkungsgrade, tatsächliche
Lade-/Entladegrenzen, bereinigte Wochenendprofile und Waschmaschinen-Energie.
Ein Demo-Ergebnis ist keine Empfehlung für eine reale Anlage.

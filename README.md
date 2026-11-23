# Home Assistant Energy Planner

Lokaler Empfehlungsplaner für PV, Hausbatterie und Elektroauto. **Version 0.5.1** läuft als Home-Assistant-App oder über die Kommandozeile. Node.js >=22, ausschließlich Standardbibliothek. Der Planer schaltet keine Geräte und setzt keine Wechselrichter-Timer; die Umsetzung bleibt manuell.

## Funktionsumfang

- Tägliche Planung ab 20:00 Europe/Vienna bis Ende des Folgetags, mit Stundenprofil für den Hausverbrauch und einer Viertelstundenrechnung der Energieflüsse.
- Vier Verbrauchsvarianten: Zoe ja/nein und zwei zusätzliche Waschladungen ja/nein. Zoe, Wäsche und Legionellenprogramm werden zeitlich getrennt berücksichtigt.
- Höchstens zwei Batterie-Zeit-/SOC-Fenster insgesamt pro Planlauf; kein einzelnes Fenster überschreitet Mitternacht.
- Bezugspreise aus aWATTar samt konfigurierten Aufschlägen und Einspeisetarif aus HA Energy.
- Wirtschaftlicher PV-Risikovergleich mit Solcast P10/P50/P90 bei `pvStrategy: "price_risk"` (in der Beispielkonfiguration aktiviert). Unter den drei heuristischen Vorschlägen mit variierten Zielwerten, Weglassen einzelner Fenster und keiner Zwangsladung wird die größte vermeidbare Kostenabweichung minimiert. P50 bleibt Referenz für zentrale Diagramme und Salden; eine Absicherung kann bei P50 mehr kosten. Ohne diese Einstellung bzw. mit `"p50"` bleibt die P50-Suche verfügbar.
- Forecast.Solar optional als getrennte Vergleichsquelle aus dem vorhandenen HA-Cache.
- HTML-/Markdown-Berichte mit Ziel-SOC und erwartetem SOC am Fensterende. Während eines Zwangsladefensters bleibt die Batterieentladung im Modell gesperrt, auch wenn der vorhandene SOC schon über dem Ziel liegt.
- HA Ingress, Handy-Benachrichtigung und Alexa-Durchsage; manuelle Neuberechnung wahlweise mit oder ohne Benachrichtigung.
- Dauerhafte, getrennte Erfassung von automatischem Vorschlag, ausdrücklich bestätigter Variante und vom Nutzer gemeldeten manuellen Ladeeinstellungen.
- Unveränderliche Eingaben und Planberichte, detailliertes Ist-Archiv, nachträgliche Prognoseprüfung und wöchentliche Pflege der Verbrauchsprofile. Fehlversuche überschreiben keinen gültigen Plan und verlängern dessen Horizont nicht.

Temporäre Dauerverbraucher können über `temporaryLoads` getrennt berücksichtigt werden; ihre historischen Betriebsstunden bleiben von der Profilpflege ausgeschlossen. Einrichtung und Beendigung: [Betriebsdokumentation](DOCS.md).

## Einstieg

Für die HA-App: [Installation und Betrieb](DOCS.md). Vor Updates die bestehende App einschließlich ihrer persistenten Daten sichern.

Für Entwicklung und eine Vorschau mit ausschließlich synthetischen Daten:

```text
node --test
node src/cli.mjs demo
```

Der Demo-Bericht liegt anschließend in `output/`. Für reale Eingaben: [Lokale Inbetriebnahme und Modellgrenzen](docs/home-assistant.md). Persönliche Konfiguration und Zugangsdaten gehören nach `local/`, erzeugte Berichte nach `output/`; beide Verzeichnisse sind von Git ausgeschlossen.

## Grenzen und Nachvollziehbarkeit

Die Ladefenstersuche ist heuristisch, mit 15-Minuten-Fenstern und einem 10-Prozentpunkte-Raster für Zielwerte. Der PV-Risikovergleich variiert Zielwerte an den Zeitgrenzen der drei PV-Vorschläge; er unterstellt keine Eintrittswahrscheinlichkeiten und garantiert kein globales Optimum. Restenergie nach Horizontende wird nicht monetär bewertet. Die Ergebnisse sind Modellrechnungen, kein Nachweis tatsächlich erzielter Ersparnisse.

Kapazität, AC-Leistungsgrenzen und Wirkungsgrade der Batterie sowie Waschenergie sind teilweise vorläufig. Zeitliche Trennung ersetzt keine technische Verriegelung des gemeinsamen Stromkreises. Fehlende oder veraltete Daten bleiben Fehler bzw. ausgewiesene Lücken; ein frisch gemeldeter SOC von 0 % ist gültig.

- [Kalibrierung und Messgrenzen](docs/calibration.md)
- [Planbestätigung, Umsetzung und Archivhistorie](docs/0.3.0-fixes.md)
- [Versionshistorie](CHANGELOG.md)
- [Entwicklungsregeln: Tests und einfache Lösungen](AGENTS.md)

## Quellen

- [aWATTar API](https://www.awattar.at/services/api)
- [Solcast Rooftop Sites](https://docs.solcast.com.au/docs/section/rooftop-sites-hobbyist)
- [Home Assistant REST API](https://developers.home-assistant.io/docs/api/rest/)

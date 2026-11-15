# Installation und Betrieb

Die App ist ein Empfehlungsplaner. Sie schreibt keine Ladefenster in den Wechselrichter und schaltet keine Verbraucher.

## Installation

1. Den Ordner der App mit `config.yaml`, `Dockerfile`, `src/`, `examples/` und `package.json` nach `local_apps/ha_energy_planner` auf dem HA-System kopieren. Bei älteren Freigaben heißt der Ordner `addons`.
2. Im App-Store nach Updates suchen bzw. die lokalen Apps neu laden. **PV- und Ladeplaner** installieren.
3. Starten, **Beim Booten starten** aktivieren und **In der Seitenleiste anzeigen** einschalten.
4. Die Weboberfläche öffnen und die private Datei `ha-options.json` importieren. Diese enthält `planner_json` (persönliche Konfiguration), `solcast_api_key` und `solcast_resource_id`. Keine Datei mit Zugangsdaten auf GitHub hochladen.
5. Beim ersten Start nach 20 Uhr wird der heutige Lauf nachgeholt. Sonst **Jetzt berechnen und benachrichtigen** verwenden. Der Knopf löst auch Handy und Alexa aus.

Die App verwendet den vom Supervisor bereitgestellten internen HA-Zugang. Ein zusätzlicher langlebiger HA-Token muss nicht hinterlegt werden. Es werden keine öffentlichen Ports geöffnet; die Ansicht läuft über HA Ingress.

Alternativ kann dieses Repository als App-Repository hinzugefügt werden. Entscheidend ist die dort veröffentlichte Version; lokale Entwicklungsstände sind nicht automatisch gepusht.

## Was täglich passiert

- Ab 20:00 Europe/Vienna: aktuelle HA-Zustände, Preisreihe bis Ende des Folgetags, fester Einspeisetarif aus HA Energy und Solcast-Prognose lesen.
- Vier Szenarien berechnen: Zoe ja/nein, zwei zusätzliche Waschladungen ja/nein.
- Eingaben, Parameter, Versionsnummer, alle Viertelstunden und die Vergleichsrechnung ohne Zwangsladung dauerhaft speichern.
- Erst nach erfolgreicher Archivierung den neuen Bericht als aktuell markieren.
- `notify.mobile_app_toms_iphone` mit Link zur App aufrufen; über `notify.send_message` eine kurze Durchsage an die sechs konfigurierten Echo-Entitäten senden.
- Bei einem Fehler eine Fehlermeldung senden; ein alter Bericht wird nicht als neuer Plan ausgegeben. Sind nur einzelne Szenarien nicht berechenbar, wird ausdrücklich ein eingeschränkter Bericht veröffentlicht.

Der Zeitplan läuft im Dienst und benötigt keine zusätzliche HA-Automation. Ein Neustart am selben Abend holt einen noch nicht versuchten Lauf nach. Ein bereits versuchter Lauf wird nicht automatisch wiederholt; so werden doppelte Ansagen vermieden. Bei Fehlern kann bewusst manuell neu gerechnet werden. Ein Absturz genau während einer Benachrichtigung kann deren Ausgang unklar lassen; deshalb werden Meldungen nicht blind erneut gesendet.

## Archiv und Validierung

Die Daten liegen im privaten, persistenten App-Verzeichnis `/data` und werden bei App-Updates beibehalten. Sie gehören in die HA-App-Sicherung. Die Deinstallation der App kann ihre Daten entfernen: vorher sichern. Es gibt keine automatische Löschung des Archivs.

Jeder Lauf besitzt einen eigenen unveränderlichen Ordner unter `runs/`:

- `input.json`: originale Solcast-/aWATTar-Antworten, Abrufzeitpunkte, SOC, Ansteckzustand, Einspeisetarif und optional Forecast.Solar-Zustand.
- `config.json`: sämtliche tatsächlich verwendeten Modellparameter und Stundenprofile, ohne Zugangsschlüssel.
- `manifest.json`: Format-/Programmversion, Planungshorizont und Szenariofehler. Die Datei wird als Abschlussmarkierung zuletzt geschrieben.
- `plan.json`: alle vier Szenarien samt Ladefenstern, Energiefluss, SOC und Vergleich ohne Zwangsladung, jeweils im Viertelstundenraster.
- `forecast.csv`, `report.html`, `report.md`: exportierbare Viertelstundenrechnung und Berichte.
- Nach Horizontende: `validation.html`, `validation.json`, `validation.csv` mit Prognose-Ist-Vergleich.

Zusätzlich unter `actual/`:

- Jede Minute eine JSONL-Zeile mit relevanten aktuellen HA-Zuständen, Zeitstempeln, Einheiten, Zoe-Ladestatus und Standort. Das sind Stichproben, keine sekundengenaue Leistungsmessung.
- Stündlich werden fünfminütige Recorder-Statistiken für Hauslast, PV, Netz, Batterie, SOC und Energiezähler nachgesichert. Bei Neustarts werden bis zu sieben Tage nachgeholt; die HA-Aufbewahrung kann kürzer sein. Fehlende Zeilen werden nicht erfunden.
- Der detaillierte Zoe-Ladestatus-/SOC-/Steckerverlauf des Vortags wird vor der Löschung in HA archiviert.

Die automatische Prüfung beginnt frühestens zwei Stunden nach Ende des Planungshorizonts, also für den Folgetagsplan typischerweise am übernächsten Morgen. Sie läuft mit der stündlichen Ist-Sicherung. Für jede Viertelstunde sind alle drei fünfminütigen Mittelwerte nötig. Fehler sind **Ist minus Prognose**. Summen und mittlere absolute Abweichung werden ausschließlich auf gemeinsam vollständig belegten Intervallen verglichen. Fehlende Werte bleiben `null`. Unvollständige Prüfungen werden bis sieben Tage nach Horizontende erneut versucht und danach mit den vorhandenen Lücken abgeschlossen.

Der Prüfbericht vergleicht alle Szenarien; er weiß nicht automatisch, welche Wäschevariante tatsächlich gewählt wurde oder welche Wechselrichterfenster aktiv waren. Deshalb ist er kein Nachweis einer erzielten Kostenersparnis. Gemessene Stromkosten nutzen die beim Plan archivierten Preise; Grundgebühren und Batterieverschleiß gehören nicht zum gemessenen Stromsaldo. Der Energie-Bilanzrest kann DC/AC-Verluste und zeitversetzte Messungen enthalten. SOC-Ist ist ein Intervallmittelwert, Modell-SOC der Endwert.

## Verbrauchsprofile

Montags ab 02:00 werden die Profile aus den letzten 42 Tagen nachgezogen; jüngere Werte erhalten mehr Gewicht (Halbwertszeit 14 Tage). Pro Tagesgruppe und Stunde sind mindestens drei geeignete Messstunden nötig, sonst bleibt der bisherige Wert erhalten. Ein Update wird mit Eingangsanzahlen und Warnungen unter `profiles/` archiviert. Jeder Plan speichert sein verwendetes Profil erneut vollständig.

Geeignet sind nur vollständige Messstunden mit explizit ausgeschaltetem Zoe-Ladestatus und frischer Fahrzeugaktivität. Die gepufferten Legionellenzeiten werden ausgeschlossen. Bei fehlender Historie findet keine stillschweigende Freigabe statt. Normale Wäsche bleibt Teil des Grundprofils; zwei zusätzliche Waschladungen werden weiterhin ausdrücklich als Mehrverbrauch modelliert. Wochenend-/Saisoneffekte werden mit zunehmendem Archiv besser belegt; Abwesenheiten und ungemessene Sonderverbraucher sind keine automatisch erkennbaren Ursachen.

## Konfiguration und Grenzen

Die sechs Alexa-Entitäten und der Handy-Dienst lassen sich in den App-Optionen ändern. Nach Änderungen die App neu starten. Der Berichtslink wird aus der eigenen App-ID abgeleitet und kann mit `report_url` überschrieben werden.

Forecast.Solar wird über die vorhandene HA-Aktion forecast_solar.get_forecast aus dem HA-Cache gelesen, sobald forecastSolar.configEntry und forecastSolar.dailyEntity (der kWh-Sensor für morgen) zugeordnet sind. Die gesamte native Zeitreihe und der Tageswert werden archiviert. Es wird keine zusätzliche Forecast.Solar-API-Abfrage ausgelöst. Der Bericht vergleicht den vollständigen Folgetag mit Solcast P10/P50/P90; die Ladeplanung verwendet weiterhin P50. Nach Tagesende wird der Quellenvergleich gegen den gemessenen PV-Ertrag geprüft. Ohne vollständige Tagesmessung bleibt die Tagesabweichung unbekannt. Der alte einzelne Entitäts-Snapshot über entities.forecastSolar bleibt als Alternative unterstützt. Ohne Quelle bleibt im Bericht eine Warnung. Solcast nutzt unverändert die einzelne vereinfachte Modellanlage.

Lade-/Entladewirkungsgrade, Batteriegrenzen und Waschenergie sind teilweise noch Annahmen. Die Fenstersuche ist heuristisch. Eine Prognoseprüfung verbessert diese Grundlagen; eine automatische Gerätesteuerung ist ausdrücklich nicht Teil dieser Version.

Details zu den vorläufigen Parametern: [Kalibrierung](docs/calibration.md).

## Neu in 0.3.0: Wiederholung und Bestätigung

Nach einer fehlgeschlagenen Planung kann jederzeit mit oder ohne Handy-/Alexa-Meldung neu gerechnet werden. Der Link zum aktuellen gültigen Plan wird aus den abgeschlossenen Archivläufen ermittelt. Der Berichtskopf zeigt Lauf, Zeitraum und Bestätigungsstatus.

Über **Variante bestätigen / Umsetzung** wird die geplante Variante ausdrücklich gespeichert. Die tatsächlich manuell am Wechselrichter gesetzten Fenster und Ziel-SOC-Werte werden danach separat protokolliert. Änderungen bleiben als zusätzliche Ereignisse erhalten und gelten nur für den konkreten Lauf; sie werden nicht auf neu gerechnete Pläne übertragen. Es findet keine Gerätesteuerung statt. Details und Sicherungskonzept: [Korrekturen und Auswahlhistorie](docs/0.3.0-fixes.md).

## Korrektur 0.3.1: Zwei Gerätefenster insgesamt

Der Plan darf höchstens zwei unterschiedliche Batterie-Zeit-/SOC-Fenster über den gesamten Planungshorizont enthalten, auch wenn dieser zwei Kalendertage berührt. Bis 0.3.0 war die Begrenzung fälschlich je Kalendertag umgesetzt. Die Suche und die manuelle Umsetzungserfassung verwenden jetzt dieselbe globale Grenze. Frühere Archivberichte bleiben unverändert; enthält ein alter Bericht mehr als zwei Fenster, warnt die Ansicht davor und verlangt vor einer neuen Planbestätigung eine Neuberechnung.

# 0.5.0

- Zeitlich begrenzte Zusatzlasten separat planen und archivieren.
- Betroffene Stunden bei automatischer und manueller Profilpflege ausschließen, auch nach erfasstem Ende.
- Keine dauerhafte Übernahme geschätzter Sonderlasten in das Hausprofil.

# 0.4.1

- Preisrisiko-Suche prüft auch mittlere Ziel-SOC-Kombinationen und das Weglassen einzelner Fenster, statt nur drei fertige PV-Vorschläge und keine Zwangsladung zu vergleichen.
- Regressionstest für einen wirtschaftlich besseren Kompromiss zwischen Vorladung und späterem Netzbezug. Globale Zwei-Fenster-Grenze und Energieflussmodell bleiben unverändert.
- Bericht nennt Kandidatenanzahl und erklärt, dass die wirtschaftliche Risikoabwägung Netzbezug bei P50 bewusst zulassen kann.

# 0.4.0

- Preisrisiko-Abwägung über Solcast P10/P50/P90 einschließlich Bezugspreisen, Einspeisevergütung und Ladeverlusten; keine pauschale pessimistische PV-Annahme.
- Vergleich der drei bisherigen heuristischen Vorschläge und keiner Zwangsladung: kleinste maximale vermeidbare Kostenabweichung unter diesen Kandidaten. Keine Wahrscheinlichkeiten oder globale Optimalität unterstellt.
- Vier Verbrauchsvarianten und höchstens zwei Gerätefenster bleiben erhalten. P50 bleibt Referenz für zentrale Salden und Diagramme; Mehrkosten zur Absicherung werden ausdrücklich benannt.
- Je Fenster Ziel-SOC und Modell-SOC am Ende getrennt, auch bei höherem vorhandenen SOC oder wegen Leistungsgrenzen unerreichtem Ziel. Keine Änderung der physikalischen Ladegrenzen.
- Alle PV-Fälle und geprüften Kandidaten werden im Planarchiv gespeichert.

# 0.3.1

- Fehler behoben: höchstens zwei Batterie-Zeit-/SOC-Fenster insgesamt pro Planlauf statt je Kalendertag.
- Gleiche globale Grenze bei manuellen Umsetzungsmeldungen; alte unzulässige Vorschläge sind nicht neu bestätigbar.
- Unveränderte Archivberichte mit unzulässigen Varianten erhalten einen Warnhinweis.
- Regressionstest für drei über Mitternacht verteilte Fenster.

# 0.3.0

- Frischeprüfung des Hausbatterie-SOC über den live gelesenen HA-Meldezeitpunkt. Unveränderte 0 % bleiben gültig; ungültige, alte und echte Zukunftswerte werden getrennt erkannt.
- Aktueller Bericht wird über `/latest` aus abgeschlossenen Archivläufen ermittelt. Jeder Bericht zeigt Lauf-ID, Planungshorizont, Ablaufstatus und Bestätigungsstatus, ohne seine Archivdatei zu verändern.
- Manueller Wiederholungsversuch mit und ohne Benachrichtigung, unabhängig vom täglichen Einmallauf.
- Vier stabile Szenario-IDs mit ausdrücklicher, dauerhafter Planbestätigung pro Lauf.
- Manuell eingestellte Batteriefenster werden getrennt als Nutzerangabe mit Bezug zur damaligen Planbestätigung gespeichert; keine Gerätesteuerung.
- Änderungen an Bestätigungen und Validierungsständen bleiben als unveränderliche Historie erhalten.

# 0.2.1

- Vollständige vorhandene Forecast.Solar-Zeitreihe über die HA-Aktion lesen und getrennt archivieren.
- Tagesvergleich mit Solcast P10/P50/P90 im Bericht und später gegen gemessenen Ertrag.
- Fehlende Quellen bleiben ausdrücklich fehlend; die Ladeplanung verwendet weiterhin Solcast P50.

# 0.2.0

- Installierbare HA-App für Raspberry Pi 5 (aarch64) und amd64.
- Tägliche Berechnung um 20:00 Europe/Vienna mit Neustart-Nachholung am selben Abend.
- Geschützte Berichtsansicht über HA Ingress, iPhone-Benachrichtigung und Alexa-Durchsage.
- Dauerhaftes Prognosearchiv, minütliche Zustände, fünfminütige Recorder-Statistiken und Zoe-Verlauf.
- Nachträglicher Prognose-Ist-Vergleich mit expliziter Abdeckung und CSV-Export.
- Empfehlungsbetrieb: keine automatischen Verbraucher- oder Wechselrichterbefehle.

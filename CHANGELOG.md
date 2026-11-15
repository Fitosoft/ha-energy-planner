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

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

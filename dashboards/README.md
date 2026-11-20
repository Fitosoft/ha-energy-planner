# Energie live

`energy-live.json` ist die versionierte Lovelace-Konfiguration (JSON ist auch gültiges YAML) für ein separates Dashboard. Enthält aWATTar-Endkundenpreise als Stufenlinie für die nächsten 36 Stunden sowie Leistung und Batterie-SoC mit getrennten Achsen über die letzten 24 Stunden. Preisformel: EUR/MWh × 0,12 + 11,96 ct/kWh. Bei Tarifänderungen gemeinsam mit der Planerkonfiguration anpassen. Fehlende Zukunftspreise werden nicht fortgeschrieben.

Benötigt [ApexCharts Card](https://github.com/RomRider/apexcharts-card), installiert aus der offiziellen Veröffentlichung v2.2.3. Lokale Ressource: `/local/community/apexcharts-card/apexcharts-card.js?v=2.2.3`, Typ JavaScript-Modul. Keine HACS-Installation erforderlich; künftige Kartenupdates erfolgen manuell.

Dashboard-Pfad `/energie-live/energie`; Konfiguration über die HA-WebSocket-API gespeichert und zurückgelesen. Bestehende Dashboards bleiben erhalten. Wenn `/config/www` erstmals angelegt wird, HA Core einmal neu starten: Die `/local`-Route wird beim Start registriert. Danach muss die Ressourcen-URL HTTP 200 und JavaScript liefern; erst dann den Browser vollständig neu laden. Preisumrechnung und Lücken wurden mit synthetischen Daten geprüft. Visuelle Prüfung war beim Anlegen wegen Browser-Verbindungsfehler nicht möglich.

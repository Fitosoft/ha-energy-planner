# Lokale Inbetriebnahme

## Entwicklungsrechner

1. Node.js >=22 verwenden. Es sind keine npm-Pakete erforderlich.
2. `node --test` und `node src/cli.mjs demo` ausführen.
3. `config.example.json` nach `local/config.json` kopieren; persönliche Profile und
   bestätigte Parameter eintragen. Die lokale Datei ist bereits für den Projektbesitzer vorbereitet.
4. `.env.example` nach `local/secrets.env` kopieren und dort die Schlüssel eintragen.
   Datei nicht hochladen. Solcast-Ressource ebenfalls dort setzen.
5. Preisformel anhand der HA-Template-Definition prüfen; erst danach
   `tariff.confirmed` auf `true` setzen. Die vom Projektbesitzer anhand seiner Templates bestätigte Formel lautet:
   `EUR/kWh = EUR/MWh / 1000 * 1.2 + 0.1196`.
   Er reproduziert den Beispielwert 0.4991 EUR/kWh, ist aber kein Vertragsnachweis.
   Monatliche Grundgebühren gehören nicht in variable Kosten. Die feste Einspeisevergütung wird bei jedem Live-Abruf über HA energy/get_prefs aus der Energie-Konfiguration gelesen. Sie ist keine eigene Preis-Entität. Mehrere Exportzähler erfordern eine eindeutige Auswahl über exportMeter; fehlende Werte brechen den Abruf ab.
6. `node --env-file=local/secrets.env src/cli.mjs collect` speichert Eingaben.
7. `node --env-file=local/secrets.env src/cli.mjs plan` liest aktuelle Eingaben
   und erzeugt einen gestalteten HTML-Bericht, Markdown und JSON mit Viertelstundenwerten.
   Alternativ: `node src/cli.mjs plan local/config.json output/DATE-input.json`
   für reproduzierbare Offline-Rechnungen.

Solcast wird einmal pro lokalem Datum und Ressource abgerufen und lokal gecacht.
Keine automatischen Wiederholungen bei API-Fehlern. Die Endkundenpreisprüfung erfolgt
vor dem Abruf, damit ungeklärte Konfiguration keine Solcast-Aufrufe verbraucht.
Forecast.Solar kann über `entities.forecastSolar` als kompletter HA-Zustand mit
Attributen mitgespeichert werden. Ohne eingerichtete Entität bleibt es ausdrücklich
"noch nicht eingerichtet"; es werden keine Parallelprognosen erfunden.

## Preisabdeckung

Der bestehende Raw-Sensor liefert eventuell nur rollierende 24 Stunden.
Der Planer ruft deshalb aWATTar Österreich mit explizitem `start` und `end` ab:
Beginn der aktuellen Stunde bis Mitternacht nach dem Folgetag. Die Simulation beginnt erst an der nächsten Viertelstunde; der Stundenanfang im Abruf verhindert eine Lücke beim aktuellen Stundenpreis. Jede Preis- und
PV-Viertelstunde muss abgedeckt sein. Keine Fortschreibung des letzten Preises und
keine Nullwerte für fehlende Daten. Der HA-Raw-Sensor wird zum Vergleich dokumentiert.

## Modellgrenzen

- Simulation im 15-Minuten-Raster; minutengenaue Zoe-Fenster werden anteilig integriert.
- Bei Start um 20 Uhr wird auch der Verbrauch bis Mitternacht berücksichtigt.
- Winter-/Sommerzeit folgt Europe/Vienna; Tage haben 23, 24 oder 25 Stunden.
  In der doppelt vorkommenden Herbststunde werden keine Zwangsladefenster vorgeschlagen,
  weil die Geräte-Uhrzeit diese zwei Stunden nicht unterscheiden kann.
- In Eigenverbrauchsmodus wird gespeicherte Energie zur Lastdeckung eingesetzt.
- Im Zwangslademodus wird nicht entladen, auch nach Ziel-SOC. PV deckt im Modell
  zuerst die Last; diese Annahme ist am konkreten Wechselrichter noch zu bestätigen.
- PV-Überschuss darf die Batterie auch über den Zwangslade-Zielwert hinaus laden.
- Höchstens zwei Fenster pro lokalem Kalendertag, keine Überschreitung von Mitternacht.
- Suche fügt kostenverbessernde Fenster hinzu, Ziel-SOC in 10%-Schritten.
  Sie ist eine Heuristik, kein Nachweis eines globalen Optimums.
- Jede Variante wird mit ihrer eigenen Variante ohne Zwangsladung verglichen.
  Energie für zusätzliche Zoe-Fahrleistung ist nicht als Einsparung vergleichbar.
- End-SOC wird nicht monetär gutgeschrieben. Zukunft jenseits des Horizonts ist unbekannt.
- Verbrauchs- und Wirkungsgradannahmen werden im Bericht sichtbar ausgewiesen.
- Der numerische Zoe-SOC ist keine zuverlässige Energiezählung. Ohne frische
  Fahrzeugmeldung wird die Zoe-Variante nicht berechnet; kein stiller Ersatz durch 0 %.
- Der Ansteckzustand ist eine Vorwahl, kein Beweis einer geplanten Fahrt/Ladung.
- Die gemeinsame Sicherung wird durch zeitliche Trennung berücksichtigt.
  Es gibt keine technische Verriegelung und keine Strommessung dieses Stromkreises.

## Betrieb auf Home Assistant

Noch nicht installiert oder zeitgesteuert. Der Pi-Betrieb muss zur tatsächlichen
Installationsart passen (HA OS/App oder separater Dienst). Keine Änderungen am
HA-System und keine Schaltbefehle wurden vorgenommen. Erst nach erfolgreichem
Live-Probelauf wird ein täglicher Start um 20:00 Europe/Vienna eingerichtet.

## Profile nachziehen

`node src/cli.mjs profiles local/config.json local/profile-history.json`
berechnet neue Profile und eine neue Konfigurationsdatei zur Prüfung in `output/`.
Die bestehende Konfiguration wird nicht überschrieben. Dafür werden explizit als
geeignet markierte Stundenwerte erwartet:

```json
[{"start":"2026-11-02T00:00:00Z","baseKw":0.8,"eligible":true}]
```

Die Eignungsmarkierung muss Abwesenheiten, Zoe-Ladungen und Zusatzprogramme
berücksichtigen. Fehlender Ladestatus ist keine Freigabe. Betrachtung: letzte
42 Tage, Gewicht halbiert sich alle 14 Tage. Mindestens drei geeignete Werte je
Tagesgruppe/Stunde, sonst vorherigen Wert mit Warnung behalten. Einmal wöchentlich
ist vorgesehen; die Zeitsteuerung und automatische Klassifizierung sind noch offen.

Offen: automatische Historienabfrage und Aktivierung der wöchentlichen Profilaktualisierung,
verifizierte Wäsche-Szenarien, endgültiger Berichtskanal und Prognose-Ist-Vergleich.
Die Datenformate und Eingabesnapshots erlauben diese Erweiterungen ohne Gerätesteuerung.

## Wäschevarianten und Bericht

Vier Varianten kombinieren Zoe ja/nein mit zwei zusätzlichen Waschladungen ja/nein. Vorläufig werden je 1 kWh und 120 Minuten angesetzt. Wäsche, die bereits im historischen Hausprofil steckt, wird nicht nachträglich entfernt. Die Zusatzvariante ist deshalb keine bereinigte Prognose aller Waschgänge.

Die zwei Waschgänge werden nacheinander in die frühesten freien Zeiträume zwischen 09 und 21 Uhr gelegt. Das vollständige Zoe-Timerfenster und die gepufferte Legionellensperre bleiben frei. Dies ist eine konfliktfreie Platzierung, noch keine Preisoptimierung der Waschzeiten.

Negative Stromsalden bedeuten einen Überschuss der Einspeiseerlöse über Bezugskosten und modellierten Verschleiß. Der Batterie-Endfüllstand muss beim Vergleich mitgelesen werden: sein Restwert wird nicht monetarisiert. Kleine Rechenvorteile sind bei unkalibrierten Parametern keine belastbare Ersparnis.

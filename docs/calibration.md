# Noch zu prüfende Modellparameter

Kalibrierung bedeutet, vorläufige Zahlen mit Messungen der eigenen Anlage abzugleichen. Sie ändert nicht automatisch Geräteinstellungen. Die Ist-Archivierung und Prognoseprüfung liefern die Daten dafür; außer der beschriebenen Profilpflege werden Modellparameter noch nicht automatisch nachgestellt.

| Parameter | Aktueller Ansatz | Prüfung |
|---|---|---|
| Hausbatterie-Kapazität | 16 kWh nominal, linear zum angezeigten SOC | Energie und SOC-Änderung in normalen, ausreichend langen Lade-/Entladephasen vergleichen; BMS-Reserven und Messgrenzen beachten. Kein absichtlicher Tiefentladeversuch nötig. |
| Lade-/Entladewirkungsgrad | je 95 %, damit 90,25 % über einen vollständigen Zyklus | Zuerst AC/DC-Messgrenzen und Vorzeichen der Sensoren klären. DC-Batteriezähler allein belegen keinen AC-Rundlaufwirkungsgrad. Umwandlungs- und Bereitschaftsverluste beachten. |
| Leistungsgrenzen | jeweils 10 kW auf AC-Seite vorläufig; SBR160 hat laut Datenblatt 9,6 kW DC-Nennleistung | DC-Nennleistung ist keine feste AC-Leistungsgrenze. Tatsächlich erreichbare Lade-/Entladeleistung und Wechselrichter-Konfiguration prüfen; Temperatur, SOC und Spannung können die Leistung begrenzen. |
| Zwangslademodus | keine Batterieentladung über das ganze Fenster, PV deckt zuerst Last | An tatsächlich gesetzten Fenstern prüfen: Hausversorgung, Netzladung und Verhalten nach Ziel-SOC. Ein Vorschlag ist kein Nachweis, dass das Fenster ausgeführt wurde. |
| Hausprofil | Stundenprofil aus wenigen geeigneten Tagen; Wochenenden zunächst gleich | Wöchentlich aus dem Archiv nachziehen. Mindestens drei geeignete Messstunden pro Gruppe/Stunde, sonst bisherigen Wert behalten. Unregelmäßige freie Tage und Sonderverbraucher werden dadurch nicht automatisch erkannt. |
| Zoe | erster Leistungswert 1,45 kW aus Lastsprüngen; ca. 40 kWh und 85 % Ladewirkungsgrad | Weitere Starts/Stopps mit bekanntem 6-/8-/10-A-Ladestrom vergleichen. Cloud-SOC und Zeitstempel sind begrenzt genau; eine eigene Energiemessung würde die Verluste zuverlässiger trennen. |
| Waschmaschine | je 1 kWh und 120 Minuten, gleichmäßig verteilt | Reale Programme mehrfach messen; insbesondere Heizphase und Gesamtenergie. Zwei zusätzliche Waschgänge sind Mehrverbrauch gegenüber dem bereits Wäsche enthaltenden Grundprofil. |
| Legionellenprogramm | 4,5 kWh von 12:00 bis 14:30; Sperre 11:30 bis 15:30 | Mehrere tatsächliche Läufe auf Dauer, Energie und zeitliches Driften prüfen; parallel beginnendes Kochen erschwert die Trennung. |
| PV-Prognose | Preisrisiko über Solcast P10/P50/P90; zentrale Referenz P50 | Forecast.Solar und Solcast P10/P50/P90 für denselben Folgetag archivieren und gegen Ist vergleichen. Erst mehrere Wochen mit unterschiedlichen Wetterlagen erlauben belastbare Aussagen über systematische Abweichungen. |
| Batterieverschleiß | 0 EUR/kWh | Wirtschaftliche Annahme, nicht direkt aus Messungen kalibrierbar. Kleine Rechenvorteile können durch unberücksichtigte Alterung verschwinden. |

Die Preisformel wurde anhand der HA-Templates bestätigt. Die Einspeisevergütung wird direkt aus HA Energy gelesen. Das sind keine zu schätzenden Wirkungsgrade.

Priorität: PV- und Hausverbrauchsprognose, danach Batterie-Energiebilanz/Verluste und Zusatzverbraucher. Vergleichbare Messgrenzen sind wichtiger als viele Nachkommastellen. Ein Vorteil von wenigen Cent ist bei diesen Unsicherheiten keine belastbare Ersparnis.

Andere Modellgrenzen bleiben davon getrennt: heuristische Fenstersuche und 10-%-SOC-Raster, fehlender Wert der gespeicherten Energie nach Horizontende sowie die Abhängigkeit von ausdrücklicher Planbestätigung und einer separat gemeldeten manuellen Umsetzung. Das sind keine durch einen einzelnen Korrekturfaktor lösbaren Kalibrierfragen.

SBR160-Referenz: 320 V Nennspannung × 50 Ah = 16 kWh. Die 9,6 kW im Datenblatt sind DC-Nennleistung; bei 30 A ist die tatsächliche DC-Leistung spannungsabhängig. Quelle: [Sungrow-Datenblatt](https://info-support.sungrowpower.com/application/pdf/2022/04/21/DS_20220421_SBR096_128_160_192_224_256_Datasheet_V13_EN.pdf). Gesamtzähler aus einer App dürfen erst nach Klärung ihrer Messgrenzen als Wirkungsgradnachweis verwendet werden.

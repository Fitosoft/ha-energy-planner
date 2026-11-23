# Sungrow-Zielerreichung und PV

Herstellerquelle: https://service.sungrowpower.com.au/GD_232312_Hybrid%20System_Forced%20Charge_Android_V1.0.pdf (Seite 2). Nach Zielerreichung lädt und entlädt die Batterie bis zum Fensterende nicht. PV-Überschuss wird exportiert. Die frühere Annahme zusätzlicher PV-Batterieladung war falsch.

Die Simulation begrenzt jede Ladung im aktiven Fenster auf das Ziel. Die Suche verwirft Fenster, die bei mindestens 100 W prognostizierter PV-Leistung nach Zielerreichung länger als die Reserve aktiv bleiben. Reserveende ab Fensterbeginn: Zeit für Energiedefizit plus 5 Prozentpunkte bei 80 % der konfigurierten Ladeleistung, auf 15 Minuten aufgerundet, plus 15 Minuten. Das sind vorläufige Planungsannahmen, keine Hardwaregarantie. Im Preisrisikomodus müssen alle drei PV-Fälle die Bedingung erfüllen. Ohne relevante PV sind lange günstige Entladesperren weiter möglich. Vier Verbrauchsvarianten und historische Validierungen bleiben erhalten.

Der binary_sensor.sungrow_pv_exporting wird minütlich archiviert. Nutzerbestätigte Filter: 100 W Einschalten, 45 s Einschalt- und 60 s Ausschaltverzögerung. Er zeigt Export, nicht dessen Ursache; fehlender Zustand ist keine Entwarnung.

Spätere Erweiterung, jetzt keine Steuerung: Verifizierte Schreib-/Leserückmeldung des Zwangslademodus prüfen, bestätigten Planlauf und Fenster binden, frischen SOC und anhaltenden PV-Export prüfen, nach Zielerreichung gezielt deaktivieren, Ergebnis zurücklesen, Fehler und manuelle Eingriffe protokollieren. Keine Annahme, dass Battery First dies löst.

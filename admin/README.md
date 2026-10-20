# Tasklog Admin

Admin-Oberfläche für Tasklog, umgesetzt nach `../design/Admin UI.dc.html`, im Design-System Nocturne (`src/styles/nocturne.css`) mit Phosphor-Icons.

```sh
npm install
npm run dev      # Entwicklungsserver
npm run build    # Typprüfung + Produktions-Build nach dist/
```

## Aufbau

- `src/App.tsx`: Seitenleiste, Navigation (Abschnitt steht im URL-Hash, z. B. `#rules`) und Seitenkopf
- `src/sections/`: ein Bereich pro Datei (Übersicht, Tickets, Bereiche, Berichte, Home Assistant, Regeln, Benachrichtigungen, Tagesmonitor, Benutzer, Protokoll, Einstellungen, Konfiguration)
- `src/components/ui.tsx`: Schalter, Segment-Auswahl, Toggle-Listen, Felder
- `src/lib/store.tsx`: gemeinsamer Zustand (React Context), aktuell mit Beispieldaten aus `mockData.ts`
- `src/lib/yaml.ts`: erzeugt die Home-Assistant- und die Tasklog-YAML aus Regeln und Entitäten
- `src/locales/de.json` + `src/i18n.ts`: alle Texte (i18next). Für weitere Sprachen eine Datei wie `en.json` anlegen und in `i18n.ts` eintragen.

## Noch offen

Es gibt noch kein Backend. Alle Änderungen bleiben nur im Speicher des Browsers. Verbindungstest, „Wiederholen“, Link erneuern sowie Export und Import sind Platzhalter, bis die API steht.

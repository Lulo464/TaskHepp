# Tasklog Admin

Admin-Oberfläche für Tasklog, umgesetzt nach `../design/Admin UI.dc.html`, im Design-System Nocturne (`src/styles/nocturne.css`) mit Phosphor-Icons.

```sh
npm install
npm run dev      # Entwicklungsserver; /api und /auth gehen an http://localhost:8080 (TASKLOG_API)
npm run build    # Typprüfung + Produktions-Build nach dist/, den der Server ausliefert
```

## Aufbau

- `src/App.tsx`: Seitenleiste, Navigation (der Abschnitt steht im URL-Hash, z. B. `#rules`), Konto und Fehlerhinweise
- `src/MonitorDisplay.tsx`: Vollbild-Tagesmonitor unter `/monitor?t=…`, ohne Login
- `src/sections/`: ein Bereich pro Datei
- `src/components/ui.tsx`: Schalter, Segment-Auswahl, Toggle-Listen, Felder, Hinweise
- `src/lib/api.ts`: Zugriff auf die API. `useApi` lädt Daten, `useAction` führt Änderungen aus und lädt danach neu. Bei 401 geht es zum Login.
- `src/locales/de.json` + `src/i18n.ts`: alle Texte (i18next). Für weitere Sprachen eine Datei wie `en.json` anlegen und in `i18n.ts` eintragen.

# Tasklog Web

Die Web-Oberflächen von Tasklog im Design-System Nocturne (`src/styles/nocturne.css`) mit Phosphor-Icons:

- **App (PWA)** – `index.html` → `src/app/`, nach `../design/Ticket App.dc.html` und `Ticket App Screens.dc.html`. Läuft unter `/`.
- **Admin-UI** – `admin.html` → `src/main.tsx`, nach `../design/Admin UI.dc.html`. Läuft unter `/admin`; `/monitor` (Tagesmonitor) ebenfalls.

```sh
npm install
npm run dev      # Entwicklungsserver; /api und /auth gehen an http://localhost:8080 (TASKLOG_API)
npm run build    # Typprüfung + Produktions-Build nach dist/, den der Server ausliefert
```

## Aufbau

App (`src/app/`):
- `PwaApp.tsx`: Login-Prüfung, Tab-Leiste, Mini-Player für den laufenden Timer
- `router.ts`: Screens über den URL-Hash (`#/tickets`, `#/ticket/5` …)
- `screens/`: Login, Heute, Tickets, Ticket-Detail, Neu, Zeit, Mehr, Bereiche
- `public/manifest.webmanifest`, `public/sw.js`, `public/icons/`: Installation als PWA (Service Worker cacht nur die App-Hülle, Daten kommen immer live)

Admin-UI:

- `src/App.tsx`: Seitenleiste, Navigation (der Abschnitt steht im URL-Hash, z. B. `#rules`), Konto und Fehlerhinweise
- `src/MonitorDisplay.tsx`: Vollbild-Tagesmonitor unter `/monitor?t=…`, ohne Login
- `src/sections/`: ein Bereich pro Datei
- `src/components/ui.tsx`: Schalter, Segment-Auswahl, Toggle-Listen, Felder, Hinweise
- `src/lib/api.ts`: Zugriff auf die API. `useApi` lädt Daten, `useAction` führt Änderungen aus und lädt danach neu. Bei 401 geht es zum Login.
- `src/locales/de.json` + `src/i18n.ts`: alle Texte (i18next). Für weitere Sprachen eine Datei wie `en.json` anlegen und in `i18n.ts` eintragen.

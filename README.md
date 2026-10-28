# TaskHepp / Tasklog

Ticket- und Zeiterfassungssystem für Arbeit und Zuhause, mit Home-Assistant-Anbindung in beide Richtungen und Login über OIDC.

## Inhalt

- `server/` – API-Server (Node.js, TypeScript, Fastify, **PostgreSQL**), liefert auch die Web-Oberflächen aus
- `admin/` – Web-Oberflächen (React + Vite + TypeScript, Design-System „Nocturne“):
  - **App** (PWA) unter `/` – Heute, Tickets, Timer, Zeit; installierbar aufs Handy
  - **Admin-UI** unter `/admin`
  - **Tagesmonitor** unter `/monitor?t=…`
- `design/` – Export aus Claude Design: klickbare Prototypen (`*.dc.html`), Design-System (`_ds/`) und der Chat-Verlauf (`chats/`) als Referenz

## Betrieb mit Docker

```sh
cp .env.example .env      # Passwort, PUBLIC_URL, COOKIE_SECRET und OIDC eintragen
docker compose up -d      # startet PostgreSQL 16 und Tasklog auf Port 8080
```

Beim Start legt Tasklog das Datenbankschema selbst an bzw. aktualisiert es (`server/migrations/`). Nächtliche Backups landen in `./backups`.

## Die App aufs Handy

Die App unter `<PUBLIC_URL>/` ist eine PWA:

- **Android (Chrome):** Seite öffnen → Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“
- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**

Danach startet Tasklog im Vollbild mit eigenem Icon, wie eine normale App.

**Wichtig:** Die volle Installation (eigenes App-Fenster, Start auch ohne Netz) gibt es nur über **HTTPS**. Unter `http://192.168…` läuft die App im Browser; Android legt dann nur eine Verknüpfung an, das iPhone startet sie ohne Offline-Funktion. Für HTTPS Tasklog hinter einen Reverse Proxy mit Zertifikat stellen (z. B. Nginx Proxy Manager, Caddy, Traefik oder ein Cloudflare-Tunnel) und `PUBLIC_URL` auf die `https://`-Adresse setzen.

Admins kommen über **Mehr → Admin-Oberfläche** zur Verwaltung, alle anderen sehen nur die App.

Auf dem Desktop (ab 960 px Breite) zeigt die App eine Seitenleiste statt der unteren Tabs. Tickets erscheinen dort als Liste mit dem gewählten Ticket daneben.

## Entwicklung

Voraussetzung: Node.js 22 und eine PostgreSQL-Datenbank.

```sh
# API (Port 8080), ohne OIDC und mit Beispieldaten
cd server
npm install
DATABASE_URL=postgres://tasklog:tasklog@localhost:5432/tasklog AUTH_MODE=dev SEED_DEMO=true npm run dev

# App unter http://localhost:5173/, Admin unter /admin (leitet /api und /auth an den Server weiter)
cd admin
npm install
npm run dev
```

Tests (brauchen eine leere Test-Datenbank, Standard `postgres://tasklog@127.0.0.1:5433/tasklog_test`, sonst `TEST_DATABASE_URL` setzen):

```sh
cd server && npm test
```

## Login (OIDC)

Tasklog meldet über einen OIDC-Anbieter an (Keycloak, Authentik, Authelia, Zitadel …), mit Authorization Code und PKCE.

1. Beim Anbieter einen Client anlegen, Redirect-URI `<PUBLIC_URL>/auth/callback`.
2. Der Anbieter muss die Gruppen im Claim `groups` mitschicken (anpassbar über `OIDC_GROUPS_CLAIM`).
3. Die Gruppen bestimmen die Rolle:
   - `tasklog-admins` → Admin
   - `tasklog-team` → Mitglied
   - `tasklog-guests` → Lesen

   Die Zuordnung lässt sich unter „Benutzer & Rollen“ ändern. Für den ersten Login kann `BOOTSTRAP_ADMIN_EMAIL` gesetzt werden.

Was die Rollen dürfen:
- **Lesen:** alles ansehen
- **Mitglied:** zusätzlich Tickets und Zeiten bearbeiten
- **Admin:** zusätzlich Regeln, Benutzer, Tokens und Einstellungen ändern

## Home Assistant

**HA → Tasklog.** Home Assistant ruft den Webhook `POST <PUBLIC_URL>/api/hooks/ha/<id>` auf. Dafür braucht es ein API-Token mit dem Recht `tickets:write`, das unter „Einstellungen → API-Tokens“ angelegt wird.

- `{"rule": 1, "event": "start"}` erstellt das Ticket der Regel. Solange eines offen ist, kommt kein Duplikat dazu.
- `{"rule": 1, "event": "end"}` schließt es wieder, je nach Regel.
- `{"title": "…", "area": "Zuhause", "prio": "high"}` legt ein Ticket ohne Regel an.

Die passende HA-Konfiguration (rest_command und Automationen) erzeugt Tasklog unter „Konfiguration“. Optional lässt sich eine HMAC-Signatur erzwingen (Header `X-Tasklog-Signature: sha256=<hex>`).

**Tasklog → HA.** Mit HA-Adresse und Long-Lived-Token, unter „Verbindung“ oder per `HA_URL`/`HA_TOKEN`, meldet Tasklog jede Minute und nach Änderungen diese Sensoren an Home Assistant:
- `sensor.tasklog_open_tickets`
- `sensor.tasklog_today_time`
- `binary_sensor.tasklog_timer_running`
- `binary_sensor.tasklog_overdue`
- `sensor.tasklog_next_due`

Benachrichtigungen gehen über `notify.notify`. Push und E-Mail sind noch nicht angebunden.

**Kalender (z. B. Abfuhrtermine):** Unter „Kalender“ bindest du einen Kalender aus Home Assistant ein, etwa den von *Waste Collection Schedule*. Tasklog liest die Termine alle 15 Minuten über die HA-API.

- Für jeden Termin entsteht genau ein Ticket, z. B. „Restmüll rausstellen“, fällig am Vortag.
- Tickets entstehen nur bis zu 14 Tage im Voraus. Ist der Abfuhrtag vorbei, wird das Ticket automatisch erledigt.
- Ein gelöschtes Ticket wird nicht neu angelegt.

## E-Mail-Import

Unter **Admin → Import → E-Mail** bindest du Postfächer per IMAP ein (SSL/TLS, STARTTLS oder unverschlüsselt). Tasklog ruft sie im eingestellten Abstand ab, nur ungelesene oder alle neuen Mails. Danach markiert es die Mails als gelesen, verschiebt sie, löscht sie oder lässt sie unverändert. Das Passwort wird verschlüsselt gespeichert, der Schlüssel kommt aus `COOKIE_SECRET`.

**Regeln** legen fest, was aus einer Mail wird. Sie werden von oben nach unten geprüft:

- **Bedingungen:** Absender, Betreff oder Text enthält …, optional ein Betreff-Muster (Regex).
- **Aktion:** Ticket anlegen oder ignorieren, z. B. für Newsletter.
- **Mehrere Tickets aus einer Mail:** ein Ticket pro Zeile, pro Aufzählungspunkt oder pro Treffer eines Musters. Mit „Danach weitere Regeln prüfen“ dürfen auch mehrere Regeln dieselbe Mail auswerten.
  Treffer, die eines der Wörter unter „Treffer überspringen“ enthalten (z. B. `herbrand.de, abmelden`), werden ausgelassen.
- **Vorlagen** für Titel und Beschreibung, mit den Platzhaltern `{subject}`, `{from}`, `{fromName}`, `{fromAddress}`, `{date}`, `{body}`, `{bodyFirstLine}`, `{item}` sowie `{1}`, `{2}` … aus den Mustern. `{1|2}` nimmt den ersten Wert, der nicht leer ist.

  Beispiel „ein Ticket pro Link“: Pro Treffer mit dem Muster `^\s*(?:[-*•–·]|\d{1,3}[.)])?\s*(.*?)[\s\[(<:]*((?:https?://|www\.)[^\s\]>)"]+).*$`, Titel `{1|2}` (Text vor dem Link, sonst der Link) und Beschreibung `{2}` (der Link).
- **Bereich, Priorität und Fälligkeit:** keine, in X Tagen oder ein Datum aus der Mail (z. B. „05.11.2026 um 14:30“), optional mit Uhrzeit.

Jede Mail wird genau einmal verarbeitet. Die **Vorschau** zeigt für die neuesten Mails, welche Tickets entstehen würden, ohne etwas zu importieren. Unter **Ausprobieren** lassen sich die Regeln an einer eingetippten Beispielmail testen.

## Tagesmonitor

`<PUBLIC_URL>/monitor?t=<token>` ist eine Vollbildansicht für ein Wanddisplay oder einen Browser-Tab, ohne Login. Den Link gibt es unter „Tagesmonitor“, dort lässt er sich auch erneuern.

Mit `&area=<id>` zeigt der Monitor nur einen Bereich: dessen Tickets, erfasste Zeit, laufenden Timer und Sensoren. Unter „Tagesmonitor“ steht ein fertiger Link für alle Bereiche und je einer pro Bereich.

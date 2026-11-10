# Tasklog

Tickets und Zeiterfassung für Arbeit und Zuhause, mit Home Assistant in beide Richtungen.

- **App fürs Handy und den Desktop** (installierbar, funktioniert auch offline): Heute, Tickets, Planung, Timer, Zeit
- **Admin-Oberfläche** für Bereiche, Benutzer, Regeln, Berichte und Einstellungen
- **Home Assistant:** Tickets aus Automationen, Sensoren zurück an HA, Benachrichtigungen aufs Handy, To-do-Listen, NFC-Tags
- **Import** aus Kalendern (z. B. Abfuhrtermine) und E-Mail-Postfächern
- **Login über OIDC** (Authentik, Keycloak, Authelia …) mit Rollen über Gruppen

Das fertige Docker-Image: [`lulo464/tasklog`](https://hub.docker.com/r/lulo464/tasklog) für amd64 und arm64 (also auch Raspberry Pi und Home Assistant Green).

---

## Inhalt

1. [Was du brauchst](#1-was-du-brauchst)
2. [Installation Schritt für Schritt](#2-installation-schritt-für-schritt)
3. [Anmeldung einrichten (OIDC)](#3-anmeldung-einrichten-oidc)
4. [HTTPS und eigene Adresse](#4-https-und-eigene-adresse)
5. [Erste Schritte nach dem Login](#5-erste-schritte-nach-dem-login)
6. [Die App aufs Handy](#6-die-app-aufs-handy)
7. [Home Assistant verbinden](#7-home-assistant-verbinden)
8. [E-Mail-Import](#8-e-mail-import)
9. [Tagesmonitor](#9-tagesmonitor)
10. [Funktionen im Überblick](#10-funktionen-im-überblick)
11. [Datensicherung](#11-datensicherung)
12. [Aktualisieren](#12-aktualisieren)
13. [Fehlerbehebung](#13-fehlerbehebung)
14. [Datenschutz](#14-datenschutz)
15. [Entwicklung](#15-entwicklung)

---

## 1. Was du brauchst

| | Wofür | Pflicht? |
|---|---|---|
| Ein Rechner mit **Docker** und **Docker Compose** | Tasklog und die Datenbank laufen darin. Ein NAS, ein Mini-PC oder ein Raspberry Pi 4/5 reichen. | ja |
| Einen **OIDC-Anbieter** (Authentik, Keycloak, Authelia, Zitadel …) | Anmeldung und Rollen. Zum reinen Ausprobieren geht es auch ohne, siehe [3.4](#34-nur-zum-ausprobieren-ohne-anmeldung). | ja, für den echten Betrieb |
| Eine **HTTPS-Adresse** über einen Reverse Proxy | Ohne HTTPS lässt sich die App nicht richtig installieren und nicht offline nutzen. | empfohlen |
| **Home Assistant** | Sensoren, Benachrichtigungen, To-do-Listen, NFC, Kalender | nein |

---

## 2. Installation Schritt für Schritt

### 2.1 Docker installieren

Falls noch nicht vorhanden, auf Debian, Ubuntu oder Raspberry Pi OS:

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # danach einmal ab- und wieder anmelden
docker compose version          # muss eine Version anzeigen
```

Auf einem Synology- oder QNAP-NAS installierst du „Container Manager“ bzw. „Container Station“ aus dem Paketzentrum.

### 2.2 Ordner anlegen und Dateien holen

Du brauchst nur zwei Dateien: `docker-compose.yml` und die Vorlage für die Einstellungen.

```sh
mkdir -p ~/tasklog && cd ~/tasklog
curl -fsSLO https://raw.githubusercontent.com/Lulo464/TaskHepp/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/Lulo464/TaskHepp/main/.env.example
```

Alternativ das ganze Repository: `git clone https://github.com/Lulo464/TaskHepp.git ~/tasklog && cd ~/tasklog && cp .env.example .env`.

### 2.3 Einstellungen in `.env` eintragen

Öffne die Datei mit `nano .env` und trage ein:

| Variable | Was hinein gehört |
|---|---|
| `POSTGRES_PASSWORD` | Ein langes Zufallspasswort für die Datenbank, z. B. aus `openssl rand -hex 24` |
| `PUBLIC_URL` | Die Adresse, unter der du Tasklog später aufrufst, z. B. `https://tasks.meine-domain.de`. Ohne Schrägstrich am Ende. Für einen ersten Test im Heimnetz geht auch `http://192.168.1.10:8080`. |
| `COOKIE_SECRET` | Mindestens 32 Zufallszeichen, z. B. aus `openssl rand -base64 48`. **Später nicht mehr ändern**, damit werden auch die Passwörter der E-Mail-Postfächer verschlüsselt. |
| `AUTH_MODE` | `oidc` für den echten Betrieb (siehe [Abschnitt 3](#3-anmeldung-einrichten-oidc)) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Vom OIDC-Anbieter, siehe [Abschnitt 3](#3-anmeldung-einrichten-oidc) |
| `OIDC_GROUPS_CLAIM`, `OIDC_SCOPES` | Meist passen die Vorgaben (`groups`, `openid profile email groups`) |
| `BOOTSTRAP_ADMIN_EMAIL` | **Deine** E-Mail-Adresse beim OIDC-Anbieter. Damit bist du beim ersten Login Admin, auch wenn die Gruppen noch nicht stimmen. |
| `HA_URL`, `HA_TOKEN` | Optional, lässt sich auch später in der Oberfläche eintragen (siehe [7.1](#71-verbindung-herstellen)) |
| `TZ` | Zeitzone, Vorgabe `Europe/Berlin` |
| `SEED_DEMO` | `true` legt beim allerersten Start Beispieldaten an. Für den echten Betrieb `false` lassen. |
| `TASKLOG_IMAGE` | Optional, um eine bestimmte Version festzuhalten, z. B. `lulo464/tasklog:30d24a0` |

Weitere, selten nötige Variablen: `SESSION_DAYS` (wie lange eine Anmeldung gilt, Vorgabe 30), `LOG_LEVEL` (Vorgabe `info`).

### 2.4 Starten

```sh
docker compose up -d
docker compose logs -f tasklog   # mit Strg+C beenden
```

Im Log sollte nach ein paar Sekunden `Server listening at http://0.0.0.0:8080` stehen. Beim ersten Start legt Tasklog die Datenbank selbst an, bei jedem Update aktualisiert es sie.

Teste die Erreichbarkeit: `http://<IP-des-Rechners>:8080/api/health` muss `{"ok":true}` zeigen.

Tasklog lauscht auf Port **8080**. Ist der Port belegt, ändere in `docker-compose.yml` die Zeile `"8080:8080"` z. B. in `"8090:8080"`.

### 2.5 Anmelden

Öffne `PUBLIC_URL` im Browser und tippe auf **„Mit SSO anmelden“**. Nach der Anmeldung beim OIDC-Anbieter landest du in der App. Als Admin erreichst du die Verwaltung über **Mehr → Admin-Oberfläche** oder direkt unter `PUBLIC_URL/admin`.

Klappt die Anmeldung nicht, findest du die häufigsten Ursachen in der [Fehlerbehebung](#13-fehlerbehebung).

---

## 3. Anmeldung einrichten (OIDC)

Tasklog hat keine eigenen Passwörter. Angemeldet wird über deinen OIDC-Anbieter (Authorization Code mit PKCE), die **Rolle** ergibt sich aus den Gruppen:

| Gruppe beim Anbieter | Rolle in Tasklog | Darf |
|---|---|---|
| `tasklog-admins` | Admin | alles, auch Regeln, Benutzer, Tokens und Einstellungen |
| `tasklog-team` | Mitglied | Tickets und Zeiten anlegen und bearbeiten |
| `tasklog-guests` | Lesen | alles ansehen |

Wer in keiner dieser Gruppen ist, kommt nicht hinein („Dein Konto gehört zu keiner Tasklog-Gruppe“). Die Gruppennamen und die Rollen einzelner Personen lassen sich später unter **Admin → Benutzer & Rollen** ändern.

Für jeden Anbieter gilt:
- **Redirect-URI:** `<PUBLIC_URL>/auth/callback`, also z. B. `https://tasks.meine-domain.de/auth/callback`
- Der Anbieter muss die Gruppen im Token mitschicken, standardmäßig im Claim `groups`

### 3.1 Authentik

1. **Gruppen anlegen:** *Verzeichnis → Gruppen* → `tasklog-admins`, `tasklog-team` und bei Bedarf `tasklog-guests`. Dich selbst zu `tasklog-admins` hinzufügen, die Familie zu `tasklog-team`.
2. **Provider anlegen:** *Anwendungen → Provider → Erstellen → OAuth2/OpenID Provider*
   - Name: `Tasklog`, Autorisierungsablauf: der Standard (explizite Zustimmung oder implizit)
   - Client-Typ: **Vertraulich**
   - Redirect-URIs: `https://tasks.meine-domain.de/auth/callback` (Modus „Strict“)
   - Client-ID und Client-Secret notieren
3. **Anwendung anlegen:** *Anwendungen → Anwendungen → Erstellen*, Name `Tasklog`, Slug `tasklog`, Provider `Tasklog`.
4. In der `.env`:
   ```ini
   OIDC_ISSUER=https://auth.meine-domain.de/application/o/tasklog/
   OIDC_CLIENT_ID=<Client-ID>
   OIDC_CLIENT_SECRET=<Client-Secret>
   OIDC_SCOPES=openid profile email
   ```
   Authentik schickt die Gruppen schon mit dem Scope `profile`.

### 3.2 Keycloak

1. **Gruppen anlegen:** im Realm unter *Groups* → `tasklog-admins`, `tasklog-team`, `tasklog-guests`, und die Benutzer zuordnen.
2. **Client anlegen:** *Clients → Create client*
   - Client type `OpenID Connect`, Client ID `tasklog`
   - **Client authentication: On**, Standard flow: On
   - Valid redirect URIs: `https://tasks.meine-domain.de/auth/callback`
   - Unter *Credentials* das Client-Secret kopieren
3. **Gruppen ins Token:** *Client scopes → Create client scope*, Name `groups`, Typ *Default*. Darin *Mappers → By configuration → Group Membership*: Token Claim Name `groups`, **Full group path: Off**, „Add to ID token“ und „Add to userinfo“ an. Dann im Client unter *Client scopes → Add client scope* den Scope `groups` als *Default* hinzufügen.
4. In der `.env`:
   ```ini
   OIDC_ISSUER=https://auth.meine-domain.de/realms/<realm>
   OIDC_CLIENT_ID=tasklog
   OIDC_CLIENT_SECRET=<Secret>
   OIDC_SCOPES=openid profile email groups
   ```

### 3.3 Andere Anbieter (Authelia, Zitadel, Pocket ID …)

Einen vertraulichen OIDC-Client mit Redirect-URI `<PUBLIC_URL>/auth/callback` anlegen und dafür sorgen, dass die Gruppen im ID-Token oder unter userinfo stehen. Heißt der Claim anders als `groups`, setzt du `OIDC_GROUPS_CLAIM`. Als `OIDC_ISSUER` trägst du die Adresse ein, unter der `/.well-known/openid-configuration` liegt, ohne diesen Teil.

Nach jeder Änderung an der `.env`: `docker compose up -d`.

### 3.4 Nur zum Ausprobieren: ohne Anmeldung

Mit `AUTH_MODE=dev` (und gern `SEED_DEMO=true`) ist **jeder Besucher automatisch Admin**. Das ist nur für einen kurzen Test im eigenen Netz gedacht, niemals für eine Installation, die andere erreichen können.

---

## 4. HTTPS und eigene Adresse

Für die installierbare App, das Teilen aus WhatsApp, Offline-Betrieb und NFC-Tags braucht Tasklog eine **HTTPS-Adresse**. Stelle Tasklog dazu hinter einen Reverse Proxy mit Zertifikat und setze `PUBLIC_URL` auf genau diese Adresse.

**Caddy** (holt das Zertifikat selbst):
```
tasks.meine-domain.de {
    reverse_proxy 192.168.1.10:8080
}
```

**Nginx Proxy Manager:** *Proxy Hosts → Add Proxy Host*, Domain `tasks.meine-domain.de`, Forward `http` an `192.168.1.10` Port `8080`, „Websockets Support“ an, unter *SSL* ein Let's-Encrypt-Zertifikat anfordern und „Force SSL“ einschalten.

**Traefik, Cloudflare-Tunnel, Tailscale** funktionieren genauso: Ziel ist Port 8080 des Tasklog-Containers.

Danach in der `.env` `PUBLIC_URL=https://tasks.meine-domain.de`, beim OIDC-Anbieter die Redirect-URI anpassen und `docker compose up -d`.

---

## 5. Erste Schritte nach dem Login

In der Admin-Oberfläche (`/admin`), in dieser Reihenfolge:

1. **Bereiche & Projekte:** Lege deine Bereiche an, z. B. *Zuhause*, *Arbeit*, *Garten*, mit Symbol und Standard-Priorität. Projekte sind optional und gehören zu einem Bereich.
2. **Benutzer & Rollen:** Wer sich einmal angemeldet hat, erscheint hier. Rollen lassen sich pro Person überschreiben, und die Zuordnung Gruppe → Rolle lässt sich ändern.
3. **Einstellungen:** unter anderem
   - *Runden auf:* das Zeitraster für Timer (5/10/15/30 min, eigener Takt oder sekundengenau)
   - *Zeiterfassung:* Auto-Stopp um Mitternacht, nur ein Timer gleichzeitig, Erinnerung bei langem Timer
   - *API-Tokens:* für Home Assistant und die Integration (siehe [Abschnitt 7](#7-home-assistant-verbinden))
   - *Backup & Export*
4. **Benachrichtigungen:** Ruhezeiten und welche Nachrichten es grundsätzlich gibt
5. **Datenschutz:** Impressum und Datenschutzerklärung, falls nicht nur deine Familie Tasklog nutzt (siehe [Abschnitt 14](#14-datenschutz))

Danach `BOOTSTRAP_ADMIN_EMAIL` in der `.env` ruhig stehen lassen. Es schadet nicht und rettet dich, falls die Gruppen beim Anbieter einmal falsch sind.

---

## 6. Die App aufs Handy

Die App unter `PUBLIC_URL` ist eine Web-App (PWA), die sich wie eine normale App installieren lässt:

- **Android (Chrome):** Seite öffnen → Menü ⋮ → **„App installieren“**
- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**

Danach startet Tasklog im Vollbild mit eigenem Icon. Das klappt nur über **HTTPS** (siehe [Abschnitt 4](#4-https-und-eigene-adresse)). Unter `http://192.168…` läuft sie nur im Browser.

Jeder Benutzer richtet unter **Mehr** für sich ein:
- **Bereiche:** Reihenfolge und welche Bereiche er sieht
- **Benachrichtigungen:** auf welche Handys welche Nachrichten kommen (braucht Home Assistant, siehe [7.3](#73-benachrichtigungen-aufs-handy))
- **Bei Ankunft erinnern**, **Kalender-Abo**, **NFC-Tags**, **Meine Daten**

---

## 7. Home Assistant verbinden

Alle Schritte sind unabhängig voneinander, nimm nur, was du brauchst.

### 7.1 Verbindung herstellen

1. In Home Assistant: dein Profil (unten links) → *Sicherheit* → **Langlebige Zugangstoken** → *Token erstellen*, Name „Tasklog“. Den Token kopieren.
2. In Tasklog: **Admin → Verbindung** → Adresse und Token eintragen → *Speichern* → *Verbindung testen*.
   - Als Adresse besser die **IP** nehmen, z. B. `http://192.168.1.20:8123`. `homeassistant.local` lässt sich aus dem Docker-Container heraus oft nicht auflösen.

### 7.2 Sensoren in Home Assistant

Sobald die Verbindung steht, meldet Tasklog jede Minute und nach jeder Änderung diese Sensoren an HA. Welche, wählst du unter **Admin → Verbindung**:

- `sensor.tasklog_open_tickets`: offene Tickets
- `sensor.tasklog_today_time`: heute erfasste Zeit in Stunden
- `binary_sensor.tasklog_timer_running`: läuft ein Timer?
- `binary_sensor.tasklog_overdue`: gibt es Überfälliges?
- `sensor.tasklog_next_due`: das nächste fällige Ticket

### 7.3 Benachrichtigungen aufs Handy

Benachrichtigungen laufen über die Home-Assistant-App (Companion App) auf den Handys.

1. Die HA-App auf jedem Handy installieren und anmelden. Dadurch entsteht in HA je ein Dienst `notify.mobile_app_<gerät>`.
2. In Tasklog wählt **jeder Benutzer** unter **Mehr → Benachrichtigungen** seine Geräte und was er bekommen will: bald fällig (eine Stunde vorher), heute fällig (9 Uhr), Tagesübersicht (7 Uhr), neu für mich, neu von Home Assistant, Timer läuft lange.

Erinnerungen gehen an die zugewiesene Person, sonst an alle, die den Bereich sehen. Ein Tippen auf die Nachricht öffnet das Ticket. Solange niemand eigene Geräte gewählt hat, geht alles an `notify.notify`.

### 7.4 Tickets aus Home Assistant (Regeln und Webhook)

Beispiel: „Wenn die Waschmaschine fertig ist, entsteht das Ticket *Wäsche aufhängen*.“

1. **Admin → Einstellungen → API-Tokens** → neuer Token mit dem Recht `tickets:write`. Den Token gleich kopieren, er wird nur einmal angezeigt.
2. **Admin → Regeln** → Regel anlegen: Entität, Bedingung, Titel, Bereich, Priorität, und was beim Ende passiert.
3. **Admin → Konfiguration → Home Assistant (YAML)** kopieren und in HA einfügen, in die `configuration.yaml` oder als Package. Es enthält einen `rest_command` und die Automationen zu deinen Regeln.
4. In HA in die `secrets.yaml`:
   ```yaml
   tasklog_auth: "Bearer <dein API-Token>"
   ```
5. Home Assistant neu starten. Unter **Admin → Protokoll** siehst du jeden Aufruf aus HA.

Für eigene Automationen geht auch direkt: `POST <PUBLIC_URL>/api/hooks/ha/<id>` (die Adresse steht unter *Verbindung*) mit `{"title": "…", "area": "Zuhause", "prio": "high"}`. Optional lässt sich eine HMAC-Signatur erzwingen (*Einstellungen → Webhook-Signatur*).

### 7.5 To-do-Listen

Es gibt zwei Wege. Wähle einen pro Bereich:

**A) Vorhandene HA-Liste verknüpfen (ohne Installation in HA).** Für eine Liste, die du schon nutzt: Einkaufsliste, „Lokale To-do-Liste“, Google Tasks oder Todoist in HA.
1. **Admin → Verbindung → To-do-Listen verknüpfen**: pro Bereich die Liste wählen.
2. Fertig. Tasklog gleicht jede Minute ab und wenige Sekunden nach Änderungen in Tasklog. Übernommen werden neue Einträge, Abhaken, Umbenennen, Fälligkeitsdatum und Beschreibung, in beide Richtungen. Braucht HA 2024.8 oder neuer.

**B) Tasklog-Integration (eigene Liste pro Bereich in HA).** HA zeigt dann je Bereich eine Liste `todo.tasklog_<bereich>`, auch nutzbar per Sprachassistent („Füge Milch zu Tasklog Zuhause hinzu“).
1. API-Token mit `tickets:write` anlegen (siehe [7.4](#74-tickets-aus-home-assistant-regeln-und-webhook), Schritt 1).
2. In HA über **HACS → ⋮ → Benutzerdefinierte Repositories**: `https://github.com/Lulo464/TaskHepp`, Typ *Integration*, dann „Tasklog“ installieren. Ohne HACS kopierst du den Ordner `custom_components/tasklog` ins `config`-Verzeichnis von HA.
3. HA neu starten → *Einstellungen → Geräte & Dienste → Integration hinzufügen → Tasklog* → Tasklog-Adresse und Token eintragen.
4. Optional für das Dashboard: **Admin → Konfiguration → Dashboard-Karte** liefert das YAML für die To-do-Karten.

### 7.6 Kalender, z. B. Abfuhrtermine

1. In HA einen Kalender einrichten, z. B. mit *Waste Collection Schedule*.
2. **Admin → Kalender** → Kalender wählen, Bereich, Titel-Vorlage (z. B. „{title} rausstellen“, `{date}` = Datum) und wie viele Tage vorher.

Für jeden Termin entsteht genau ein Ticket, bis zu 14 Tage im Voraus. Ist der Termin vorbei, wird das Ticket automatisch erledigt. Ein gelöschtes Ticket kommt nicht wieder.

### 7.7 Mehr mit Home Assistant

- **Automatisch erledigen:** Auf der Ticket-Seite unter *Automatisch erledigen, wenn …* eine Entität und einen Zustand wählen, z. B. `sensor.waschmaschine` wechselt zu `idle`.
- **Bei Ankunft erinnern:** Unter *Mehr → Bei Ankunft erinnern*. Wenn du in einer Zone ankommst, z. B. zu Hause, schickt Tasklog dir, was dort heute ansteht.
- **NFC-Tags:** siehe [Funktionen](#nfc-tags). Mit der Integration aus 7.5 B funktionieren auch Tags, die du mit der HA-App scannst.

---

## 8. E-Mail-Import

Beispiel: Rechnungen, Bestellungen oder Mails von Oma werden automatisch zu Tickets.

1. **Admin → E-Mail → Postfach hinzufügen:** IMAP-Server, Port, Verschlüsselung (SSL/TLS oder STARTTLS), Benutzer und Passwort (bei Gmail, Outlook & Co. ein *App-Passwort*). Dazu wählst du, wie oft abgerufen wird, ob nur ungelesene Mails zählen und was danach mit der Mail passiert: als gelesen markieren, verschieben, löschen oder nichts.
2. **Regeln anlegen.** Sie werden von oben nach unten geprüft:
   - **Bedingungen:** Absender, Betreff oder Text enthält …, optional ein Betreff-Muster (Regex)
   - **Aktion:** Ticket anlegen oder ignorieren (z. B. Newsletter)
   - **Aufteilen:** ein Ticket pro Zeile, pro Aufzählungspunkt oder pro Treffer eines Musters. Treffer mit Wörtern aus „Treffer überspringen“ fallen weg.
   - **Werte aus dem Mailtext holen:** ein Muster (Regex) auf den Text. Der erste Treffer liefert `{text1}`, `{text2}` … Es filtert nicht: Passt es nicht, entsteht das Ticket trotzdem. Links aus HTML-Mails stehen im Text als `Linktext <Adresse>`.
   - **Vorlagen** für Titel und Beschreibung mit `{subject}`, `{from}`, `{fromName}`, `{fromAddress}`, `{date}`, `{body}`, `{bodyFirstLine}`, `{item}`, dazu `{1}`, `{2}` … aus dem Betreff-Muster und `{text1}`, `{text2}` … aus dem Text-Muster. `{1|2}` nimmt den ersten nicht leeren Wert.
   - **Bereich, Priorität, Fälligkeit:** keine, in X Tagen oder ein Datum aus der Mail
3. **Vorschau** zeigt für die neuesten Mails, welche Tickets entstehen würden, ohne etwas zu importieren. Unter **Ausprobieren** testest du die Regeln an einer eingetippten Beispielmail.

Jede Mail wird genau einmal verarbeitet. Das Passwort wird verschlüsselt gespeichert, der Schlüssel ist `COOKIE_SECRET`.

### 8.1 Beispiel: Mails aus einem Ticketsystem

Ein Ticketsystem schickt Mails wie diese:

> **Betreff:** `WG: [herbrand#305564 IT Solutions-Ticket] "ITA - Tobias Horster - neuer Mitarbeiter" - Ticket ist zugewiesen`
> **Text:** … das Ticket wurde Ihnen zugewiesen. <u>Link zum Ticket</u> … (ein Link, die Adresse steht nur dahinter)

Daraus soll ein Ticket werden mit
- dem **Titel** aus den Anführungszeichen: `ITA - Tobias Horster - neuer Mitarbeiter`
- in der **Beschreibung nur dem Link**, der in der Mail hinter „Link zum Ticket“ steckt

**So richtest du das ein:**

1. **Admin → E-Mail**, links das Postfach wählen, oben auf **Regeln** und **Neue Regel**.
2. Die Felder so ausfüllen:

   | Feld | Eintrag | Bedeutung |
   |---|---|---|
   | Name | `IT-Tickets` | frei wählbar |
   | Betreff enthält | `Ticket ist zugewiesen` | Die Regel greift nur bei diesen Mails. |
   | Betreff passt zum Muster | `["„“](.+?)["“”]` | nimmt den Text zwischen den Anführungszeichen, gerade oder typografische, als `{1}` |
   | Aktion | *Ticket anlegen* | |
   | Tickets pro Mail | *Ein Ticket* | |
   | Werte aus dem Mailtext holen | `Link zum Ticket\W*(https?://[^\s<>\])"]+)` | sucht im Text „Link zum Ticket“ und nimmt die Adresse dahinter als `{text1}` |
   | Titel | `{1}` | |
   | Beschreibung | `{text1}` | |
   | Bereich, Priorität | z. B. *Arbeit*, *Normal* | |

3. **Speichern.** Steht vorher eine Regel, die alle Mails nimmt (z. B. „Alle Mails“), schiebst du die neue Regel mit den Pfeilen **über** diese. Regeln werden von oben nach unten geprüft.
4. **Testen**, unten bei der Regel unter **Ausprobieren**: den Betreff einfügen und als Text den Quelltext der Mail, also den HTML-Teil. Die meisten Mailprogramme zeigen ihn über „Quelltext anzeigen“ oder „Nachrichtenquelle“ an, in Thunderbird z. B. *Ansicht → Nachrichtenquelltext*. Alternativ einfach `Link zum Ticket <https://…>` eintippen. Nach **Testen** zeigt Tasklog Titel und Beschreibung des Tickets, das entstehen würde.
5. Unter **Vorschau & Protokoll** siehst du für die echten Mails im Postfach, was daraus würde, ohne dass etwas importiert wird.

**Für andere Mails anpassen:**
- Steht der Titel anders im Betreff, z. B. nach `Auftrag 1234:`, nimmst du das Muster `Auftrag \d+:\s*(.+)`. Was in der Klammer `( )` steht, wird `{1}`.
- Heißt der Link anders, z. B. „Zum Vorgang“, ersetzt du im Text-Muster einfach `Link zum Ticket` durch diesen Text.
- Weitere Klammern im Text-Muster ergeben `{text2}`, `{text3}` …, z. B. `Ticketnummer:\s*(\d+)`.
- Links aus HTML-Mails stehen für die Muster immer als `Linktext <Adresse>` im Text, auch wenn die Mail nur den Linktext zeigt.

### 8.2 Beispiel: ein Ticket pro Link

Für Mails mit einer Liste von Links, z. B. Artikel zum Lesen: *Tickets pro Mail* auf **Pro Treffer**, Muster `^\s*(?:[-*•–·]|\d{1,3}[.)])?\s*(.*?)[\s\[(<:]*((?:https?://|www\.)[^\s\]>)"]+).*$`, Titel `{1|2}` (Text vor dem Link, sonst der Link), Beschreibung `{2}` (der Link). Unter *Treffer überspringen* kannst du Links ausschließen, z. B. `abmelden, impressum`.

---

## 9. Tagesmonitor

Eine Vollbildansicht für ein Wanddisplay, ein altes Tablet oder einen Browser-Tab, ohne Login: heute fällige Tickets, laufender Timer, erfasste Zeit, Uhr und Sensoren.

1. **Admin → Tagesmonitor:** Bausteine und Aktualisierungsintervall wählen.
2. Den Link `PUBLIC_URL/monitor?t=…` auf dem Display öffnen. Für jeden Bereich gibt es einen eigenen Link (`&area=<id>`).

Der Link ist geheim und lässt sich dort jederzeit erneuern.

---

## 10. Funktionen im Überblick

### Tickets anlegen und planen
- **Schnell erfassen:** Der Termin darf einfach im Text stehen. „Oma Arzt Donnerstag 10 Uhr“ wird zum Ticket „Oma Arzt“, fällig Donnerstag 10:00. Erkannt werden heute, morgen, Wochentage, „in 3 Tagen“, „nächste Woche“, Daten wie 5.11. und Uhrzeiten. Mehrere Zeilen werden auf Wunsch mehrere Tickets.
- **Teilen aus WhatsApp & Co. (Android, installierte App):** Nachricht lange drücken → Teilen → Tasklog.
- **Wiederkehrende Tickets:** täglich, werktags, wöchentlich, monatlich, jährlich oder benutzerdefiniert. Ist eines erledigt, entsteht das nächste. Die Schnelleingabe versteht auch „jeden Montag 7 Uhr Müll raus“.
- **Planung:** die nächsten 7 Tage nach Tag, Überfälliges darüber, Ungeplantes daneben. Per Ziehen einplanen (am Handy kurz gedrückt halten).
- **Später:** Das Uhr-Symbol schiebt ein Ticket auf morgen, aufs Wochenende, auf nächste Woche oder auf ein Datum, mit „Rückgängig“.
- **Bearbeiten:** Titel, Beschreibung, Bereich und Projekt über den Stift auf der Ticket-Seite.
- **Zuweisen:** an Mitglieder und Admins. „Meine“ zeigt die eigenen.
- **Checklisten, Notizen, Fotos** pro Ticket. Fotos werden vor dem Hochladen verkleinert.
- **Links** in Beschreibung, Notizen und Checklisten sind klickbar.
- **Kalender-Abo:** Unter *Mehr → Kalender-Abo* gibt es einen geheimen iCal-Link für Google, Apple, Outlook oder Home Assistant.

### Bereiche
Oben in Heute, Tickets, Planung und Zeit steht eine Leiste mit den Bereichen. Ein Tipp zeigt nur diesen Bereich, ein Tipp auf einen anderen wechselt, „Alle“ zeigt wieder alles. Lange drücken (am Desktop Strg/⌘-Klick) kombiniert mehrere Bereiche. Die Auswahl gilt pro Benutzer auf allen Geräten.

### Zeiterfassung
- **Timer** auf der Ticket-Seite oder in den Listen, dazu „+15 min“ & Co.
- **Zeit pro Tag:** Ein Ticket kann über mehrere Tage laufen. In **Admin → Tickets** zeigt „Zeit: Gesamt / Heute / Datum“ den Stundenzettel eines Tages. Ein Klick auf die Zeit eines Tickets zeigt jeden Tag mit seinen Einträgen. Dort lässt sich Zeit für einen vergangenen Tag buchen, bearbeiten, auf ein anderes Ticket umbuchen und löschen. Mitglieder ändern ihre eigenen Einträge, Admins alle.
- **Zeitraster:** *Admin → Einstellungen → Runden auf*: 5/10/15/30 min, eigener Takt (1–480 min) oder **sekundengenau**. Dann zeigt Tasklog überall `1:23:45 h`.
- **Berichte:** *Admin → Zeit-Berichte* nach Bereich, Projekt oder Person, für Woche oder Monat, auch als CSV.

### Offline
Die App merkt sich den letzten Stand und funktioniert ohne Verbindung weiter, oben steht dann „Offline · Stand 12:00“. Anlegen, Abhaken, Bearbeiten, Notizen, Checklisten und Timer gehen weiter. Die Änderungen werden der Reihe nach gesendet, sobald Tasklog wieder erreichbar ist, und Timer behalten die echte Uhrzeit. Fotos, Einstellungen und der Admin-Bereich brauchen eine Verbindung.

### NFC-Tags
Ein Aufkleber, z. B. an der Mülltonne. Handy dranhalten, und Tasklog macht eines davon:
- **Erledigen:** schließt das Ticket. Bei Serien wirkt der Tag danach auf das nächste.
- **Timer:** startet ihn, der nächste Scan stoppt ihn.
- **Ticket anlegen:** z. B. „Entkalken“, nur einmal, solange es offen ist.

Anlegen auf der Ticket-Seite oder unter *Mehr → NFC-Tags*. Chrome auf Android schreibt den Tag direkt aus der App. Sonst den Link mit einer App wie „NFC Tools“ schreiben oder den QR-Code ausdrucken. Auf dem iPhone öffnet sich der Link in Safari, wo man einmal angemeldet sein muss. Bequemer ist dort der Weg über die HA-App (siehe [7.7](#77-mehr-mit-home-assistant)). Geeignet sind NTAG213/215/216-Aufkleber.

---

## 11. Datensicherung

| Was | Wo | Wie sichern |
|---|---|---|
| Datenbank | Docker-Volume `db-data` | Tasklog legt **jede Nacht um 3 Uhr** ein Backup als JSON in `./backups` ab. Diesen Ordner mit deiner normalen Sicherung mitnehmen. |
| Fotos | Docker-Volume `uploads` | Das nächtliche Backup enthält **keine** Fotos. Das Volume extra sichern, siehe unten. |
| Einstellungen | `.env` | Mitsichern, vor allem `COOKIE_SECRET` |

Fotos sichern:
```sh
docker run --rm -v tasklog_uploads:/data -v "$PWD/backups":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```
Der Volume-Name beginnt mit dem Ordnernamen. Den genauen Namen zeigt `docker volume ls`.

**Wiederherstellen:** **Admin → Einstellungen → Backup & Export → Import** und die JSON-Datei wählen. Das ersetzt alle Daten und meldet alle ab. Ein Backup herunterladen geht dort mit *Alles exportieren*.

---

## 12. Aktualisieren

```sh
cd ~/tasklog
docker compose pull && docker compose up -d
```

Damit kommen neue Tasklog-Versionen und Sicherheits-Updates für Node, Alpine und PostgreSQL. Die Datenbank wird beim Start automatisch angepasst. Ein Update etwa einmal im Monat ist eine gute Gewohnheit, Watchtower oder Diun können daran erinnern.

Eine bestimmte Version festhalten: in der `.env` `TASKLOG_IMAGE=lulo464/tasklog:<tag>` (Tags siehe [Docker Hub](https://hub.docker.com/r/lulo464/tasklog/tags)).

---

## 13. Fehlerbehebung

**„Dein Konto gehört zu keiner Tasklog-Gruppe“**
Die Gruppe kommt nicht im Token an. Prüfe, ob du beim Anbieter in `tasklog-admins` oder `tasklog-team` bist und ob die Gruppen mitgeschickt werden (Keycloak: Mapper aus [3.2](#32-keycloak)). Sofortige Abhilfe: `BOOTSTRAP_ADMIN_EMAIL` auf deine Adresse setzen und `docker compose up -d`.

**Anbieter meldet „invalid redirect_uri“**
Die Redirect-URI beim Anbieter muss exakt `<PUBLIC_URL>/auth/callback` sein, mit gleichem `http`/`https`, gleicher Domain und gleichem Port. Prüfe `PUBLIC_URL` in der `.env`.

**Tasklog startet nicht, Log zeigt „AUTH_MODE=oidc needs OIDC_ISSUER …“**
`OIDC_ISSUER` oder `OIDC_CLIENT_ID` fehlt in der `.env`.

**Log zeigt einen Fehler zu `COOKIE_SECRET`**
Es muss mindestens 32 Zeichen lang sein.

**Die App lässt sich nicht installieren, das Teilen-Menü fehlt**
Das klappt nur über HTTPS, siehe [Abschnitt 4](#4-https-und-eigene-adresse).

**„Verbindung testen“ zu Home Assistant schlägt fehl**
Nimm die IP statt `homeassistant.local` und prüfe den Token. Läuft HA nur per HTTPS mit eigenem Zertifikat, nimm die interne `http://`-Adresse.

**Home Assistant meldet 401 beim Webhook**
In der `secrets.yaml` muss `Bearer ` vor dem Token stehen, und der Token braucht das Recht `tickets:write`.

**To-do-Liste wird nicht abgeglichen**
Unter *Admin → Verbindung → To-do-Listen verknüpfen* steht der Fehler direkt beim Bereich. Nötig ist HA 2024.8 oder neuer. Mit „Jetzt abgleichen“ startest du sofort.

**Wo sehe ich, was passiert ist?**
**Admin → Protokoll** zeigt alles, was mit Home Assistant, E-Mail und Kalendern passiert ist. Technische Details liefert `docker compose logs tasklog`.

---

## 14. Datenschutz

- **Keine fremden Server:** Tasklog lädt keine Schriften, Skripte oder Tracker von außen und setzt nur das technisch nötige Anmelde-Cookie, also kein Cookie-Banner nötig.
- **Impressum und Datenschutzerklärung:** unter **Admin → Datenschutz**. „Vorlage einfügen“ erzeugt Texte passend zu deiner Installation, die `[Platzhalter]` ersetzt du selbst. Die Links erscheinen danach auf der Anmeldeseite und unter *Mehr*.
- **Meine Daten:** Jeder lädt unter *Mehr → Meine Daten* seine Daten herunter und kann sein Konto löschen.
- **Aufbewahrung:** Jede Nacht werden abgelaufene Anmeldungen und Protokolle älter als 90 Tage gelöscht, auf Wunsch auch alte erledigte Tickets (*Admin → Datenschutz*).

Nutzt nur deine Familie Tasklog, gilt die DSGVO in der Regel nicht (Haushaltsausnahme). Nutzen andere es mit, brauchst du Impressum und Datenschutzerklärung. Das ist keine Rechtsberatung.

---

## 15. Entwicklung

**Aufbau**
- `server/`: API-Server (Node.js 24, TypeScript, Fastify, PostgreSQL), liefert auch die Oberflächen aus. Migrationen in `server/migrations/`.
- `admin/`: App (`/`), Admin-Oberfläche (`/admin`) und Tagesmonitor (`/monitor`), mit React, Vite und TypeScript.
- `custom_components/tasklog/`: die Home-Assistant-Integration, Tests in `ha-tests/`
- `design/`: Entwürfe und Design-System als Referenz

**Lokal starten** (Node.js 24 und PostgreSQL nötig):
```sh
cd server && npm install
DATABASE_URL=postgres://tasklog:tasklog@localhost:5432/tasklog AUTH_MODE=dev SEED_DEMO=true npm run dev   # Port 8080

cd admin && npm install && npm run dev   # http://localhost:5173, leitet /api und /auth an den Server weiter
```

**Tests**
```sh
cd server && npm test   # braucht eine leere Test-Datenbank: TEST_DATABASE_URL, Standard postgres://tasklog@127.0.0.1:5433/tasklog_test
cd admin && npm test
TASKLOG_URL=… TASKLOG_TOKEN=… pytest -c ha-tests/pytest.ini ha-tests   # HA-Integration gegen ein laufendes Tasklog
```

**Selbst bauen** statt das Image zu holen: `docker compose build --pull && docker compose up -d`. Danach nimmt `docker compose pull` wieder das Image von Docker Hub.

**Automatischer Build (GitHub Actions):** `.github/workflows/docker.yml` testet jeden Push und Pull Request. Nach jedem Merge in `main` baut der Workflow das Image für amd64 und arm64 und lädt es als `latest` und mit kurzem Commit-Hash hoch.

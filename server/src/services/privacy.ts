import type { AppContext } from '../context.js';
import type { Queryable } from '../db.js';
import { HttpError } from '../lib/http.js';

/** Everything Tasklog keeps about a person (Art. 15 and 20 GDPR), as JSON. */
export async function exportUser(db: Queryable, userId: number) {
  const one = async (sql: string) => (await db.query(sql, [userId])).rows;
  const [account] = await one(
    `SELECT id, name, email, oidc_group AS "group", role, created_at AS "createdAt", last_seen_at AS "lastSeenAt",
            area_order AS "areaOrder", hidden_areas AS "hiddenAreas", notify_targets AS "notifyTargets", notify_kinds AS "notifyKinds",
            calendar_token IS NOT NULL AS "calendarFeedActive"
       FROM users WHERE id = $1`,
  );
  if (!account) throw new HttpError(404, 'Benutzer nicht gefunden');
  return {
    format: 'tasklog-personal-data',
    exportedAt: new Date().toISOString(),
    account,
    sessions: await one(`SELECT device, ip, created_at AS "createdAt", last_seen_at AS "lastSeenAt", expires_at AS "expiresAt" FROM sessions WHERE user_id = $1 ORDER BY created_at`),
    assignedTickets: await one(
      `SELECT t.id, t.title, t.description, t.status, a.name AS area, t.due_date AS due, to_char(t.due_time, 'HH24:MI') AS "dueTime",
              t.created_at AS "createdAt", t.done_at AS "doneAt"
         FROM tickets t JOIN areas a ON a.id = t.area_id WHERE t.assignee_id = $1 ORDER BY t.id`,
    ),
    timeEntries: await one(
      `SELECT e.started_at AS "startedAt", e.ended_at AS "endedAt", e.manual, t.id AS "ticketId", t.title AS ticket
         FROM time_entries e JOIN tickets t ON t.id = e.ticket_id WHERE e.user_id = $1 ORDER BY e.started_at`,
    ),
    notes: await one(`SELECT n.ticket_id AS "ticketId", n.body, n.created_at AS "createdAt" FROM ticket_notes n WHERE n.user_id = $1 ORDER BY n.created_at`),
    photos: await one(
      `SELECT ticket_id AS "ticketId", file_name AS "fileName", mime, size, created_at AS "createdAt", '/api/attachments/' || id AS url
         FROM ticket_attachments WHERE user_id = $1 ORDER BY created_at`,
    ),
    arrivalReminders: await one(
      `SELECT person_entity AS "personEntity", zone, notify_service AS "notifyService", enabled, created_at AS "createdAt" FROM presence_rules WHERE user_id = $1`,
    ),
  };
}

/**
 * Deletes a person (Art. 17 GDPR): sign-ins, settings and arrival reminders go; tickets, time, notes and photos stay
 * for the others but no longer name them. The last admin cannot be deleted, so Tasklog keeps someone to run it.
 */
export async function deleteUser(db: Queryable, userId: number): Promise<void> {
  const { rows: [u] } = await db.query<{ role: string; admins: number }>(
    "SELECT role, (SELECT count(*)::int FROM users WHERE role = 'admin') AS admins FROM users WHERE id = $1", [userId],
  );
  if (!u) throw new HttpError(404, 'Benutzer nicht gefunden');
  if (u.role === 'admin' && u.admins <= 1) throw new HttpError(409, 'Der letzte Admin kann nicht gelöscht werden');
  // NFC tags remember who scanned them last by name.
  await db.query('UPDATE tags SET last_scan_by = NULL WHERE last_scan_by = (SELECT name FROM users WHERE id = $1)', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

/** Nightly: removes expired sign-ins, old log entries and, if set, long-done tickets. */
export async function applyRetention(ctx: AppContext): Promise<{ sessions: number; log: number; tickets: number }> {
  const { retention } = await ctx.settings.get();
  const sessions = (await ctx.db.query('DELETE FROM sessions WHERE expires_at < now()')).rowCount ?? 0;
  const log = retention.logDays > 0
    ? (await ctx.db.query("DELETE FROM event_log WHERE at < now() - make_interval(days => $1)", [retention.logDays])).rowCount ?? 0
    : 0;
  const tickets = retention.doneTicketsDays > 0
    ? (await ctx.db.query("DELETE FROM tickets WHERE status = 'done' AND done_at < now() - make_interval(days => $1)", [retention.doneTicketsDays])).rowCount ?? 0
    : 0;
  return { sessions, log, tickets };
}

/** A starting point for the privacy notice, filled with what this installation actually does. */
export async function privacyTemplate(ctx: AppContext): Promise<{ imprint: string; privacy: string }> {
  const s = await ctx.settings.get();
  const { config, db } = ctx;
  const has = async (sql: string) => Boolean((await db.query(sql)).rowCount);
  const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
  const mail = await has('SELECT 1 FROM mail_accounts LIMIT 1');
  const presence = await has('SELECT 1 FROM presence_rules LIMIT 1');
  const photos = await has('SELECT 1 FROM ticket_attachments LIMIT 1');
  const haHost = s.ha.url ? host(s.ha.url) : null;
  const login = config.AUTH_MODE === 'oidc' && config.OIDC_ISSUER ? host(config.OIDC_ISSUER) : null;
  const keep = (days: number, otherwise: string) => (days > 0 ? `${days} Tage` : otherwise);
  const today = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: config.TZ });

  const imprint = `# Impressum

Angaben gemäß § 5 DDG

[Vor- und Nachname bzw. Name des Vereins / der Firma]
[Straße und Hausnummer]
[PLZ Ort]

## Kontakt
E-Mail: [E-Mail-Adresse]
[Telefon (freiwillig)]

[Bei Firmen zusätzlich: Vertretungsberechtigte, Registergericht und -nummer, USt-IdNr.]
`;

  const privacy = `# Datenschutzerklärung

Stand: ${today}

## Verantwortlich
[Name]
[Anschrift]
E-Mail: [E-Mail-Adresse]

## Worum es geht
Tasklog unter ${config.PUBLIC_URL} ist eine selbst betriebene Anwendung für Aufgaben und Zeiterfassung. Sie läuft auf unserem eigenen Server; es gibt keinen externen Anbieter, keine Werbung, keine Tracker und keine Schriften oder Skripte von fremden Servern.

## Welche Daten wir verarbeiten
- **Konto:** Name, E-Mail-Adresse, Gruppe und Rolle${login ? ` – übermittelt vom Anmeldedienst ${login}` : ''}, Zeitpunkt der letzten Nutzung.
- **Anmeldung:** ein Sitzungs-Cookie sowie Gerät/Browser und IP-Adresse der Sitzung, bis sie nach ${config.SESSION_DAYS} Tagen abläuft oder du dich abmeldest.
- **Inhalte, die du anlegst:** Tickets, Beschreibungen, Notizen, Checklisten${photos ? ', Fotos' : ''} und erfasste Zeiten.
- **Deine Einstellungen:** sichtbare Bereiche, gewählte Geräte für Benachrichtigungen, Kalender-Abo.
${presence ? '- **Anwesenheit (nur, wenn du es selbst einrichtest):** Tasklog fragt bei Home Assistant ab, ob deine Person in einer Zone (z. B. „Zuhause“) ist, um dich beim Ankommen zu erinnern. Es wird nur der jeweils letzte Zustand gespeichert, kein Standortverlauf.\n' : ''}${mail ? '- **E-Mail-Import:** Absender, Betreff und Text von Mails aus dem eingebundenen Postfach werden zu Tickets.\n' : ''}- **Protokoll:** technische Ereignisse (z. B. versandte Benachrichtigungen) für die Fehlersuche.

## Zwecke und Rechtsgrundlagen
- Aufgaben organisieren und Zeiten erfassen: Art. 6 Abs. 1 lit. b DSGVO bzw. unser berechtigtes Interesse an einer funktionierenden Organisation (Art. 6 Abs. 1 lit. f DSGVO). [Bei Beschäftigten: § 26 BDSG.]
- Sicherheit der Anmeldung (Sitzung, IP-Adresse): Art. 6 Abs. 1 lit. f DSGVO.
${presence ? '- Erinnerung bei Ankunft: deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Du widerrufst sie, indem du die Erinnerung löschst.\n' : ''}
## Empfänger
Wir geben keine Daten an Dritte weiter.${haHost ? ` Benachrichtigungen und Anwesenheit laufen über unser eigenes Home Assistant (${haHost}).` : ''}${login ? ` Die Anmeldung läuft über ${login}.` : ''}

## Speicherdauer
- Konto und Inhalte: solange dein Konto besteht; erledigte Tickets: ${keep(s.retention.doneTicketsDays, 'bis sie gelöscht werden')}.
- Protokoll: ${keep(s.retention.logDays, 'bis es gelöscht wird')}.
- Sitzungen: bis zu ihrem Ablauf.
- Sicherungskopien: [Anzahl] Tage.

## Cookies
Tasklog setzt nur ein technisch notwendiges Cookie für die Anmeldung. Dafür ist keine Einwilligung nötig (§ 25 Abs. 2 TDDDG).

## Deine Rechte
Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Deine Daten kannst du in der App unter **Mehr → Meine Daten** selbst herunterladen und dein Konto dort löschen. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren.
`;
  return { imprint, privacy };
}

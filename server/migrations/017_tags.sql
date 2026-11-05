-- NFC tags (or QR codes): scanning one closes a ticket, starts/stops its timer or creates a ticket.
-- code goes into the URL written on the tag; ha_tag_id links a tag scanned with the Home Assistant app.
-- ticket_id is the ticket the tag works on; for "create" the last ticket it created.
CREATE TABLE tags (
  id           serial PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  action       text NOT NULL CHECK (action IN ('done', 'timer', 'create')),
  ticket_id    integer REFERENCES tickets(id) ON DELETE SET NULL,
  title        text,
  area_id      integer REFERENCES areas(id) ON DELETE CASCADE,
  prio         text NOT NULL DEFAULT 'normal' CHECK (prio IN ('normal', 'high')),
  ha_tag_id    text UNIQUE,
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  scans        integer NOT NULL DEFAULT 0,
  last_scan_at timestamptz,
  last_scan_by text
);

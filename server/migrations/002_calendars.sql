-- Home Assistant calendars (e.g. waste collection) whose events become tickets.

CREATE TABLE calendar_sources (
  id             serial PRIMARY KEY,
  entity_id      text NOT NULL UNIQUE,              -- e.g. calendar.abfall_io
  name           text NOT NULL,
  area_id        int  NOT NULL REFERENCES areas,
  title_template text NOT NULL DEFAULT '{title} rausstellen',
  lead_days      int  NOT NULL DEFAULT 1 CHECK (lead_days BETWEEN 0 AND 14),       -- ticket due this many days before the event
  lookahead_days int  NOT NULL DEFAULT 14 CHECK (lookahead_days BETWEEN 1 AND 90), -- create tickets this far ahead
  prio           text NOT NULL DEFAULT 'normal' CHECK (prio IN ('normal', 'high')),
  auto_close     boolean NOT NULL DEFAULT true,     -- close open tickets once the event day is over
  enabled        boolean NOT NULL DEFAULT true,
  last_sync_at   timestamptz,
  last_error     text
);

-- One row per imported event, so an event never creates a second ticket
-- (also not after its ticket was deleted).
CREATE TABLE calendar_imports (
  source_id  int  NOT NULL REFERENCES calendar_sources ON DELETE CASCADE,
  event_key  text NOT NULL,                         -- "<date>|<summary>"
  event_date date NOT NULL,
  ticket_id  int  REFERENCES tickets ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, event_key)
);

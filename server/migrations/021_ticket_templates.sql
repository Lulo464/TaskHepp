-- Templates: one click creates several tickets, e.g. "Urlaub vorbereiten". Each item is a ticket, with its due date
-- counted from a date chosen when using it ("7 days before the trip"): {"title", "description", "prio",
-- "offsetDays" (null = no date), "dueTime", "checklist": [...]}.
CREATE TABLE ticket_templates (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  icon       text NOT NULL DEFAULT 'stack',
  area_id    integer REFERENCES areas(id) ON DELETE SET NULL,
  items      jsonb NOT NULL DEFAULT '[]',
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

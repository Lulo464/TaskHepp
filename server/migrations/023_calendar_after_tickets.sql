-- A second ticket per calendar event, e.g. "Restmüll wieder reinstellen" a day after "Restmüll rausstellen".
-- after_days counts from the first ticket's due date.
ALTER TABLE calendar_sources
  ADD COLUMN after_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN after_title_template text NOT NULL DEFAULT '{title} wieder reinstellen',
  ADD COLUMN after_days           int NOT NULL DEFAULT 1 CHECK (after_days BETWEEN 0 AND 14),
  ADD COLUMN after_due_time       time;

-- after_created: made once, so a deleted "wieder reinstellen" ticket does not come back.
ALTER TABLE calendar_imports
  ADD COLUMN after_ticket_id int REFERENCES tickets ON DELETE SET NULL,
  ADD COLUMN after_created   boolean NOT NULL DEFAULT false;

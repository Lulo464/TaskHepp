-- Optional time of day for the due date, e.g. "Müll rausstellen, Mittwoch 19:00".
ALTER TABLE tickets ADD COLUMN due_time time;
-- When the "due soon" reminder went out, so it is sent once per due time.
ALTER TABLE tickets ADD COLUMN due_notified_at timestamptz;
-- Time of day for tickets created from a calendar (NULL = whole day).
ALTER TABLE calendar_sources ADD COLUMN due_time time;

-- Repeating tickets: when one is done, the next one is created (followup_id) with the date from recurrence,
-- e.g. {"every": 1, "unit": "week", "weekdays": [1]} = every Monday.
ALTER TABLE tickets
  ADD COLUMN recurrence  jsonb,
  -- Deferred so a backup restore may insert a ticket before the follow-up it points to.
  ADD COLUMN followup_id int REFERENCES tickets ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- An area can be linked to an existing Home Assistant to-do list (todo.einkaufsliste …); both stay in step.
ALTER TABLE areas
  ADD COLUMN ha_todo_entity    text,
  ADD COLUMN ha_todo_synced_at timestamptz,
  ADD COLUMN ha_todo_error     text;

-- One row per item that exists on both sides. summary/done are what both sides last agreed on, so a sync can tell
-- which side changed since. ticket_id becomes NULL when the ticket is deleted in Tasklog (then the item goes too).
CREATE TABLE ha_todo_links (
  id        serial PRIMARY KEY,
  area_id   integer NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  entity    text NOT NULL,
  uid       text NOT NULL,
  ticket_id integer REFERENCES tickets(id) ON DELETE SET NULL,
  summary   text NOT NULL,
  done      boolean NOT NULL,
  UNIQUE (entity, uid)
);

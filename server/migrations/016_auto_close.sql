-- "Erledigt, wenn …": a ticket closes itself when a Home Assistant entity changes to a state,
-- e.g. {"entity": "sensor.waschmaschine", "state": "idle"}. auto_close_seen remembers the last state seen.
ALTER TABLE tickets
  ADD COLUMN auto_close      jsonb,
  ADD COLUMN auto_close_seen text;

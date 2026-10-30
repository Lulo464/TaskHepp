-- "Wenn ich nach Hause komme": when a Home Assistant person enters a zone, the user gets what is due there.
CREATE TABLE presence_rules (
  id               serial PRIMARY KEY,
  user_id          int  NOT NULL REFERENCES users ON DELETE CASCADE,
  person_entity    text NOT NULL,                 -- person.lukas or device_tracker.handy
  zone             text NOT NULL DEFAULT 'home',  -- the person's state in that zone: 'home' or the zone's name
  area_id          int  REFERENCES areas ON DELETE CASCADE, -- NULL = all areas
  notify_service   text NOT NULL DEFAULT 'notify', -- notify.<service>, e.g. mobile_app_pixel_8
  include_undated  boolean NOT NULL DEFAULT false,
  enabled          boolean NOT NULL DEFAULT true,
  last_state       text,
  last_notified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX presence_rules_user_idx ON presence_rules (user_id);

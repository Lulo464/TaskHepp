-- Two-way calendar (CalDAV): each user signs in with an own calendar password (only its hash is kept).
ALTER TABLE users
  ADD COLUMN dav_password_hash text,
  ADD COLUMN dav_password_at   timestamptz;

-- A ticket created in a calendar app keeps the file name and UID the app chose, so the app finds it again.
ALTER TABLE tickets
  ADD COLUMN dav_href text,
  ADD COLUMN dav_uid  text;
CREATE INDEX tickets_dav_href_idx ON tickets (dav_href) WHERE dav_href IS NOT NULL;
CREATE INDEX tickets_dav_uid_idx ON tickets (dav_uid) WHERE dav_uid IS NOT NULL;

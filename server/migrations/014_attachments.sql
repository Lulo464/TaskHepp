-- Photos attached to tickets. The files live in UPLOAD_DIR under storage_key; this table holds what belongs where.
CREATE TABLE ticket_attachments (
  id          serial PRIMARY KEY,
  ticket_id   int  NOT NULL REFERENCES tickets ON DELETE CASCADE,
  user_id     int  REFERENCES users ON DELETE SET NULL,
  storage_key text NOT NULL UNIQUE,
  file_name   text NOT NULL,
  mime        text NOT NULL,
  size        int  NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_attachments_ticket_idx ON ticket_attachments (ticket_id);

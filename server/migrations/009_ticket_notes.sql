-- Notes users attach to a ticket, newest last.
CREATE TABLE ticket_notes (
  id         serial PRIMARY KEY,
  ticket_id  int  NOT NULL REFERENCES tickets ON DELETE CASCADE,
  user_id    int  REFERENCES users ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_notes_ticket_idx ON ticket_notes (ticket_id);

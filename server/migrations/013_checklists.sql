-- Checklist items inside a ticket, e.g. "Einkauf" with Milch, Brot, Eier.
CREATE TABLE ticket_checklist (
  id         serial PRIMARY KEY,
  ticket_id  int  NOT NULL REFERENCES tickets ON DELETE CASCADE,
  text       text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  position   int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_checklist_ticket_idx ON ticket_checklist (ticket_id, position);

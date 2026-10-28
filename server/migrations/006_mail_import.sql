-- Mail import: IMAP mailboxes whose messages become tickets according to rules.

ALTER TABLE tickets DROP CONSTRAINT tickets_source_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_source_check CHECK (source IN ('manual', 'app', 'ha', 'mail'));

CREATE TABLE mail_accounts (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  host          text NOT NULL,
  port          int  NOT NULL DEFAULT 993,
  tls           text NOT NULL DEFAULT 'tls' CHECK (tls IN ('tls', 'starttls', 'none')),
  username      text NOT NULL,
  password_enc  text NOT NULL DEFAULT '',          -- AES-256-GCM, key derived from COOKIE_SECRET
  mailbox       text NOT NULL DEFAULT 'INBOX',
  poll_minutes  int  NOT NULL DEFAULT 5 CHECK (poll_minutes BETWEEN 1 AND 1440),
  only_unseen   boolean NOT NULL DEFAULT true,
  after_import  text NOT NULL DEFAULT 'seen' CHECK (after_import IN ('seen', 'move', 'delete', 'none')),
  move_to       text NOT NULL DEFAULT '',
  enabled       boolean NOT NULL DEFAULT true,
  uid_validity  bigint,                            -- with last_uid: where the next poll continues
  last_uid      bigint,
  last_poll_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Checked in position order; the first match decides unless it says to go on.
CREATE TABLE mail_rules (
  id                   serial PRIMARY KEY,
  account_id           int  NOT NULL REFERENCES mail_accounts ON DELETE CASCADE,
  position             int  NOT NULL DEFAULT 0,
  name                 text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  -- conditions (empty = any; all given ones must match, case-insensitive)
  from_contains        text NOT NULL DEFAULT '',
  subject_contains     text NOT NULL DEFAULT '',
  body_contains        text NOT NULL DEFAULT '',
  subject_pattern      text NOT NULL DEFAULT '',   -- regex; its groups are {1}, {2} … in the templates
  -- what happens
  action               text NOT NULL DEFAULT 'ticket' CHECK (action IN ('ticket', 'ignore')),
  split                text NOT NULL DEFAULT 'none' CHECK (split IN ('none', 'lines', 'bullets', 'pattern')),
  split_pattern        text NOT NULL DEFAULT '',   -- regex for split = 'pattern'; each match is one ticket
  title_template       text NOT NULL DEFAULT '{subject}',
  description_template text NOT NULL DEFAULT '{body}',
  area_id              int REFERENCES areas ON DELETE SET NULL,
  prio                 text NOT NULL DEFAULT 'normal' CHECK (prio IN ('normal', 'high')),
  due_mode             text NOT NULL DEFAULT 'none' CHECK (due_mode IN ('none', 'days', 'detect')),
  due_days             int  NOT NULL DEFAULT 0 CHECK (due_days BETWEEN 0 AND 365),
  due_time             time,
  continue_after       boolean NOT NULL DEFAULT false
);
CREATE INDEX mail_rules_account_idx ON mail_rules (account_id, position);

-- Every processed message once, so nothing is imported twice (also unread ones that stay in the inbox).
CREATE TABLE mail_imports (
  id          bigserial PRIMARY KEY,
  account_id  int  NOT NULL REFERENCES mail_accounts ON DELETE CASCADE,
  message_key text NOT NULL,                       -- Message-ID, or uidvalidity:uid without one
  uid         bigint,
  received_at timestamptz,
  from_text   text NOT NULL DEFAULT '',
  subject     text NOT NULL DEFAULT '',
  rule_ids    int[] NOT NULL DEFAULT '{}',
  ticket_ids  int[] NOT NULL DEFAULT '{}',
  result      text NOT NULL CHECK (result IN ('created', 'ignored', 'nomatch', 'error')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, message_key)
);
CREATE INDEX mail_imports_recent_idx ON mail_imports (account_id, created_at DESC);

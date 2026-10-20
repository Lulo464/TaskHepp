-- Tasklog schema. Enum-like columns use text + CHECK so new values only need a migration, not a type change.

CREATE TABLE areas (
  id           serial PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  icon         text NOT NULL DEFAULT 'folder',
  default_prio text NOT NULL DEFAULT 'normal' CHECK (default_prio IN ('normal', 'high')),
  position     int  NOT NULL DEFAULT 0
);

CREATE TABLE projects (
  id       serial PRIMARY KEY,
  area_id  int  NOT NULL REFERENCES areas ON DELETE CASCADE,
  name     text NOT NULL,
  position int  NOT NULL DEFAULT 0,
  UNIQUE (area_id, name)
);

CREATE TABLE users (
  id            serial PRIMARY KEY,
  subject       text UNIQUE,                       -- OIDC "sub"; NULL until first login
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  oidc_group    text,
  role          text NOT NULL DEFAULT 'read' CHECK (role IN ('admin', 'member', 'read')),
  role_override boolean NOT NULL DEFAULT false,    -- set when an admin changed the role by hand
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Which OIDC group grants which role.
CREATE TABLE group_roles (
  oidc_group text PRIMARY KEY,
  role       text NOT NULL CHECK (role IN ('admin', 'member', 'read'))
);

CREATE TABLE rules (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  entity       text NOT NULL,
  cond         text NOT NULL,
  join_op      text NOT NULL DEFAULT 'and' CHECK (join_op IN ('and', 'or')),
  cond2        text NOT NULL DEFAULT '',
  time_window  text NOT NULL DEFAULT '00:00–23:59',
  ticket_title text NOT NULL,
  area_id      int  NOT NULL REFERENCES areas,
  prio         text NOT NULL DEFAULT 'normal' CHECK (prio IN ('normal', 'high')),
  on_end       text NOT NULL DEFAULT 'close' CHECK (on_end IN ('close', 'keepOpen')),
  dedupe       boolean NOT NULL DEFAULT true,
  enabled      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id          serial PRIMARY KEY,
  title       text NOT NULL,
  area_id     int  NOT NULL REFERENCES areas,
  project_id  int  REFERENCES projects ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'inProgress', 'done')),
  prio        text NOT NULL DEFAULT 'normal' CHECK (prio IN ('normal', 'high')),
  assignee_id int  REFERENCES users ON DELETE SET NULL,
  due_date    date,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'app', 'ha')),
  rule_id     int  REFERENCES rules ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz
);
CREATE INDEX tickets_status_idx ON tickets (status);
CREATE INDEX tickets_rule_open_idx ON tickets (rule_id) WHERE status <> 'done';

-- A running timer has ended_at NULL. Manual entries are stored as a closed interval.
CREATE TABLE time_entries (
  id         serial PRIMARY KEY,
  ticket_id  int NOT NULL REFERENCES tickets ON DELETE CASCADE,
  user_id    int REFERENCES users ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX time_entries_ticket_idx ON time_entries (ticket_id);
CREATE INDEX time_entries_running_idx ON time_entries (user_id) WHERE ended_at IS NULL;

-- Sensors Tasklog publishes to Home Assistant.
CREATE TABLE published_entities (
  entity_id  text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT true,
  position   int NOT NULL DEFAULT 0,
  last_state text
);

CREATE TABLE api_tokens (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  prefix       text NOT NULL,                 -- shown in the UI, e.g. tl_live_8f3c
  token_hash   text NOT NULL UNIQUE,          -- sha256 of the full token
  scope        text NOT NULL CHECK (scope IN ('read', 'tickets:write', 'admin')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE sessions (
  id           text PRIMARY KEY,              -- sha256 of the cookie value
  user_id      int NOT NULL REFERENCES users ON DELETE CASCADE,
  device       text NOT NULL DEFAULT '',
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE TABLE event_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  direction  text NOT NULL CHECK (direction IN ('in', 'out')),
  message    text NOT NULL,
  status     text NOT NULL CHECK (status IN ('rejected', 'sent', 'ignored', 'done', 'error')),
  payload    jsonb,                           -- what a retry needs to replay the event
  retried_at timestamptz
);
CREATE INDEX event_log_at_idx ON event_log (at DESC);

-- Key/value settings; the app merges stored values over its defaults.
CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO group_roles (oidc_group, role) VALUES
  ('tasklog-admins', 'admin'),
  ('tasklog-team', 'member'),
  ('tasklog-guests', 'read');

INSERT INTO published_entities (entity_id, enabled, position) VALUES
  ('sensor.tasklog_open_tickets', true, 0),
  ('sensor.tasklog_today_time', true, 1),
  ('binary_sensor.tasklog_timer_running', true, 2),
  ('binary_sensor.tasklog_overdue', false, 3),
  ('sensor.tasklog_next_due', true, 4);

-- Each user's own notifications through Home Assistant: which notify services (their phones, tablets …) and which kinds.
ALTER TABLE users
  ADD COLUMN notify_targets text[] NOT NULL DEFAULT '{}',
  -- {"dueSoon": false, …}; a kind that is not listed is on.
  ADD COLUMN notify_kinds   jsonb  NOT NULL DEFAULT '{}';

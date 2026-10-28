-- Each user's own view of the areas in the app: order (area ids, first = top) and hidden areas.
ALTER TABLE users
  ADD COLUMN area_order   int[] NOT NULL DEFAULT '{}',
  ADD COLUMN hidden_areas int[] NOT NULL DEFAULT '{}';

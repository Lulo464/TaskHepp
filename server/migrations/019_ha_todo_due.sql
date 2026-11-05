-- Due date and description of linked to-do items, as both sides last agreed ("2030-06-01" or "2030-06-01 18:30";
-- '' = none). NULL = not known yet (links from before): then what Home Assistant has wins once.
ALTER TABLE ha_todo_links
  ADD COLUMN due         text,
  ADD COLUMN description text;

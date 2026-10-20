-- Free-text description shown in the app's ticket detail.
ALTER TABLE tickets ADD COLUMN description text NOT NULL DEFAULT '';

-- Time added by hand (+15 min …) rather than measured by a timer; shown differently in the history.
ALTER TABLE time_entries ADD COLUMN manual boolean NOT NULL DEFAULT false;

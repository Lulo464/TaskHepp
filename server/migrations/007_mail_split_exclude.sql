-- Hits (lines, bullets, pattern matches) containing one of these comma-separated words are skipped,
-- e.g. 'herbrand.de, abmelden'.
ALTER TABLE mail_rules ADD COLUMN split_exclude text NOT NULL DEFAULT '';

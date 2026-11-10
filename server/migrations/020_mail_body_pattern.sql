-- A pattern on the mail text whose groups become {text1}, {text2} … (and named groups), e.g. the link behind
-- "Link zum Ticket". It only extracts values; a mail it does not match still gets its ticket.
ALTER TABLE mail_rules ADD COLUMN body_pattern text NOT NULL DEFAULT '';

-- Secret per user for the calendar subscription (iCal feed) of their tickets.
ALTER TABLE users ADD COLUMN calendar_token text UNIQUE;

-- Event titles (waste types) of a calendar that should not become tickets, e.g. 'Restabfall 1,1 m³'.
ALTER TABLE calendar_sources ADD COLUMN excluded_types text[] NOT NULL DEFAULT '{}';

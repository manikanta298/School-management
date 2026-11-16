-- School events belong to exactly one school (school_id was added and backfilled in migration 018).
-- Reads and writes are filtered by the active school in the routes; this index supports those queries.
CREATE INDEX school_events_school_dates_idx ON school_events(school_id, starts_on, ends_on);

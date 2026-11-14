CREATE TABLE school_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title varchar(150) NOT NULL CHECK(length(trim(title))>0),
 description varchar(1000),
 event_type varchar(10) NOT NULL CHECK(event_type IN ('holiday','event','exam','meeting')),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on>=starts_on)
);
CREATE INDEX school_events_dates_idx ON school_events(starts_on,ends_on);
CREATE INDEX school_events_creator_idx ON school_events(created_by);

-- Enforce school ownership throughout transport relationships.
-- Migration 018 has already populated school_id for every existing row.
BEGIN;

ALTER TABLE transport_vehicles
  ADD CONSTRAINT transport_vehicles_id_school_unique UNIQUE (id, school_id);
ALTER TABLE transport_routes
  ADD CONSTRAINT transport_routes_id_school_unique UNIQUE (id, school_id);
ALTER TABLE transport_stops
  ADD CONSTRAINT transport_stops_id_school_unique UNIQUE (id, school_id);
ALTER TABLE students
  ADD CONSTRAINT students_id_school_unique UNIQUE (id, school_id);
ALTER TABLE academic_years
  ADD CONSTRAINT academic_years_id_school_unique UNIQUE (id, school_id);

-- Permit the same registration and route name in different schools.
ALTER TABLE transport_vehicles
  DROP CONSTRAINT IF EXISTS transport_vehicles_registration_number_key;
CREATE UNIQUE INDEX transport_vehicles_school_registration_unique
  ON transport_vehicles(school_id, registration_number);
DROP INDEX IF EXISTS transport_routes_name_unique;
CREATE UNIQUE INDEX transport_routes_school_name_unique
  ON transport_routes(school_id, lower(name));

ALTER TABLE transport_routes
  ADD CONSTRAINT transport_routes_vehicle_same_school_fk
  FOREIGN KEY (vehicle_id, school_id)
  REFERENCES transport_vehicles(id, school_id)
  ON DELETE RESTRICT;

ALTER TABLE transport_stops
  ADD CONSTRAINT transport_stops_route_same_school_fk
  FOREIGN KEY (route_id, school_id)
  REFERENCES transport_routes(id, school_id)
  ON DELETE RESTRICT;

ALTER TABLE transport_allocations
  ADD CONSTRAINT transport_allocations_student_same_school_fk
  FOREIGN KEY (student_id, school_id)
  REFERENCES students(id, school_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT transport_allocations_stop_same_school_fk
  FOREIGN KEY (stop_id, school_id)
  REFERENCES transport_stops(id, school_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT transport_allocations_year_same_school_fk
  FOREIGN KEY (academic_year_id, school_id)
  REFERENCES academic_years(id, school_id)
  ON DELETE RESTRICT;

CREATE INDEX transport_vehicles_school_idx ON transport_vehicles(school_id);
CREATE INDEX transport_routes_school_idx ON transport_routes(school_id);
CREATE INDEX transport_stops_school_idx ON transport_stops(school_id);
CREATE INDEX transport_allocations_school_idx ON transport_allocations(school_id);
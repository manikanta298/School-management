CREATE TABLE transport_vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 registration_number varchar(20) NOT NULL UNIQUE CHECK(registration_number ~ '^[A-Z0-9 -]{4,20}$'),
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 200),
 driver_name varchar(100) CHECK(driver_name IS NULL OR length(trim(driver_name))>0),
 driver_phone varchar(30) CHECK(driver_phone IS NULL OR driver_phone ~ '^[+0-9() .-]{7,30}$'),
 insurance_expiry date,
 permit_expiry date,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE transport_routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 vehicle_id uuid REFERENCES transport_vehicles(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transport_routes_name_unique ON transport_routes(lower(name));
CREATE INDEX transport_routes_vehicle_idx ON transport_routes(vehicle_id);
CREATE TABLE transport_stops (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 route_id uuid NOT NULL REFERENCES transport_routes(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 200),
 UNIQUE(route_id,sequence)
);
CREATE TABLE transport_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 stop_id uuid NOT NULL REFERENCES transport_stops(id) ON DELETE RESTRICT,
 academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(student_id,academic_year_id)
);
CREATE INDEX transport_allocations_stop_idx ON transport_allocations(stop_id);
CREATE INDEX transport_allocations_year_idx ON transport_allocations(academic_year_id);
CREATE FUNCTION validate_transport_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE vehicle uuid; seats integer; used integer;
BEGIN
 SELECT r.vehicle_id INTO vehicle FROM transport_stops s JOIN transport_routes r ON r.id=s.route_id WHERE s.id=NEW.stop_id;
 IF vehicle IS NULL THEN RETURN NEW; END IF;
 SELECT capacity INTO seats FROM transport_vehicles WHERE id=vehicle FOR UPDATE;
 SELECT count(*) INTO used FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.vehicle_id=vehicle AND a.academic_year_id=NEW.academic_year_id AND a.id<>NEW.id;
 IF used>=seats THEN RAISE EXCEPTION 'Vehicle capacity reached' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER transport_allocations_validate BEFORE INSERT OR UPDATE ON transport_allocations FOR EACH ROW EXECUTE FUNCTION validate_transport_allocation();
CREATE FUNCTION check_vehicle_load(vehicle uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.vehicle_id=vehicle GROUP BY a.academic_year_id HAVING count(*)>(SELECT capacity FROM transport_vehicles WHERE id=vehicle)) THEN
 RAISE EXCEPTION 'Vehicle capacity is below its allocated students' USING ERRCODE='23514'; END IF;
END; $$;
CREATE FUNCTION transport_vehicle_load_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.vehicle_id IS NOT NULL THEN PERFORM check_vehicle_load(NEW.vehicle_id); END IF; RETURN NEW; END; $$;
CREATE TRIGGER transport_routes_load AFTER UPDATE OF vehicle_id ON transport_routes FOR EACH ROW EXECUTE FUNCTION transport_vehicle_load_guard();
CREATE FUNCTION transport_capacity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM check_vehicle_load(NEW.id); RETURN NEW; END; $$;
CREATE TRIGGER transport_vehicles_capacity AFTER UPDATE OF capacity ON transport_vehicles FOR EACH ROW EXECUTE FUNCTION transport_capacity_guard();

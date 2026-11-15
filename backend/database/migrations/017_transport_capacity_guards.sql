CREATE OR REPLACE FUNCTION validate_transport_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE vehicle uuid; seats integer; used integer;
BEGIN
 SELECT r.vehicle_id INTO vehicle FROM transport_stops s JOIN transport_routes r ON r.id=s.route_id WHERE s.id=NEW.stop_id FOR SHARE OF r;
 IF vehicle IS NULL THEN RETURN NEW; END IF;
 SELECT capacity INTO seats FROM transport_vehicles WHERE id=vehicle FOR UPDATE;
 SELECT count(*) INTO used FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.vehicle_id=vehicle AND a.academic_year_id=NEW.academic_year_id AND a.id<>NEW.id;
 IF used>=seats THEN RAISE EXCEPTION 'Vehicle capacity reached' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION validate_transport_route_vehicle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seats integer;
BEGIN
 IF NEW.vehicle_id IS NULL OR NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id THEN RETURN NEW; END IF;
 SELECT capacity INTO seats FROM transport_vehicles WHERE id=NEW.vehicle_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF EXISTS(
  SELECT 1 FROM (
   SELECT a.academic_year_id FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.vehicle_id=NEW.vehicle_id AND r.id<>NEW.id
   UNION
   SELECT a.academic_year_id FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.id=NEW.id
  ) years
  WHERE (SELECT count(*) FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.vehicle_id=NEW.vehicle_id AND r.id<>NEW.id AND a.academic_year_id=years.academic_year_id)
   +(SELECT count(*) FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.id=NEW.id AND a.academic_year_id=years.academic_year_id)>seats
 ) THEN RAISE EXCEPTION 'Vehicle capacity reached' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER transport_routes_load ON transport_routes;
CREATE TRIGGER transport_routes_load BEFORE UPDATE OF vehicle_id ON transport_routes FOR EACH ROW EXECUTE FUNCTION validate_transport_route_vehicle();

CREATE FUNCTION validate_transport_vehicle_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.vehicle_id=NEW.id GROUP BY a.academic_year_id HAVING count(*)>NEW.capacity) THEN
  RAISE EXCEPTION 'Vehicle capacity is below its allocated students' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER transport_vehicles_capacity ON transport_vehicles;
CREATE TRIGGER transport_vehicles_capacity BEFORE UPDATE OF capacity ON transport_vehicles FOR EACH ROW EXECUTE FUNCTION validate_transport_vehicle_capacity();
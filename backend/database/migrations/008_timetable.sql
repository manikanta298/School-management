CREATE TABLE school_rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 location varchar(200),active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE UNIQUE INDEX school_rooms_name_unique ON school_rooms(lower(name));
CREATE TABLE timetable_slots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),section_id uuid NOT NULL,class_id uuid NOT NULL,academic_year_id uuid NOT NULL,
 assignment_id uuid REFERENCES teacher_assignments(id) ON DELETE SET NULL,
 teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
 subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
 room_id uuid REFERENCES school_rooms(id) ON DELETE RESTRICT,
 weekday integer NOT NULL CHECK(weekday BETWEEN 1 AND 7),
 start_minute integer NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
 end_minute integer NOT NULL CHECK(end_minute BETWEEN 1 AND 1440 AND end_minute>start_minute),
 effective_from date NOT NULL,effective_to date NOT NULL CHECK(effective_to>=effective_from),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 changed_by uuid REFERENCES users(id) ON DELETE RESTRICT,change_note varchar(200),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT active OR assignment_id IS NOT NULL),
 FOREIGN KEY(section_id,class_id) REFERENCES sections(id,class_id) ON DELETE RESTRICT,
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT
);
CREATE INDEX timetable_slots_section_idx ON timetable_slots(section_id,weekday,effective_from,effective_to) WHERE active;
CREATE INDEX timetable_slots_teacher_idx ON timetable_slots(teacher_id,weekday,effective_from,effective_to) WHERE active;
CREATE INDEX timetable_slots_room_idx ON timetable_slots(room_id,weekday,effective_from,effective_to) WHERE active AND room_id IS NOT NULL;
CREATE INDEX timetable_slots_section_fk_idx ON timetable_slots(section_id,class_id);
CREATE INDEX timetable_slots_class_year_idx ON timetable_slots(class_id,academic_year_id);
CREATE INDEX timetable_slots_year_idx ON timetable_slots(academic_year_id);
CREATE INDEX timetable_slots_assignment_idx ON timetable_slots(assignment_id);
CREATE INDEX timetable_slots_teacher_fk_idx ON timetable_slots(teacher_id);
CREATE INDEX timetable_slots_subject_idx ON timetable_slots(subject_id);
CREATE INDEX timetable_slots_room_fk_idx ON timetable_slots(room_id);
CREATE INDEX timetable_slots_creator_idx ON timetable_slots(created_by);
CREATE INDEX timetable_slots_actor_idx ON timetable_slots(changed_by);
CREATE TABLE timetable_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,slot_id uuid NOT NULL REFERENCES timetable_slots(id) ON DELETE RESTRICT,
 action varchar(12) NOT NULL CHECK(action IN ('created','updated','deactivated','reactivated','detached')),
 previous_values jsonb,new_values jsonb NOT NULL,
 actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,note varchar(200),occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timetable_audit_slot_idx ON timetable_audit(slot_id,id);
CREATE INDEX timetable_audit_actor_idx ON timetable_audit(actor_id);
CREATE FUNCTION timetable_first_weekday(day date,w integer) RETURNS date LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT day+((w-extract(isodow FROM day)::integer+7)%7); $$;
CREATE FUNCTION guard_timetable_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE exyear academic_years;assignment teacher_assignments;emp teachers;account_active boolean;room_active boolean;lock_key text;
BEGIN
 IF TG_OP='UPDATE' THEN
 IF (NEW.id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Slot identity is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.assignment_id IS NOT NULL AND NEW.assignment_id IS NULL THEN
 IF OLD.active THEN RAISE EXCEPTION 'Deactivate timetable slots before removing this assignment' USING ERRCODE='23503'; END IF;
 IF (NEW.section_id,NEW.class_id,NEW.academic_year_id,NEW.teacher_id,NEW.subject_id,NEW.room_id,NEW.weekday,NEW.start_minute,NEW.end_minute,NEW.effective_from,NEW.effective_to,NEW.active) IS DISTINCT FROM (OLD.section_id,OLD.class_id,OLD.academic_year_id,OLD.teacher_id,OLD.subject_id,OLD.room_id,OLD.weekday,OLD.start_minute,OLD.end_minute,OLD.effective_from,OLD.effective_to,OLD.active) THEN RAISE EXCEPTION 'Invalid assignment detachment' USING ERRCODE='23514'; END IF;
 NEW.version=OLD.version+1;NEW.changed_by=NULL;NEW.change_note='Assignment removed; inactive slot detached.';NEW.updated_at=now();RETURN NEW;
 END IF;
 IF OLD.active AND NOT NEW.active AND (NEW.change_note IS NULL OR length(trim(NEW.change_note))<3) THEN RAISE EXCEPTION 'Deactivation reason required' USING ERRCODE='23514';END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Slot version must increment' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.changed_by IS NULL THEN RAISE EXCEPTION 'Administrator actor required' USING ERRCODE='23514'; END IF;
 SELECT * INTO exyear FROM academic_years WHERE id=NEW.academic_year_id FOR SHARE;
 IF exyear.id IS NULL OR NEW.effective_from<exyear.start_date OR NEW.effective_to>exyear.end_date OR timetable_first_weekday(NEW.effective_from,NEW.weekday)>NEW.effective_to THEN RAISE EXCEPTION 'Slot dates must fit year and contain the selected weekday' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
 FOR lock_key IN SELECT DISTINCT k FROM unnest(ARRAY['teacher:'||NEW.teacher_id,'section:'||NEW.section_id,'room:'||NEW.room_id,'teacher:'||OLD.teacher_id,'section:'||OLD.section_id,'room:'||OLD.room_id]) k WHERE k IS NOT NULL ORDER BY k LOOP PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0)); END LOOP;
 ELSE
 FOR lock_key IN SELECT DISTINCT k FROM unnest(ARRAY['teacher:'||NEW.teacher_id,'section:'||NEW.section_id,'room:'||NEW.room_id]) k WHERE k IS NOT NULL ORDER BY k LOOP PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0)); END LOOP;
 END IF;
 IF NEW.active THEN
 SELECT * INTO assignment FROM teacher_assignments WHERE id=NEW.assignment_id FOR SHARE;
 SELECT * INTO emp FROM teachers WHERE id=NEW.teacher_id FOR SHARE;
 SELECT active INTO account_active FROM users WHERE id=emp.user_id FOR SHARE;
 IF assignment.id IS NULL OR assignment.kind<>'subject_teacher' OR assignment.teacher_id<>NEW.teacher_id OR assignment.class_id<>NEW.class_id OR assignment.academic_year_id<>NEW.academic_year_id OR assignment.subject_id<>NEW.subject_id OR emp.employment_status<>'active' OR NOT coalesce(account_active,false) OR emp.joining_date>NEW.effective_from THEN RAISE EXCEPTION 'Choose an active matching subject assignment and employment dates' USING ERRCODE='23514'; END IF;
 IF NEW.room_id IS NOT NULL THEN SELECT active INTO room_active FROM school_rooms WHERE id=NEW.room_id FOR SHARE;IF NOT coalesce(room_active,false) THEN RAISE EXCEPTION 'Choose an active room' USING ERRCODE='23514'; END IF;END IF;
 IF EXISTS(SELECT 1 FROM timetable_slots s WHERE s.active AND s.id<>NEW.id AND s.weekday=NEW.weekday AND s.start_minute<NEW.end_minute AND s.end_minute>NEW.start_minute AND (s.section_id=NEW.section_id OR s.teacher_id=NEW.teacher_id OR (NEW.room_id IS NOT NULL AND s.room_id=NEW.room_id)) AND timetable_first_weekday(greatest(s.effective_from,NEW.effective_from),NEW.weekday)<=least(s.effective_to,NEW.effective_to)) THEN RAISE EXCEPTION 'Section, teacher or room is already booked at an overlapping occurrence' USING ERRCODE='23P01'; END IF;
 END IF;NEW.updated_at=now();RETURN NEW;
END; $$;
CREATE TRIGGER timetable_slots_guard BEFORE INSERT OR UPDATE ON timetable_slots FOR EACH ROW EXECUTE FUNCTION guard_timetable_slot();
CREATE FUNCTION audit_timetable_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event text;
BEGIN
 IF TG_OP='INSERT' THEN event='created';INSERT INTO timetable_audit(slot_id,action,new_values,actor_id,note) VALUES(NEW.id,event,to_jsonb(NEW),NEW.changed_by,NEW.change_note);
 ELSE event=CASE WHEN OLD.assignment_id IS NOT NULL AND NEW.assignment_id IS NULL THEN 'detached' WHEN OLD.active AND NOT NEW.active THEN 'deactivated' WHEN NOT OLD.active AND NEW.active THEN 'reactivated' ELSE 'updated' END;INSERT INTO timetable_audit(slot_id,action,previous_values,new_values,actor_id,note) VALUES(NEW.id,event,to_jsonb(OLD),to_jsonb(NEW),NEW.changed_by,NEW.change_note);END IF;RETURN NEW;
END; $$;
CREATE TRIGGER timetable_slots_audit AFTER INSERT OR UPDATE ON timetable_slots FOR EACH ROW EXECUTE FUNCTION audit_timetable_slot();
CREATE TRIGGER timetable_audit_protect BEFORE UPDATE OR DELETE ON timetable_audit FOR EACH ROW EXECUTE FUNCTION protect_attendance_audit();
CREATE FUNCTION guard_timetabled_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.teacher_id,NEW.class_id,NEW.academic_year_id,NEW.subject_id,NEW.kind) IS DISTINCT FROM (OLD.teacher_id,OLD.class_id,OLD.academic_year_id,OLD.subject_id,OLD.kind) AND EXISTS(SELECT 1 FROM timetable_slots WHERE assignment_id=OLD.id AND active) THEN RAISE EXCEPTION 'Deactivate timetable slots before changing assignment identity' USING ERRCODE='23503';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER teacher_assignments_timetable_guard BEFORE UPDATE ON teacher_assignments FOR EACH ROW EXECUTE FUNCTION guard_timetabled_assignment();
CREATE FUNCTION guard_timetabled_teacher() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM timetable_slots WHERE teacher_id=NEW.id AND active AND effective_from<NEW.joining_date) THEN RAISE EXCEPTION 'Joining date cannot exclude active timetable periods' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER teachers_timetable_guard BEFORE UPDATE ON teachers FOR EACH ROW EXECUTE FUNCTION guard_timetabled_teacher();
CREATE OR REPLACE FUNCTION validate_year_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM enrollments WHERE academic_year_id=NEW.id AND (enrolled_on<NEW.start_date OR enrolled_on>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE a.academic_year_id=NEW.id AND t.joining_date>NEW.end_date) OR
 EXISTS(SELECT 1 FROM attendance_registers WHERE academic_year_id=NEW.id AND (attendance_date<NEW.start_date OR attendance_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM exams WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM timetable_slots WHERE academic_year_id=NEW.id AND active AND (effective_from<NEW.start_date OR effective_to>NEW.end_date)) THEN RAISE EXCEPTION 'Existing academic records must fit year' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;

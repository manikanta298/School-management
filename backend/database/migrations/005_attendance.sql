CREATE TABLE attendance_registers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 section_id uuid NOT NULL,
 class_id uuid NOT NULL,
 academic_year_id uuid NOT NULL,
 attendance_date date NOT NULL CHECK(attendance_date<=CURRENT_DATE),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(section_id,attendance_date), UNIQUE(id,attendance_date),
 FOREIGN KEY(section_id,class_id) REFERENCES sections(id,class_id) ON DELETE RESTRICT,
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT
);
CREATE INDEX attendance_registers_actor_idx ON attendance_registers(created_by);
CREATE INDEX attendance_registers_class_year_idx ON attendance_registers(class_id,academic_year_id);
CREATE INDEX attendance_registers_year_date_idx ON attendance_registers(academic_year_id,attendance_date);
CREATE TABLE attendance_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 register_id uuid NOT NULL,
 attendance_date date NOT NULL,
 student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
 status varchar(8) NOT NULL CHECK(status IN ('present','absent','late','excused','void')),
 note varchar(200), change_reason varchar(200),
 updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(register_id,student_id),
 FOREIGN KEY(register_id,attendance_date) REFERENCES attendance_registers(id,attendance_date) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX attendance_entries_student_day_unique ON attendance_entries(student_id,attendance_date) WHERE status<>'void';
CREATE INDEX attendance_entries_actor_idx ON attendance_entries(updated_by);
CREATE INDEX attendance_entries_enrollment_idx ON attendance_entries(enrollment_id);
CREATE INDEX attendance_entries_student_date_idx ON attendance_entries(student_id,attendance_date);
CREATE TABLE attendance_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 entry_id uuid NOT NULL REFERENCES attendance_entries(id) ON DELETE RESTRICT,
 previous_status varchar(8) CHECK(previous_status IS NULL OR previous_status IN ('present','absent','late','excused','void')), previous_note varchar(200),
 new_status varchar(8) NOT NULL CHECK(new_status IN ('present','absent','late','excused','void')),
 new_note varchar(200), reason varchar(200),
 changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 changed_at timestamptz NOT NULL DEFAULT now(),
 CHECK(previous_status IS NULL OR (reason IS NOT NULL AND length(trim(reason))>=3))
);
CREATE INDEX attendance_audit_entry_idx ON attendance_audit(entry_id,id);
CREATE INDEX attendance_audit_actor_idx ON attendance_audit(changed_by);
CREATE FUNCTION validate_attendance_register() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y academic_years;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.section_id,NEW.class_id,NEW.academic_year_id,NEW.attendance_date,NEW.created_by) IS DISTINCT FROM (OLD.section_id,OLD.class_id,OLD.academic_year_id,OLD.attendance_date,OLD.created_by) THEN
 RAISE EXCEPTION 'Register identity is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO y FROM academic_years WHERE id=NEW.academic_year_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Academic year not found' USING ERRCODE='23503'; END IF;
 IF NEW.attendance_date<y.start_date OR NEW.attendance_date>y.end_date THEN RAISE EXCEPTION 'Attendance date must fit academic year' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER attendance_registers_validate BEFORE INSERT OR UPDATE ON attendance_registers FOR EACH ROW EXECUTE FUNCTION validate_attendance_register();
CREATE FUNCTION validate_attendance_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE placement enrollments; reg attendance_registers;
BEGIN
 IF TG_OP='UPDATE' THEN
 IF (NEW.register_id,NEW.student_id,NEW.enrollment_id,NEW.attendance_date) IS DISTINCT FROM (OLD.register_id,OLD.student_id,OLD.enrollment_id,OLD.attendance_date) THEN RAISE EXCEPTION 'Attendance identity is immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.status,NEW.note) IS DISTINCT FROM (OLD.status,OLD.note) AND (NEW.change_reason IS NULL OR length(trim(NEW.change_reason))<3) THEN RAISE EXCEPTION 'Correction reason required' USING ERRCODE='23514'; END IF;
 ELSE
 IF NEW.status='void' THEN RAISE EXCEPTION 'Only existing attendance can be voided' USING ERRCODE='23514'; END IF;
 SELECT * INTO placement FROM enrollments WHERE id=NEW.enrollment_id FOR SHARE;
 SELECT * INTO reg FROM attendance_registers WHERE id=NEW.register_id;
 IF placement.id IS NULL OR reg.id IS NULL OR placement.student_id<>NEW.student_id OR placement.section_id<>reg.section_id OR placement.academic_year_id<>reg.academic_year_id OR placement.status<>'active' OR placement.enrolled_on>NEW.attendance_date THEN
 RAISE EXCEPTION 'Student must have an eligible active enrollment' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER attendance_entries_validate BEFORE INSERT OR UPDATE ON attendance_entries FOR EACH ROW EXECUTE FUNCTION validate_attendance_entry();
CREATE FUNCTION audit_attendance_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
 INSERT INTO attendance_audit(entry_id,new_status,new_note,changed_by) VALUES(NEW.id,NEW.status,NEW.note,NEW.updated_by);
 ELSIF (NEW.status,NEW.note) IS DISTINCT FROM (OLD.status,OLD.note) THEN
 INSERT INTO attendance_audit(entry_id,previous_status,previous_note,new_status,new_note,reason,changed_by) VALUES(NEW.id,OLD.status,OLD.note,NEW.status,NEW.note,NEW.change_reason,NEW.updated_by);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER attendance_entries_audit AFTER INSERT OR UPDATE ON attendance_entries FOR EACH ROW EXECUTE FUNCTION audit_attendance_change();
CREATE FUNCTION protect_attendance_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Attendance audit history is append-only' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER attendance_audit_protect BEFORE UPDATE OR DELETE ON attendance_audit FOR EACH ROW EXECUTE FUNCTION protect_attendance_audit();
CREATE FUNCTION protect_attended_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM attendance_entries WHERE enrollment_id=NEW.id AND (attendance_date<NEW.enrolled_on OR student_id<>NEW.student_id OR NEW.academic_year_id<>OLD.academic_year_id)) THEN RAISE EXCEPTION 'Enrollment date cannot exclude saved attendance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER enrollments_attendance_guard BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION protect_attended_enrollment();
CREATE OR REPLACE FUNCTION validate_year_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM enrollments WHERE academic_year_id=NEW.id AND (enrolled_on<NEW.start_date OR enrolled_on>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE a.academic_year_id=NEW.id AND t.joining_date>NEW.end_date) OR
 EXISTS(SELECT 1 FROM attendance_registers WHERE academic_year_id=NEW.id AND (attendance_date<NEW.start_date OR attendance_date>NEW.end_date)) THEN
 RAISE EXCEPTION 'Existing academic records must fit academic year' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

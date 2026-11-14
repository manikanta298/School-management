ALTER TABLE students
 ADD COLUMN gender varchar(10) CHECK(gender IN ('female','male','other')),
 ADD COLUMN blood_group varchar(3) CHECK(blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
 ADD COLUMN nationality varchar(60),
 ADD COLUMN present_address varchar(500),
 ADD COLUMN city varchar(80),
 ADD COLUMN district varchar(80),
 ADD COLUMN state varchar(80),
 ADD COLUMN pin_code varchar(6) CHECK(pin_code ~ '^[0-9]{6}$'),
 ADD COLUMN previous_school varchar(150),
 ADD COLUMN previous_class varchar(50),
 ADD COLUMN lifecycle_status varchar(12) NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active','inactive','transferred','graduated')),
 ADD COLUMN lifecycle_changed_at timestamptz;
CREATE INDEX students_lifecycle_idx ON students(lifecycle_status);
CREATE TABLE student_status_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 previous_status varchar(12) NOT NULL CHECK(previous_status IN ('active','inactive','transferred','graduated')),
 new_status varchar(12) NOT NULL CHECK(new_status IN ('active','inactive','transferred','graduated')),
 reason varchar(200) NOT NULL CHECK(length(trim(reason))>=3),
 changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_status_history_student_idx ON student_status_history(student_id,id);
CREATE INDEX student_status_history_actor_idx ON student_status_history(changed_by);
CREATE FUNCTION protect_student_status_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Student status history is append-only' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER student_status_history_protect BEFORE UPDATE OR DELETE ON student_status_history FOR EACH ROW EXECUTE FUNCTION protect_student_status_history();

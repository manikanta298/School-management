ALTER TABLE users ADD CONSTRAINT users_id_role_unique UNIQUE(id,role);
ALTER TABLE classes ADD CONSTRAINT classes_id_year_unique UNIQUE(id,academic_year_id);
ALTER TABLE sections ADD CONSTRAINT sections_id_class_unique UNIQUE(id,class_id);
CREATE TABLE students (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE,
 account_role varchar(10) NOT NULL DEFAULT 'student' CHECK(account_role='student'),
 admission_number varchar(30) NOT NULL UNIQUE CHECK(admission_number ~ '^[A-Z0-9_-]{1,30}$'),
 admission_date date NOT NULL CHECK(admission_date<=CURRENT_DATE),
 date_of_birth date CHECK(date_of_birth<=admission_date),
 address varchar(500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,account_role) REFERENCES users(id,role) ON DELETE RESTRICT
);
CREATE TABLE parents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE,
 account_role varchar(10) NOT NULL DEFAULT 'parent' CHECK(account_role='parent'),
 phone varchar(30) CHECK(phone IS NULL OR phone ~ '^[+0-9() .-]{7,30}$'),
 address varchar(500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,account_role) REFERENCES users(id,role) ON DELETE RESTRICT
);
CREATE TABLE student_parents (
 student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE RESTRICT,
 relationship varchar(20) NOT NULL CHECK(relationship IN ('mother','father','guardian','other')),
 PRIMARY KEY(student_id,parent_id)
);
CREATE INDEX student_parents_parent_idx ON student_parents(parent_id,student_id);
CREATE TABLE enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 academic_year_id uuid NOT NULL,
 class_id uuid NOT NULL,
 section_id uuid NOT NULL,
 enrolled_on date NOT NULL,
 status varchar(10) NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn','completed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(student_id,academic_year_id),
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT,
 FOREIGN KEY(section_id,class_id) REFERENCES sections(id,class_id) ON DELETE RESTRICT
);
CREATE INDEX enrollments_section_status_idx ON enrollments(section_id,status);
CREATE INDEX enrollments_class_year_idx ON enrollments(class_id,academic_year_id);
CREATE INDEX enrollments_year_idx ON enrollments(academic_year_id);
CREATE FUNCTION validate_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y academic_years; admitted date; seats integer;
BEGIN
 SELECT * INTO y FROM academic_years WHERE id=NEW.academic_year_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Academic year not found' USING ERRCODE='23503'; END IF;
 SELECT admission_date INTO admitted FROM students WHERE id=NEW.student_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Student not found' USING ERRCODE='23503'; END IF;
 IF NEW.enrolled_on<y.start_date OR NEW.enrolled_on>y.end_date OR NEW.enrolled_on<admitted THEN
 RAISE EXCEPTION 'Enrollment date must be within academic year and on or after admission' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
 PERFORM id FROM sections WHERE id IN (NEW.section_id,OLD.section_id) ORDER BY id FOR UPDATE;
 ELSE PERFORM id FROM sections WHERE id=NEW.section_id FOR UPDATE; END IF;
 SELECT capacity INTO seats FROM sections WHERE id=NEW.section_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Section not found' USING ERRCODE='23503'; END IF;
 IF NEW.status='active' AND (SELECT count(*) FROM enrollments WHERE section_id=NEW.section_id AND status='active' AND id<>NEW.id)>=seats THEN
 RAISE EXCEPTION 'Section capacity reached' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER enrollments_validate BEFORE INSERT OR UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION validate_enrollment();
CREATE FUNCTION validate_section_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.capacity<(SELECT count(*) FROM enrollments WHERE section_id=NEW.id AND status='active') THEN
 RAISE EXCEPTION 'Capacity cannot be below active enrollment count' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER sections_validate_capacity BEFORE UPDATE ON sections FOR EACH ROW EXECUTE FUNCTION validate_section_capacity();
CREATE FUNCTION validate_student_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM enrollments WHERE student_id=NEW.id AND enrolled_on<NEW.admission_date) THEN
 RAISE EXCEPTION 'Admission cannot be after an existing enrollment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER students_validate_admission BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION validate_student_admission();
CREATE OR REPLACE FUNCTION validate_year_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM enrollments WHERE academic_year_id=NEW.id AND (enrolled_on<NEW.start_date OR enrolled_on>NEW.end_date)) THEN
 RAISE EXCEPTION 'Existing terms and enrollments must fit within academic year' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

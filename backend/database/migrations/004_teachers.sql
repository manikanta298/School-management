CREATE TABLE teachers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE,
 account_role varchar(10) NOT NULL DEFAULT 'teacher' CHECK(account_role='teacher'),
 employee_number varchar(30) NOT NULL UNIQUE CHECK(employee_number ~ '^[A-Z0-9_-]{1,30}$'),
 joining_date date NOT NULL CHECK(joining_date<=CURRENT_DATE),
 phone varchar(30) CHECK(phone IS NULL OR phone ~ '^[+0-9() .-]{7,30}$'),
 qualification varchar(200),
 employment_status varchar(8) NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,account_role) REFERENCES users(id,role) ON DELETE RESTRICT
);
CREATE INDEX teachers_status_idx ON teachers(employment_status);
CREATE TABLE teacher_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
 class_id uuid NOT NULL,
 academic_year_id uuid NOT NULL,
 kind varchar(20) NOT NULL CHECK(kind IN ('class_teacher','subject_teacher')),
 subject_id uuid REFERENCES subjects(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='class_teacher' AND subject_id IS NULL) OR (kind='subject_teacher' AND subject_id IS NOT NULL)),
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX teacher_assignments_class_teacher_unique ON teacher_assignments(class_id) WHERE kind='class_teacher';
CREATE UNIQUE INDEX teacher_assignments_subject_unique ON teacher_assignments(class_id,subject_id) WHERE kind='subject_teacher';
CREATE INDEX teacher_assignments_teacher_idx ON teacher_assignments(teacher_id,class_id);
CREATE INDEX teacher_assignments_class_year_idx ON teacher_assignments(class_id,academic_year_id);
CREATE INDEX teacher_assignments_year_idx ON teacher_assignments(academic_year_id);
CREATE INDEX teacher_assignments_subject_idx ON teacher_assignments(subject_id);
CREATE FUNCTION validate_teacher_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE year_end date; hired date; employment varchar(8); account_active boolean;
BEGIN
 SELECT end_date INTO year_end FROM academic_years WHERE id=NEW.academic_year_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Academic year not found' USING ERRCODE='23503'; END IF;
 SELECT t.joining_date,t.employment_status,u.active INTO hired,employment,account_active FROM teachers t JOIN users u ON u.id=t.user_id WHERE t.id=NEW.teacher_id FOR UPDATE OF t,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'Teacher not found' USING ERRCODE='23503'; END IF;
 IF employment<>'active' OR NOT account_active THEN RAISE EXCEPTION 'Only active teachers can be assigned' USING ERRCODE='23514'; END IF;
 IF hired>year_end THEN RAISE EXCEPTION 'Teacher joined after academic year ended' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER teacher_assignments_validate BEFORE INSERT OR UPDATE ON teacher_assignments FOR EACH ROW EXECUTE FUNCTION validate_teacher_assignment();
CREATE FUNCTION validate_teacher_joining() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM teacher_assignments a JOIN academic_years y ON y.id=a.academic_year_id WHERE a.teacher_id=NEW.id AND NEW.joining_date>y.end_date) THEN
 RAISE EXCEPTION 'Joining date must fit existing assignment years' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER teachers_validate_joining BEFORE UPDATE ON teachers FOR EACH ROW EXECUTE FUNCTION validate_teacher_joining();
CREATE OR REPLACE FUNCTION validate_year_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM enrollments WHERE academic_year_id=NEW.id AND (enrolled_on<NEW.start_date OR enrolled_on>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE a.academic_year_id=NEW.id AND t.joining_date>NEW.end_date) THEN
 RAISE EXCEPTION 'Existing terms, enrollments and teacher assignments must fit academic year' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

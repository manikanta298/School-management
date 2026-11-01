-- Complete application schema through Module 8. Use migrations to upgrade.
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(100) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
 email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
 password_hash text NOT NULL,
 role varchar(10) NOT NULL CHECK (role IN ('admin','teacher','student','parent')),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash char(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);
CREATE INDEX users_role_idx ON users(role);

CREATE TABLE academic_years (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 start_date date NOT NULL, end_date date NOT NULL,
 is_current boolean NOT NULL DEFAULT false,
 CHECK(end_date>=start_date)
);
CREATE UNIQUE INDEX academic_years_name_unique ON academic_years(lower(name));
CREATE UNIQUE INDEX academic_years_single_current ON academic_years(is_current) WHERE is_current;
CREATE TABLE terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 start_date date NOT NULL, end_date date NOT NULL,
 CHECK(end_date>=start_date)
);
CREATE UNIQUE INDEX terms_name_unique ON terms(academic_year_id,lower(name));
CREATE INDEX terms_dates_idx ON terms(academic_year_id,start_date,end_date);
CREATE TABLE classes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0)
);
CREATE UNIQUE INDEX classes_name_unique ON classes(academic_year_id,lower(name));
CREATE TABLE sections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX sections_name_unique ON sections(class_id,lower(name));
CREATE TABLE subjects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 code varchar(20) NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9_-]{1,20}$')
);
CREATE UNIQUE INDEX subjects_name_unique ON subjects(lower(name));
CREATE FUNCTION validate_term_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y academic_years;
BEGIN
 SELECT * INTO y FROM academic_years WHERE id=NEW.academic_year_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Academic year does not exist' USING ERRCODE='23503'; END IF;
 IF NEW.start_date<y.start_date OR NEW.end_date>y.end_date THEN
 RAISE EXCEPTION 'Term dates must fall within academic year' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.academic_year_id AND id<>NEW.id AND start_date<=NEW.end_date AND end_date>=NEW.start_date) THEN
 RAISE EXCEPTION 'Term dates overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER terms_validate_dates BEFORE INSERT OR UPDATE ON terms FOR EACH ROW EXECUTE FUNCTION validate_term_dates();
CREATE FUNCTION validate_year_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) THEN
 RAISE EXCEPTION 'Existing terms must fit within academic year' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER years_validate_dates BEFORE UPDATE ON academic_years FOR EACH ROW EXECUTE FUNCTION validate_year_dates();

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

CREATE TABLE fee_structures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 class_id uuid NOT NULL, academic_year_id uuid NOT NULL,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
 currency char(3) NOT NULL DEFAULT 'INR' CHECK(currency IN ('INR','USD','EUR','GBP')),
 active boolean NOT NULL DEFAULT true,
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX fee_structures_name_unique ON fee_structures(class_id,lower(name));
CREATE INDEX fee_structures_class_year_idx ON fee_structures(class_id,academic_year_id);
CREATE INDEX fee_structures_year_idx ON fee_structures(academic_year_id);
CREATE TABLE fee_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 fee_structure_id uuid NOT NULL REFERENCES fee_structures(id) ON DELETE RESTRICT,
 enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
 class_id uuid NOT NULL, academic_year_id uuid NOT NULL,
 title varchar(100) NOT NULL,
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
 currency char(3) NOT NULL CHECK(currency IN ('INR','USD','EUR','GBP')),
 issued_on date NOT NULL CHECK(issued_on<=CURRENT_DATE), due_on date NOT NULL CHECK(due_on>=issued_on),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz, void_reason varchar(200), voided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 CHECK((voided_at IS NULL AND void_reason IS NULL AND voided_by IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(trim(void_reason))>=3)),
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX fee_invoices_student_structure_unique ON fee_invoices(student_id,fee_structure_id) WHERE voided_at IS NULL;
CREATE INDEX fee_invoices_student_idx ON fee_invoices(student_id);
CREATE INDEX fee_invoices_structure_idx ON fee_invoices(fee_structure_id);
CREATE INDEX fee_invoices_enrollment_idx ON fee_invoices(enrollment_id);
CREATE INDEX fee_invoices_class_year_idx ON fee_invoices(class_id,academic_year_id);
CREATE INDEX fee_invoices_year_due_idx ON fee_invoices(academic_year_id,due_on);
CREATE INDEX fee_invoices_creator_idx ON fee_invoices(created_by);
CREATE INDEX fee_invoices_void_actor_idx ON fee_invoices(voided_by);
CREATE TABLE fee_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 invoice_id uuid NOT NULL REFERENCES fee_invoices(id) ON DELETE RESTRICT,
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
 paid_on date NOT NULL CHECK(paid_on<=CURRENT_DATE),
 method varchar(20) NOT NULL CHECK(method IN ('cash','bank_transfer','cheque','other')),
 reference varchar(80), idempotency_key uuid NOT NULL UNIQUE,
 recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 reversed_at timestamptz, reversal_reason varchar(200), reversed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 UNIQUE(id,invoice_id),
 CHECK((reversed_at IS NULL AND reversal_reason IS NULL AND reversed_by IS NULL) OR (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL AND length(trim(reversal_reason))>=3 AND reversed_by IS NOT NULL))
);
CREATE INDEX fee_payments_invoice_idx ON fee_payments(invoice_id,reversed_at);
CREATE INDEX fee_payments_actor_idx ON fee_payments(recorded_by);
CREATE INDEX fee_payments_reverse_actor_idx ON fee_payments(reversed_by);
CREATE TABLE fee_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 invoice_id uuid NOT NULL REFERENCES fee_invoices(id) ON DELETE RESTRICT,
 payment_id uuid,
 kind varchar(20) NOT NULL CHECK(kind IN ('invoice_issued','invoice_voided','payment_recorded','payment_reversed')),
 amount_minor integer NOT NULL CHECK(amount_minor>0),
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason varchar(200), occurred_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind IN ('payment_recorded','payment_reversed'))=(payment_id IS NOT NULL)),
 CHECK(kind NOT IN ('invoice_voided','payment_reversed') OR (reason IS NOT NULL AND length(trim(reason))>=3)),
 FOREIGN KEY(payment_id,invoice_id) REFERENCES fee_payments(id,invoice_id) ON DELETE RESTRICT
);
CREATE INDEX fee_events_invoice_idx ON fee_events(invoice_id,id);
CREATE INDEX fee_events_payment_idx ON fee_events(payment_id,invoice_id);
CREATE INDEX fee_events_actor_idx ON fee_events(actor_id);
CREATE FUNCTION guard_fee_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e enrollments; f fee_structures;
BEGIN
 IF TG_OP='UPDATE' THEN
 IF (NEW.id,NEW.invoice_number,NEW.student_id,NEW.fee_structure_id,NEW.enrollment_id,NEW.class_id,NEW.academic_year_id,NEW.title,NEW.amount_minor,NEW.currency,NEW.issued_on,NEW.due_on,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.invoice_number,OLD.student_id,OLD.fee_structure_id,OLD.enrollment_id,OLD.class_id,OLD.academic_year_id,OLD.title,OLD.amount_minor,OLD.currency,OLD.issued_on,OLD.due_on,OLD.created_by,OLD.created_at) OR OLD.voided_at IS NOT NULL THEN
 RAISE EXCEPTION 'Issued invoices are immutable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM fee_payments WHERE invoice_id=NEW.id AND reversed_at IS NULL) THEN RAISE EXCEPTION 'Reverse payments before voiding invoice' USING ERRCODE='23514'; END IF;
 ELSE
 SELECT * INTO e FROM enrollments WHERE id=NEW.enrollment_id FOR SHARE;
 SELECT * INTO f FROM fee_structures WHERE id=NEW.fee_structure_id FOR SHARE;
 IF e.id IS NULL OR f.id IS NULL OR NOT f.active OR e.status<>'active' OR e.student_id<>NEW.student_id OR e.class_id<>f.class_id OR e.academic_year_id<>f.academic_year_id OR NEW.class_id<>f.class_id OR NEW.academic_year_id<>f.academic_year_id OR NEW.title<>f.name OR NEW.currency<>f.currency OR NEW.amount_minor<>f.amount_minor OR NEW.issued_on<e.enrolled_on OR NEW.voided_at IS NOT NULL THEN
 RAISE EXCEPTION 'Invoice must snapshot an active matching fee structure and enrollment' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER fee_invoices_guard BEFORE INSERT OR UPDATE ON fee_invoices FOR EACH ROW EXECUTE FUNCTION guard_fee_invoice();
CREATE FUNCTION guard_fee_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv fee_invoices; paid bigint;
BEGIN
 SELECT * INTO inv FROM fee_invoices WHERE id=NEW.invoice_id FOR UPDATE;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found' USING ERRCODE='23503'; END IF;
 IF TG_OP='UPDATE' THEN
 IF (NEW.id,NEW.receipt_number,NEW.invoice_id,NEW.amount_minor,NEW.paid_on,NEW.method,NEW.reference,NEW.idempotency_key,NEW.recorded_by,NEW.recorded_at) IS DISTINCT FROM (OLD.id,OLD.receipt_number,OLD.invoice_id,OLD.amount_minor,OLD.paid_on,OLD.method,OLD.reference,OLD.idempotency_key,OLD.recorded_by,OLD.recorded_at) OR OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL THEN
 RAISE EXCEPTION 'Payments can only be reversed once' USING ERRCODE='23514'; END IF;
 ELSE
 SELECT coalesce(sum(amount_minor),0) INTO paid FROM fee_payments WHERE invoice_id=NEW.invoice_id AND reversed_at IS NULL;
 IF inv.voided_at IS NOT NULL OR NEW.paid_on<inv.issued_on OR NEW.amount_minor>inv.amount_minor-paid OR NEW.reversed_at IS NOT NULL THEN
 RAISE EXCEPTION 'Invalid payment date, void invoice or overpayment' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER fee_payments_guard BEFORE INSERT OR UPDATE ON fee_payments FOR EACH ROW EXECUTE FUNCTION guard_fee_payment();
CREATE FUNCTION audit_fee_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO fee_events(invoice_id,kind,amount_minor,actor_id) VALUES(NEW.id,'invoice_issued',NEW.amount_minor,NEW.created_by);
 ELSE INSERT INTO fee_events(invoice_id,kind,amount_minor,actor_id,reason) VALUES(NEW.id,'invoice_voided',NEW.amount_minor,NEW.voided_by,NEW.void_reason); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fee_invoices_audit AFTER INSERT OR UPDATE ON fee_invoices FOR EACH ROW EXECUTE FUNCTION audit_fee_invoice();
CREATE FUNCTION audit_fee_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO fee_events(invoice_id,payment_id,kind,amount_minor,actor_id) VALUES(NEW.invoice_id,NEW.id,'payment_recorded',NEW.amount_minor,NEW.recorded_by);
 ELSE INSERT INTO fee_events(invoice_id,payment_id,kind,amount_minor,actor_id,reason) VALUES(NEW.invoice_id,NEW.id,'payment_reversed',NEW.amount_minor,NEW.reversed_by,NEW.reversal_reason); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fee_payments_audit AFTER INSERT OR UPDATE ON fee_payments FOR EACH ROW EXECUTE FUNCTION audit_fee_payment();
CREATE FUNCTION protect_fee_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Fee audit history is append-only' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER fee_events_protect BEFORE UPDATE OR DELETE ON fee_events FOR EACH ROW EXECUTE FUNCTION protect_fee_events();
CREATE FUNCTION protect_billed_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM fee_invoices WHERE enrollment_id=NEW.id AND (student_id<>NEW.student_id OR academic_year_id<>NEW.academic_year_id OR issued_on<NEW.enrolled_on)) THEN
 RAISE EXCEPTION 'Enrollment change conflicts with issued invoice' USING ERRCODE='23514'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER enrollments_fee_guard BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION protect_billed_enrollment();

ALTER TABLE terms ADD CONSTRAINT terms_id_year_unique UNIQUE(id,academic_year_id);
CREATE TABLE exam_grading_scales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL CHECK(length(trim(name))>0)
);
CREATE UNIQUE INDEX exam_grading_scales_name_unique ON exam_grading_scales(lower(name));
CREATE TABLE exam_grade_bands (
 scale_id uuid NOT NULL REFERENCES exam_grading_scales(id) ON DELETE RESTRICT,
 minimum_percent integer NOT NULL CHECK(minimum_percent BETWEEN 0 AND 100),
 label varchar(5) NOT NULL CHECK(label ~ '^[A-Z0-9+-]{1,5}$'),
 PRIMARY KEY(scale_id,minimum_percent), UNIQUE(scale_id,label)
);
INSERT INTO exam_grading_scales(id,name) VALUES('00000000-0000-4000-8000-000000000007','Default A–F');
INSERT INTO exam_grade_bands(scale_id,minimum_percent,label) VALUES
 ('00000000-0000-4000-8000-000000000007',90,'A'),('00000000-0000-4000-8000-000000000007',80,'B'),
 ('00000000-0000-4000-8000-000000000007',70,'C'),('00000000-0000-4000-8000-000000000007',60,'D'),
 ('00000000-0000-4000-8000-000000000007',50,'E'),('00000000-0000-4000-8000-000000000007',0,'F');
CREATE TABLE exams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL,academic_year_id uuid NOT NULL,
 term_id uuid, grading_scale_id uuid NOT NULL REFERENCES exam_grading_scales(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),start_date date NOT NULL,end_date date NOT NULL CHECK(end_date>=start_date),
 status varchar(10) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action_reason varchar(200),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,class_id),
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT,
 FOREIGN KEY(term_id,academic_year_id) REFERENCES terms(id,academic_year_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX exams_name_unique ON exams(class_id,lower(name)) WHERE status<>'cancelled';
CREATE INDEX exams_class_year_idx ON exams(class_id,academic_year_id);
CREATE INDEX exams_year_idx ON exams(academic_year_id);
CREATE INDEX exams_term_idx ON exams(term_id,academic_year_id);
CREATE INDEX exams_scale_idx ON exams(grading_scale_id);
CREATE INDEX exams_creator_idx ON exams(created_by);
CREATE INDEX exams_updater_idx ON exams(updated_by);
CREATE TABLE exam_candidates (
 exam_id uuid NOT NULL,student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
 section_id uuid NOT NULL,class_id uuid NOT NULL,
 PRIMARY KEY(exam_id,student_id),
 FOREIGN KEY(exam_id,class_id) REFERENCES exams(id,class_id) ON DELETE RESTRICT,
 FOREIGN KEY(section_id,class_id) REFERENCES sections(id,class_id) ON DELETE RESTRICT
);
CREATE INDEX exam_candidates_student_idx ON exam_candidates(student_id,exam_id);
CREATE INDEX exam_candidates_enrollment_idx ON exam_candidates(enrollment_id);
CREATE INDEX exam_candidates_section_idx ON exam_candidates(section_id,class_id);
CREATE TABLE exam_papers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE RESTRICT,
 subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
 held_on date NOT NULL,max_marks integer NOT NULL CHECK(max_marks BETWEEN 1 AND 1000),
 pass_marks integer NOT NULL CHECK(pass_marks BETWEEN 0 AND max_marks),version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 UNIQUE(exam_id,subject_id),UNIQUE(id,exam_id)
);
CREATE INDEX exam_papers_subject_idx ON exam_papers(subject_id);
CREATE TABLE exam_marks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),exam_id uuid NOT NULL,paper_id uuid NOT NULL,student_id uuid NOT NULL,
 outcome varchar(8) NOT NULL CHECK(outcome IN ('scored','absent','exempt')),
 score integer CHECK(score>=0),remark varchar(200),change_reason varchar(200),
 updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(paper_id,student_id),
 CHECK((outcome='scored' AND score IS NOT NULL) OR (outcome<>'scored' AND score IS NULL)),
 CHECK(outcome<>'exempt' OR (remark IS NOT NULL AND length(trim(remark))>=3)),
 FOREIGN KEY(paper_id,exam_id) REFERENCES exam_papers(id,exam_id) ON DELETE RESTRICT,
 FOREIGN KEY(exam_id,student_id) REFERENCES exam_candidates(exam_id,student_id) ON DELETE RESTRICT
);
CREATE INDEX exam_marks_candidate_idx ON exam_marks(exam_id,student_id);
CREATE INDEX exam_marks_actor_idx ON exam_marks(updated_by);
CREATE TABLE exam_mark_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,mark_id uuid NOT NULL REFERENCES exam_marks(id) ON DELETE RESTRICT,
 previous_outcome varchar(8) CHECK(previous_outcome IS NULL OR previous_outcome IN ('scored','absent','exempt')),previous_score integer CHECK(previous_score>=0),previous_remark varchar(200),
 new_outcome varchar(8) NOT NULL CHECK(new_outcome IN ('scored','absent','exempt')),new_score integer CHECK(new_score>=0),new_remark varchar(200),
 reason varchar(200),changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,changed_at timestamptz NOT NULL DEFAULT now(),
 CHECK((new_outcome='scored' AND new_score IS NOT NULL) OR (new_outcome<>'scored' AND new_score IS NULL)),
 CHECK(previous_outcome IS NULL OR (reason IS NOT NULL AND length(trim(reason))>=3))
);
CREATE INDEX exam_mark_audit_mark_idx ON exam_mark_audit(mark_id,id);
CREATE INDEX exam_mark_audit_actor_idx ON exam_mark_audit(changed_by);
CREATE TABLE exam_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE RESTRICT,
 action varchar(12) NOT NULL CHECK(action IN ('created','published','reopened','cancelled')),
 reason varchar(200),actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,occurred_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action NOT IN ('reopened','cancelled') OR (reason IS NOT NULL AND length(trim(reason))>=3))
);
CREATE INDEX exam_events_exam_idx ON exam_events(exam_id,id);
CREATE INDEX exam_events_actor_idx ON exam_events(actor_id);
CREATE FUNCTION guard_exam() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y academic_years;t terms;
BEGIN
 IF TG_OP='INSERT' THEN
 SELECT * INTO y FROM academic_years WHERE id=NEW.academic_year_id FOR SHARE;
 SELECT * INTO t FROM terms WHERE id=NEW.term_id FOR SHARE;
 PERFORM id FROM exam_grading_scales WHERE id=NEW.grading_scale_id FOR SHARE;
 IF NEW.status<>'draft' OR NOT EXISTS(SELECT 1 FROM exam_grade_bands WHERE scale_id=NEW.grading_scale_id AND minimum_percent=0) THEN RAISE EXCEPTION 'Exam needs a complete grading scale and draft state' USING ERRCODE='23514'; END IF;
 IF y.id IS NULL OR NEW.start_date<y.start_date OR NEW.end_date>y.end_date OR (NEW.term_id IS NOT NULL AND (t.id IS NULL OR t.academic_year_id<>NEW.academic_year_id OR NEW.start_date<t.start_date OR NEW.end_date>t.end_date)) THEN RAISE EXCEPTION 'Exam dates must fit year and optional term' USING ERRCODE='23514'; END IF;
 ELSE
 IF (NEW.id,NEW.class_id,NEW.academic_year_id,NEW.term_id,NEW.grading_scale_id,NEW.name,NEW.start_date,NEW.end_date,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.class_id,OLD.academic_year_id,OLD.term_id,OLD.grading_scale_id,OLD.name,OLD.start_date,OLD.end_date,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Exam setup is immutable; cancel and replace an incorrect exam' USING ERRCODE='23514'; END IF;
 IF OLD.status='draft' AND NEW.status='published' THEN
 IF NEW.end_date>CURRENT_DATE OR NOT EXISTS(SELECT 1 FROM exam_candidates WHERE exam_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM exam_papers WHERE exam_id=NEW.id) OR EXISTS(SELECT 1 FROM exam_candidates c CROSS JOIN exam_papers p WHERE c.exam_id=NEW.id AND p.exam_id=NEW.id AND NOT EXISTS(SELECT 1 FROM exam_marks m WHERE m.paper_id=p.id AND m.student_id=c.student_id)) THEN RAISE EXCEPTION 'Finish the exam and mark every candidate/paper before publication' USING ERRCODE='23514'; END IF;
 ELSIF (OLD.status='published' AND NEW.status='draft') OR (OLD.status='draft' AND NEW.status='cancelled') THEN
 IF NEW.action_reason IS NULL OR length(trim(NEW.action_reason))<3 THEN RAISE EXCEPTION 'Action reason required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Invalid exam state transition' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER exams_guard BEFORE INSERT OR UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION guard_exam();
CREATE FUNCTION guard_exam_scale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid;
BEGIN
 IF TG_OP='DELETE' THEN sid=OLD.scale_id; ELSE sid=NEW.scale_id; END IF;
 PERFORM id FROM exam_grading_scales WHERE id=sid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM exams WHERE grading_scale_id=sid) OR (TG_OP='UPDATE' AND NEW.scale_id<>OLD.scale_id) THEN RAISE EXCEPTION 'Referenced grading rules are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER exam_grade_bands_guard BEFORE INSERT OR UPDATE OR DELETE ON exam_grade_bands FOR EACH ROW EXECUTE FUNCTION guard_exam_scale();
CREATE FUNCTION guard_exam_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ex exams;en enrollments;
BEGIN
 IF TG_OP='DELETE' THEN SELECT * INTO ex FROM exams WHERE id=OLD.exam_id FOR SHARE; ELSE SELECT * INTO ex FROM exams WHERE id=NEW.exam_id FOR SHARE; END IF;
 IF ex.status<>'draft' THEN RAISE EXCEPTION 'Candidates can change only in draft exams' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Candidate identity is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO en FROM enrollments WHERE id=NEW.enrollment_id FOR SHARE;
 IF en.id IS NULL OR en.student_id<>NEW.student_id OR en.class_id<>ex.class_id OR en.academic_year_id<>ex.academic_year_id OR en.section_id<>NEW.section_id OR NEW.class_id<>ex.class_id OR en.status<>'active' OR en.enrolled_on>ex.start_date THEN RAISE EXCEPTION 'Candidate needs a matching active enrollment before exam start' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER exam_candidates_guard BEFORE INSERT OR UPDATE OR DELETE ON exam_candidates FOR EACH ROW EXECUTE FUNCTION guard_exam_candidate();
CREATE FUNCTION guard_exam_paper() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ex exams;
BEGIN
 IF TG_OP='DELETE' THEN SELECT * INTO ex FROM exams WHERE id=OLD.exam_id FOR SHARE; ELSE SELECT * INTO ex FROM exams WHERE id=NEW.exam_id FOR SHARE; END IF;
 IF ex.status<>'draft' THEN RAISE EXCEPTION 'Paper can change only in draft exam' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.held_on<ex.start_date OR NEW.held_on>ex.end_date THEN RAISE EXCEPTION 'Paper date must fit exam' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.exam_id) IS DISTINCT FROM (OLD.id,OLD.exam_id) OR ((NEW.subject_id,NEW.held_on,NEW.max_marks,NEW.pass_marks) IS DISTINCT FROM (OLD.subject_id,OLD.held_on,OLD.max_marks,OLD.pass_marks) AND EXISTS(SELECT 1 FROM exam_marks WHERE paper_id=OLD.id))) THEN RAISE EXCEPTION 'Marked paper setup is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER exam_papers_guard BEFORE INSERT OR UPDATE OR DELETE ON exam_papers FOR EACH ROW EXECUTE FUNCTION guard_exam_paper();
CREATE FUNCTION guard_exam_mark() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ex exams;p exam_papers;
BEGIN
 SELECT * INTO ex FROM exams WHERE id=NEW.exam_id FOR SHARE;
 SELECT * INTO p FROM exam_papers WHERE id=NEW.paper_id;
 IF ex.status<>'draft' OR p.exam_id<>NEW.exam_id OR p.held_on>CURRENT_DATE OR NEW.score>p.max_marks THEN RAISE EXCEPTION 'Invalid score, future paper or closed exam' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
 IF (NEW.id,NEW.exam_id,NEW.paper_id,NEW.student_id) IS DISTINCT FROM (OLD.id,OLD.exam_id,OLD.paper_id,OLD.student_id) THEN RAISE EXCEPTION 'Mark identity is immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.outcome,NEW.score,NEW.remark) IS DISTINCT FROM (OLD.outcome,OLD.score,OLD.remark) AND (NEW.change_reason IS NULL OR length(trim(NEW.change_reason))<3) THEN RAISE EXCEPTION 'Mark correction reason required' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER exam_marks_guard BEFORE INSERT OR UPDATE ON exam_marks FOR EACH ROW EXECUTE FUNCTION guard_exam_mark();
CREATE FUNCTION audit_exam_mark() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO exam_mark_audit(mark_id,new_outcome,new_score,new_remark,changed_by) VALUES(NEW.id,NEW.outcome,NEW.score,NEW.remark,NEW.updated_by);
 ELSIF (NEW.outcome,NEW.score,NEW.remark) IS DISTINCT FROM (OLD.outcome,OLD.score,OLD.remark) THEN INSERT INTO exam_mark_audit(mark_id,previous_outcome,previous_score,previous_remark,new_outcome,new_score,new_remark,reason,changed_by) VALUES(NEW.id,OLD.outcome,OLD.score,OLD.remark,NEW.outcome,NEW.score,NEW.remark,NEW.change_reason,NEW.updated_by); END IF; RETURN NEW;
END; $$;
CREATE TRIGGER exam_marks_audit AFTER INSERT OR UPDATE ON exam_marks FOR EACH ROW EXECUTE FUNCTION audit_exam_mark();
CREATE FUNCTION audit_exam_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO exam_events(exam_id,action,actor_id) VALUES(NEW.id,'created',NEW.created_by);
 ELSE INSERT INTO exam_events(exam_id,action,reason,actor_id) VALUES(NEW.id,CASE NEW.status WHEN 'published' THEN 'published' WHEN 'cancelled' THEN 'cancelled' ELSE 'reopened' END,NEW.action_reason,NEW.updated_by); END IF; RETURN NEW;
END; $$;
CREATE TRIGGER exams_audit AFTER INSERT OR UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION audit_exam_event();
CREATE TRIGGER exam_mark_audit_protect BEFORE UPDATE OR DELETE ON exam_mark_audit FOR EACH ROW EXECUTE FUNCTION protect_attendance_audit();
CREATE TRIGGER exam_events_protect BEFORE UPDATE OR DELETE ON exam_events FOR EACH ROW EXECUTE FUNCTION protect_attendance_audit();
CREATE FUNCTION protect_exam_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM exam_candidates c JOIN exams e ON e.id=c.exam_id WHERE c.enrollment_id=NEW.id AND (c.student_id<>NEW.student_id OR e.academic_year_id<>NEW.academic_year_id OR NEW.enrolled_on>e.start_date)) THEN RAISE EXCEPTION 'Enrollment change conflicts with registered exam candidate' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER enrollments_exam_guard BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION protect_exam_enrollment();
CREATE FUNCTION protect_exam_term() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM exams WHERE term_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) THEN RAISE EXCEPTION 'Term dates must contain existing exams' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER terms_exam_guard BEFORE UPDATE ON terms FOR EACH ROW EXECUTE FUNCTION protect_exam_term();
CREATE OR REPLACE FUNCTION validate_year_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM enrollments WHERE academic_year_id=NEW.id AND (enrolled_on<NEW.start_date OR enrolled_on>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE a.academic_year_id=NEW.id AND t.joining_date>NEW.end_date) OR
 EXISTS(SELECT 1 FROM attendance_registers WHERE academic_year_id=NEW.id AND (attendance_date<NEW.start_date OR attendance_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM exams WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) THEN RAISE EXCEPTION 'Existing academic records must fit year' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;

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

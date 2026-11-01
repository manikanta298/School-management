-- Complete application schema through Module 6. Use migrations to upgrade.
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

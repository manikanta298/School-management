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

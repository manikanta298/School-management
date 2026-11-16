-- Enforce same-school ownership for fee structures, invoices, payments and audit events.
-- Migration 018 assigned existing fee records to the initial school.
-- Depends on 023 (enrollments_id_school_unique); guarded so it also applies if 023 is absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enrollments_id_school_unique') THEN
    ALTER TABLE enrollments ADD CONSTRAINT enrollments_id_school_unique UNIQUE (id, school_id);
  END IF;
END $$;

ALTER TABLE fee_structures
  ADD CONSTRAINT fee_structures_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT fee_structures_class_same_school_fk
    FOREIGN KEY (class_id, school_id) REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fee_structures_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE RESTRICT;

ALTER TABLE fee_invoices
  ADD CONSTRAINT fee_invoices_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT fee_invoices_student_same_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fee_invoices_structure_same_school_fk
    FOREIGN KEY (fee_structure_id, school_id) REFERENCES fee_structures(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fee_invoices_enrollment_same_school_fk
    FOREIGN KEY (enrollment_id, school_id) REFERENCES enrollments(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fee_invoices_class_same_school_fk
    FOREIGN KEY (class_id, school_id) REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fee_invoices_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE RESTRICT;

ALTER TABLE fee_payments
  DROP CONSTRAINT IF EXISTS fee_payments_idempotency_key_key,
  ADD CONSTRAINT fee_payments_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT fee_payments_invoice_same_school_fk
    FOREIGN KEY (invoice_id, school_id) REFERENCES fee_invoices(id, school_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX fee_payments_school_idempotency_unique
  ON fee_payments(school_id, idempotency_key);

ALTER TABLE fee_events
  ADD CONSTRAINT fee_events_invoice_same_school_fk
    FOREIGN KEY (invoice_id, school_id) REFERENCES fee_invoices(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fee_events_payment_same_school_fk
    FOREIGN KEY (payment_id, school_id) REFERENCES fee_payments(id, school_id) ON DELETE RESTRICT;

CREATE INDEX fee_structures_school_class_year_idx ON fee_structures(school_id, class_id, academic_year_id);
CREATE INDEX fee_invoices_school_student_idx ON fee_invoices(school_id, student_id);
CREATE INDEX fee_invoices_school_year_due_idx ON fee_invoices(school_id, academic_year_id, due_on);
CREATE INDEX fee_payments_school_invoice_idx ON fee_payments(school_id, invoice_id, reversed_at);
CREATE INDEX fee_events_school_invoice_idx ON fee_events(school_id, invoice_id, id);

-- Audit triggers must write the owning school on every fee event.
CREATE OR REPLACE FUNCTION audit_fee_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO fee_events(school_id,invoice_id,kind,amount_minor,actor_id)
    VALUES(NEW.school_id,NEW.id,'invoice_issued',NEW.amount_minor,NEW.created_by);
  ELSE
    INSERT INTO fee_events(school_id,invoice_id,kind,amount_minor,actor_id,reason)
    VALUES(NEW.school_id,NEW.id,'invoice_voided',NEW.amount_minor,NEW.voided_by,NEW.void_reason);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION audit_fee_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO fee_events(school_id,invoice_id,payment_id,kind,amount_minor,actor_id)
    VALUES(NEW.school_id,NEW.invoice_id,NEW.id,'payment_recorded',NEW.amount_minor,NEW.recorded_by);
  ELSE
    INSERT INTO fee_events(school_id,invoice_id,payment_id,kind,amount_minor,actor_id,reason)
    VALUES(NEW.school_id,NEW.invoice_id,NEW.id,'payment_reversed',NEW.amount_minor,NEW.reversed_by,NEW.reversal_reason);
  END IF;
  RETURN NEW;
END; $$;

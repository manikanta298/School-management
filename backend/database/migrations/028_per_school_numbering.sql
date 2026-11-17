-- Per-school, gap-free invoice and receipt numbers. The counter row is updated inside the inserting transaction,
-- so a rollback (including a rejected overpayment) also rolls the counter back and no number is skipped.
CREATE TABLE school_counters (
 school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (name IN ('invoice','receipt')),
 next_value bigint NOT NULL CHECK (next_value >= 1),
 PRIMARY KEY (school_id, name)
);
INSERT INTO school_counters(school_id,name,next_value) SELECT school_id,'invoice',max(invoice_number)+1 FROM fee_invoices GROUP BY school_id;
INSERT INTO school_counters(school_id,name,next_value) SELECT school_id,'receipt',max(receipt_number)+1 FROM fee_payments GROUP BY school_id;
ALTER TABLE fee_invoices ALTER COLUMN invoice_number DROP IDENTITY;
ALTER TABLE fee_payments ALTER COLUMN receipt_number DROP IDENTITY;
ALTER TABLE fee_invoices DROP CONSTRAINT IF EXISTS fee_invoices_invoice_number_key;
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_receipt_number_key;
ALTER TABLE fee_invoices ADD CONSTRAINT fee_invoices_school_number_key UNIQUE (school_id, invoice_number);
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_school_number_key UNIQUE (school_id, receipt_number);
CREATE FUNCTION next_school_number(p_school uuid, p_name text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
 INSERT INTO school_counters(school_id,name,next_value) VALUES(p_school,p_name,2)
 ON CONFLICT (school_id,name) DO UPDATE SET next_value=school_counters.next_value+1
 RETURNING next_value-1 INTO v;
 RETURN v;
END; $$;
CREATE FUNCTION assign_invoice_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.invoice_number := next_school_number(NEW.school_id,'invoice'); RETURN NEW; END; $$;
CREATE FUNCTION assign_receipt_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.receipt_number := next_school_number(NEW.school_id,'receipt'); RETURN NEW; END; $$;
CREATE TRIGGER fee_invoices_number BEFORE INSERT ON fee_invoices FOR EACH ROW EXECUTE FUNCTION assign_invoice_number();
CREATE TRIGGER fee_payments_number BEFORE INSERT ON fee_payments FOR EACH ROW EXECUTE FUNCTION assign_receipt_number();

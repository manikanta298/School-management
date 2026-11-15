-- Enforce same-school ownership throughout attendance registers, entries and audit history.
-- Migration 018 assigned existing attendance records to the initial school.
ALTER TABLE attendance_registers
  ADD CONSTRAINT attendance_registers_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT attendance_registers_section_same_school_fk
    FOREIGN KEY (section_id, school_id) REFERENCES sections(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT attendance_registers_class_same_school_fk
    FOREIGN KEY (class_id, school_id) REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT attendance_registers_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE RESTRICT;

ALTER TABLE attendance_entries
  ADD CONSTRAINT attendance_entries_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT attendance_entries_register_same_school_fk
    FOREIGN KEY (register_id, school_id) REFERENCES attendance_registers(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT attendance_entries_student_same_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT attendance_entries_enrollment_same_school_fk
    FOREIGN KEY (enrollment_id, school_id) REFERENCES enrollments(id, school_id) ON DELETE RESTRICT;

ALTER TABLE attendance_audit
  ADD CONSTRAINT attendance_audit_entry_same_school_fk
    FOREIGN KEY (entry_id, school_id) REFERENCES attendance_entries(id, school_id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS attendance_entries_student_day_unique;
CREATE UNIQUE INDEX attendance_entries_school_student_day_unique
  ON attendance_entries(school_id, student_id, attendance_date) WHERE status <> 'void';

CREATE INDEX attendance_registers_school_section_date_idx
  ON attendance_registers(school_id, section_id, attendance_date);
CREATE INDEX attendance_entries_school_register_idx
  ON attendance_entries(school_id, register_id, student_id);
CREATE INDEX attendance_entries_school_student_date_idx
  ON attendance_entries(school_id, student_id, attendance_date);
CREATE INDEX attendance_audit_school_entry_idx
  ON attendance_audit(school_id, entry_id, id);

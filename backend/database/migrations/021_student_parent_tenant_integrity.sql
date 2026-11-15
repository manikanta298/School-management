-- Enforce same-school ownership for student, parent, enrollment and family links.
-- Migration 018 assigned all existing records to the initial school.
ALTER TABLE parents
  ADD CONSTRAINT parents_id_school_unique UNIQUE (id, school_id);

ALTER TABLE students
  DROP CONSTRAINT IF EXISTS students_admission_number_key;
CREATE UNIQUE INDEX students_school_admission_number_unique
  ON students(school_id, admission_number);

ALTER TABLE student_parents
  ADD CONSTRAINT student_parents_student_same_school_fk
    FOREIGN KEY (student_id, school_id)
    REFERENCES students(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT student_parents_parent_same_school_fk
    FOREIGN KEY (parent_id, school_id)
    REFERENCES parents(id, school_id) ON DELETE RESTRICT;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_student_same_school_fk
    FOREIGN KEY (student_id, school_id)
    REFERENCES students(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT enrollments_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id)
    REFERENCES academic_years(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT enrollments_class_same_school_fk
    FOREIGN KEY (class_id, school_id)
    REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT enrollments_section_same_school_fk
    FOREIGN KEY (section_id, school_id)
    REFERENCES sections(id, school_id) ON DELETE RESTRICT;

ALTER TABLE student_status_history
  ADD CONSTRAINT student_status_history_student_same_school_fk
    FOREIGN KEY (student_id, school_id)
    REFERENCES students(id, school_id) ON DELETE RESTRICT;

CREATE INDEX student_parents_school_parent_idx
  ON student_parents(school_id, parent_id, student_id);
CREATE INDEX enrollments_school_student_year_idx
  ON enrollments(school_id, student_id, academic_year_id);
CREATE INDEX student_status_history_school_student_idx
  ON student_status_history(school_id, student_id, changed_at DESC);

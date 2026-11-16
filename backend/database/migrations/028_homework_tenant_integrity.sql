-- Enforce same-school ownership for homework and homework completions.
-- Migration 018 assigned existing homework records to the initial school.
ALTER TABLE homework
  ADD CONSTRAINT homework_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT homework_section_same_school_fk
    FOREIGN KEY (section_id, school_id) REFERENCES sections(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT homework_class_same_school_fk
    FOREIGN KEY (class_id, school_id) REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT homework_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT homework_subject_same_school_fk
    FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT homework_teacher_same_school_fk
    FOREIGN KEY (teacher_id, school_id) REFERENCES teachers(id, school_id) ON DELETE RESTRICT;

ALTER TABLE homework_completions
  ADD CONSTRAINT homework_completions_homework_same_school_fk
    FOREIGN KEY (homework_id, school_id) REFERENCES homework(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT homework_completions_student_same_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT;

CREATE INDEX homework_school_section_due_idx ON homework(school_id, section_id, due_on);
CREATE INDEX homework_school_class_year_idx ON homework(school_id, class_id, academic_year_id);
CREATE INDEX homework_completions_school_student_idx ON homework_completions(school_id, student_id);

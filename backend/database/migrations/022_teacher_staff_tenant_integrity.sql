-- Enforce same-school ownership for teacher profiles, assignments and staff.
-- Existing records retain the school_id assigned by migration 018.
ALTER TABLE teachers
  DROP CONSTRAINT IF EXISTS teachers_user_id_key,
  DROP CONSTRAINT IF EXISTS teachers_employee_number_key,
  ADD CONSTRAINT teachers_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT teachers_school_user_unique UNIQUE (school_id, user_id);
CREATE UNIQUE INDEX teachers_school_employee_number_unique
  ON teachers(school_id, employee_number);
CREATE INDEX teachers_school_status_idx
  ON teachers(school_id, employment_status);

ALTER TABLE teacher_assignments
  ADD CONSTRAINT teacher_assignments_teacher_same_school_fk
    FOREIGN KEY (teacher_id, school_id)
    REFERENCES teachers(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT teacher_assignments_class_same_school_fk
    FOREIGN KEY (class_id, school_id)
    REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT teacher_assignments_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id)
    REFERENCES academic_years(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT teacher_assignments_subject_same_school_fk
    FOREIGN KEY (subject_id, school_id)
    REFERENCES subjects(id, school_id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS teacher_assignments_class_teacher_unique;
DROP INDEX IF EXISTS teacher_assignments_subject_unique;
CREATE UNIQUE INDEX teacher_assignments_school_class_teacher_unique
  ON teacher_assignments(school_id, class_id) WHERE kind='class_teacher';
CREATE UNIQUE INDEX teacher_assignments_school_subject_unique
  ON teacher_assignments(school_id, class_id, subject_id) WHERE kind='subject_teacher';
CREATE INDEX teacher_assignments_school_teacher_idx
  ON teacher_assignments(school_id, teacher_id, class_id);

ALTER TABLE staff_members
  DROP CONSTRAINT IF EXISTS staff_members_employee_number_key;
CREATE UNIQUE INDEX staff_members_school_employee_number_unique
  ON staff_members(school_id, employee_number);
CREATE INDEX staff_members_school_type_status_idx
  ON staff_members(school_id, staff_type, employment_status);

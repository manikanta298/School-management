-- Scope academic catalogue records and enforce same-school parent relationships.
ALTER TABLE academic_years
  ADD CONSTRAINT academic_years_id_school_unique UNIQUE (id, school_id);
ALTER TABLE terms
  ADD CONSTRAINT terms_id_school_unique UNIQUE (id, school_id);
ALTER TABLE classes
  ADD CONSTRAINT classes_id_school_unique UNIQUE (id, school_id);
ALTER TABLE sections
  ADD CONSTRAINT sections_id_school_unique UNIQUE (id, school_id);
ALTER TABLE subjects
  ADD CONSTRAINT subjects_id_school_unique UNIQUE (id, school_id);

ALTER TABLE terms
  ADD CONSTRAINT terms_year_same_school_fk
  FOREIGN KEY (academic_year_id, school_id)
  REFERENCES academic_years(id, school_id) ON DELETE RESTRICT;
ALTER TABLE classes
  ADD CONSTRAINT classes_year_same_school_fk
  FOREIGN KEY (academic_year_id, school_id)
  REFERENCES academic_years(id, school_id) ON DELETE RESTRICT;
ALTER TABLE sections
  ADD CONSTRAINT sections_class_same_school_fk
  FOREIGN KEY (class_id, school_id)
  REFERENCES classes(id, school_id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS academic_years_name_unique;
CREATE UNIQUE INDEX academic_years_school_name_unique
  ON academic_years(school_id, lower(name));
DROP INDEX IF EXISTS academic_years_single_current;
CREATE UNIQUE INDEX academic_years_school_single_current
  ON academic_years(school_id) WHERE is_current;

CREATE INDEX academic_years_school_dates_idx
  ON academic_years(school_id, start_date, end_date);
CREATE INDEX terms_school_year_dates_idx
  ON terms(school_id, academic_year_id, start_date, end_date);
CREATE INDEX classes_school_year_idx
  ON classes(school_id, academic_year_id);
CREATE INDEX sections_school_class_idx
  ON sections(school_id, class_id);

ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_code_key;
DROP INDEX IF EXISTS subjects_name_unique;
CREATE UNIQUE INDEX subjects_school_code_unique
  ON subjects(school_id, code);
CREATE UNIQUE INDEX subjects_school_name_unique
  ON subjects(school_id, lower(name));
CREATE INDEX subjects_school_idx ON subjects(school_id);

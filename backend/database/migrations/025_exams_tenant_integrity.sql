-- Enforce same-school ownership for grading scales, exams, candidates, papers, marks and audit history.
-- Migration 018 assigned existing exam records (including the default grading scale) to the initial school.
-- Depends on 023 (enrollments_id_school_unique); guarded so it also applies if 023 is absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enrollments_id_school_unique') THEN
    ALTER TABLE enrollments ADD CONSTRAINT enrollments_id_school_unique UNIQUE (id, school_id);
  END IF;
END $$;

ALTER TABLE exam_grading_scales
  ADD CONSTRAINT exam_grading_scales_id_school_unique UNIQUE (id, school_id);
DROP INDEX IF EXISTS exam_grading_scales_name_unique;
CREATE UNIQUE INDEX exam_grading_scales_school_name_unique ON exam_grading_scales(school_id, lower(name));

ALTER TABLE exam_grade_bands
  ADD CONSTRAINT exam_grade_bands_scale_same_school_fk
    FOREIGN KEY (scale_id, school_id) REFERENCES exam_grading_scales(id, school_id) ON DELETE RESTRICT;

ALTER TABLE exams
  ADD CONSTRAINT exams_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT exams_class_same_school_fk
    FOREIGN KEY (class_id, school_id) REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exams_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exams_term_same_school_fk
    FOREIGN KEY (term_id, school_id) REFERENCES terms(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exams_scale_same_school_fk
    FOREIGN KEY (grading_scale_id, school_id) REFERENCES exam_grading_scales(id, school_id) ON DELETE RESTRICT;

ALTER TABLE exam_candidates
  ADD CONSTRAINT exam_candidates_exam_same_school_fk
    FOREIGN KEY (exam_id, school_id) REFERENCES exams(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exam_candidates_student_same_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exam_candidates_enrollment_same_school_fk
    FOREIGN KEY (enrollment_id, school_id) REFERENCES enrollments(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exam_candidates_section_same_school_fk
    FOREIGN KEY (section_id, school_id) REFERENCES sections(id, school_id) ON DELETE RESTRICT;

ALTER TABLE exam_papers
  ADD CONSTRAINT exam_papers_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT exam_papers_exam_same_school_fk
    FOREIGN KEY (exam_id, school_id) REFERENCES exams(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exam_papers_subject_same_school_fk
    FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id) ON DELETE RESTRICT;

ALTER TABLE exam_marks
  ADD CONSTRAINT exam_marks_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT exam_marks_exam_same_school_fk
    FOREIGN KEY (exam_id, school_id) REFERENCES exams(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exam_marks_paper_same_school_fk
    FOREIGN KEY (paper_id, school_id) REFERENCES exam_papers(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT exam_marks_student_same_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT;

ALTER TABLE exam_mark_audit
  ADD CONSTRAINT exam_mark_audit_mark_same_school_fk
    FOREIGN KEY (mark_id, school_id) REFERENCES exam_marks(id, school_id) ON DELETE RESTRICT;

ALTER TABLE exam_events
  ADD CONSTRAINT exam_events_exam_same_school_fk
    FOREIGN KEY (exam_id, school_id) REFERENCES exams(id, school_id) ON DELETE RESTRICT;

CREATE INDEX exams_school_class_year_idx ON exams(school_id, class_id, academic_year_id);
CREATE INDEX exam_candidates_school_exam_idx ON exam_candidates(school_id, exam_id, student_id);
CREATE INDEX exam_papers_school_exam_idx ON exam_papers(school_id, exam_id);
CREATE INDEX exam_marks_school_exam_student_idx ON exam_marks(school_id, exam_id, student_id);
CREATE INDEX exam_mark_audit_school_mark_idx ON exam_mark_audit(school_id, mark_id, id);
CREATE INDEX exam_events_school_exam_idx ON exam_events(school_id, exam_id, id);

-- Audit triggers must write the owning school on every audit row.
CREATE OR REPLACE FUNCTION audit_exam_mark() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO exam_mark_audit(school_id,mark_id,new_outcome,new_score,new_remark,changed_by)
  VALUES(NEW.school_id,NEW.id,NEW.outcome,NEW.score,NEW.remark,NEW.updated_by);
 ELSIF (NEW.outcome,NEW.score,NEW.remark) IS DISTINCT FROM (OLD.outcome,OLD.score,OLD.remark) THEN
  INSERT INTO exam_mark_audit(school_id,mark_id,previous_outcome,previous_score,previous_remark,new_outcome,new_score,new_remark,reason,changed_by)
  VALUES(NEW.school_id,NEW.id,OLD.outcome,OLD.score,OLD.remark,NEW.outcome,NEW.score,NEW.remark,NEW.change_reason,NEW.updated_by);
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION audit_exam_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO exam_events(school_id,exam_id,action,actor_id) VALUES(NEW.school_id,NEW.id,'created',NEW.created_by);
 ELSE
  INSERT INTO exam_events(school_id,exam_id,action,reason,actor_id)
  VALUES(NEW.school_id,NEW.id,CASE NEW.status WHEN 'published' THEN 'published' WHEN 'cancelled' THEN 'cancelled' ELSE 'reopened' END,NEW.action_reason,NEW.updated_by);
 END IF;
 RETURN NEW;
END; $$;

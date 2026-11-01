ALTER TABLE terms ADD CONSTRAINT terms_id_year_unique UNIQUE(id,academic_year_id);
CREATE TABLE exam_grading_scales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL CHECK(length(trim(name))>0)
);
CREATE UNIQUE INDEX exam_grading_scales_name_unique ON exam_grading_scales(lower(name));
CREATE TABLE exam_grade_bands (
 scale_id uuid NOT NULL REFERENCES exam_grading_scales(id) ON DELETE RESTRICT,
 minimum_percent integer NOT NULL CHECK(minimum_percent BETWEEN 0 AND 100),
 label varchar(5) NOT NULL CHECK(label ~ '^[A-Z0-9+-]{1,5}$'),
 PRIMARY KEY(scale_id,minimum_percent), UNIQUE(scale_id,label)
);
INSERT INTO exam_grading_scales(id,name) VALUES('00000000-0000-4000-8000-000000000007','Default A–F');
INSERT INTO exam_grade_bands(scale_id,minimum_percent,label) VALUES
 ('00000000-0000-4000-8000-000000000007',90,'A'),('00000000-0000-4000-8000-000000000007',80,'B'),
 ('00000000-0000-4000-8000-000000000007',70,'C'),('00000000-0000-4000-8000-000000000007',60,'D'),
 ('00000000-0000-4000-8000-000000000007',50,'E'),('00000000-0000-4000-8000-000000000007',0,'F');
CREATE TABLE exams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL,academic_year_id uuid NOT NULL,
 term_id uuid, grading_scale_id uuid NOT NULL REFERENCES exam_grading_scales(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),start_date date NOT NULL,end_date date NOT NULL CHECK(end_date>=start_date),
 status varchar(10) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action_reason varchar(200),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,class_id),
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT,
 FOREIGN KEY(term_id,academic_year_id) REFERENCES terms(id,academic_year_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX exams_name_unique ON exams(class_id,lower(name)) WHERE status<>'cancelled';
CREATE INDEX exams_class_year_idx ON exams(class_id,academic_year_id);
CREATE INDEX exams_year_idx ON exams(academic_year_id);
CREATE INDEX exams_term_idx ON exams(term_id,academic_year_id);
CREATE INDEX exams_scale_idx ON exams(grading_scale_id);
CREATE INDEX exams_creator_idx ON exams(created_by);
CREATE INDEX exams_updater_idx ON exams(updated_by);
CREATE TABLE exam_candidates (
 exam_id uuid NOT NULL,student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
 section_id uuid NOT NULL,class_id uuid NOT NULL,
 PRIMARY KEY(exam_id,student_id),
 FOREIGN KEY(exam_id,class_id) REFERENCES exams(id,class_id) ON DELETE RESTRICT,
 FOREIGN KEY(section_id,class_id) REFERENCES sections(id,class_id) ON DELETE RESTRICT
);
CREATE INDEX exam_candidates_student_idx ON exam_candidates(student_id,exam_id);
CREATE INDEX exam_candidates_enrollment_idx ON exam_candidates(enrollment_id);
CREATE INDEX exam_candidates_section_idx ON exam_candidates(section_id,class_id);
CREATE TABLE exam_papers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE RESTRICT,
 subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
 held_on date NOT NULL,max_marks integer NOT NULL CHECK(max_marks BETWEEN 1 AND 1000),
 pass_marks integer NOT NULL CHECK(pass_marks BETWEEN 0 AND max_marks),version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 UNIQUE(exam_id,subject_id),UNIQUE(id,exam_id)
);
CREATE INDEX exam_papers_subject_idx ON exam_papers(subject_id);
CREATE TABLE exam_marks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),exam_id uuid NOT NULL,paper_id uuid NOT NULL,student_id uuid NOT NULL,
 outcome varchar(8) NOT NULL CHECK(outcome IN ('scored','absent','exempt')),
 score integer CHECK(score>=0),remark varchar(200),change_reason varchar(200),
 updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(paper_id,student_id),
 CHECK((outcome='scored' AND score IS NOT NULL) OR (outcome<>'scored' AND score IS NULL)),
 CHECK(outcome<>'exempt' OR (remark IS NOT NULL AND length(trim(remark))>=3)),
 FOREIGN KEY(paper_id,exam_id) REFERENCES exam_papers(id,exam_id) ON DELETE RESTRICT,
 FOREIGN KEY(exam_id,student_id) REFERENCES exam_candidates(exam_id,student_id) ON DELETE RESTRICT
);
CREATE INDEX exam_marks_candidate_idx ON exam_marks(exam_id,student_id);
CREATE INDEX exam_marks_actor_idx ON exam_marks(updated_by);
CREATE TABLE exam_mark_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,mark_id uuid NOT NULL REFERENCES exam_marks(id) ON DELETE RESTRICT,
 previous_outcome varchar(8) CHECK(previous_outcome IS NULL OR previous_outcome IN ('scored','absent','exempt')),previous_score integer CHECK(previous_score>=0),previous_remark varchar(200),
 new_outcome varchar(8) NOT NULL CHECK(new_outcome IN ('scored','absent','exempt')),new_score integer CHECK(new_score>=0),new_remark varchar(200),
 reason varchar(200),changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,changed_at timestamptz NOT NULL DEFAULT now(),
 CHECK((new_outcome='scored' AND new_score IS NOT NULL) OR (new_outcome<>'scored' AND new_score IS NULL)),
 CHECK(previous_outcome IS NULL OR (reason IS NOT NULL AND length(trim(reason))>=3))
);
CREATE INDEX exam_mark_audit_mark_idx ON exam_mark_audit(mark_id,id);
CREATE INDEX exam_mark_audit_actor_idx ON exam_mark_audit(changed_by);
CREATE TABLE exam_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE RESTRICT,
 action varchar(12) NOT NULL CHECK(action IN ('created','published','reopened','cancelled')),
 reason varchar(200),actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,occurred_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action NOT IN ('reopened','cancelled') OR (reason IS NOT NULL AND length(trim(reason))>=3))
);
CREATE INDEX exam_events_exam_idx ON exam_events(exam_id,id);
CREATE INDEX exam_events_actor_idx ON exam_events(actor_id);
CREATE FUNCTION guard_exam() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y academic_years;t terms;
BEGIN
 IF TG_OP='INSERT' THEN
 SELECT * INTO y FROM academic_years WHERE id=NEW.academic_year_id FOR SHARE;
 SELECT * INTO t FROM terms WHERE id=NEW.term_id FOR SHARE;
 PERFORM id FROM exam_grading_scales WHERE id=NEW.grading_scale_id FOR SHARE;
 IF NEW.status<>'draft' OR NOT EXISTS(SELECT 1 FROM exam_grade_bands WHERE scale_id=NEW.grading_scale_id AND minimum_percent=0) THEN RAISE EXCEPTION 'Exam needs a complete grading scale and draft state' USING ERRCODE='23514'; END IF;
 IF y.id IS NULL OR NEW.start_date<y.start_date OR NEW.end_date>y.end_date OR (NEW.term_id IS NOT NULL AND (t.id IS NULL OR t.academic_year_id<>NEW.academic_year_id OR NEW.start_date<t.start_date OR NEW.end_date>t.end_date)) THEN RAISE EXCEPTION 'Exam dates must fit year and optional term' USING ERRCODE='23514'; END IF;
 ELSE
 IF (NEW.id,NEW.class_id,NEW.academic_year_id,NEW.term_id,NEW.grading_scale_id,NEW.name,NEW.start_date,NEW.end_date,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.class_id,OLD.academic_year_id,OLD.term_id,OLD.grading_scale_id,OLD.name,OLD.start_date,OLD.end_date,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Exam setup is immutable; cancel and replace an incorrect exam' USING ERRCODE='23514'; END IF;
 IF OLD.status='draft' AND NEW.status='published' THEN
 IF NEW.end_date>CURRENT_DATE OR NOT EXISTS(SELECT 1 FROM exam_candidates WHERE exam_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM exam_papers WHERE exam_id=NEW.id) OR EXISTS(SELECT 1 FROM exam_candidates c CROSS JOIN exam_papers p WHERE c.exam_id=NEW.id AND p.exam_id=NEW.id AND NOT EXISTS(SELECT 1 FROM exam_marks m WHERE m.paper_id=p.id AND m.student_id=c.student_id)) THEN RAISE EXCEPTION 'Finish the exam and mark every candidate/paper before publication' USING ERRCODE='23514'; END IF;
 ELSIF (OLD.status='published' AND NEW.status='draft') OR (OLD.status='draft' AND NEW.status='cancelled') THEN
 IF NEW.action_reason IS NULL OR length(trim(NEW.action_reason))<3 THEN RAISE EXCEPTION 'Action reason required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Invalid exam state transition' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER exams_guard BEFORE INSERT OR UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION guard_exam();
CREATE FUNCTION guard_exam_scale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid;
BEGIN
 IF TG_OP='DELETE' THEN sid=OLD.scale_id; ELSE sid=NEW.scale_id; END IF;
 PERFORM id FROM exam_grading_scales WHERE id=sid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM exams WHERE grading_scale_id=sid) OR (TG_OP='UPDATE' AND NEW.scale_id<>OLD.scale_id) THEN RAISE EXCEPTION 'Referenced grading rules are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER exam_grade_bands_guard BEFORE INSERT OR UPDATE OR DELETE ON exam_grade_bands FOR EACH ROW EXECUTE FUNCTION guard_exam_scale();
CREATE FUNCTION guard_exam_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ex exams;en enrollments;
BEGIN
 IF TG_OP='DELETE' THEN SELECT * INTO ex FROM exams WHERE id=OLD.exam_id FOR SHARE; ELSE SELECT * INTO ex FROM exams WHERE id=NEW.exam_id FOR SHARE; END IF;
 IF ex.status<>'draft' THEN RAISE EXCEPTION 'Candidates can change only in draft exams' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Candidate identity is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO en FROM enrollments WHERE id=NEW.enrollment_id FOR SHARE;
 IF en.id IS NULL OR en.student_id<>NEW.student_id OR en.class_id<>ex.class_id OR en.academic_year_id<>ex.academic_year_id OR en.section_id<>NEW.section_id OR NEW.class_id<>ex.class_id OR en.status<>'active' OR en.enrolled_on>ex.start_date THEN RAISE EXCEPTION 'Candidate needs a matching active enrollment before exam start' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER exam_candidates_guard BEFORE INSERT OR UPDATE OR DELETE ON exam_candidates FOR EACH ROW EXECUTE FUNCTION guard_exam_candidate();
CREATE FUNCTION guard_exam_paper() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ex exams;
BEGIN
 IF TG_OP='DELETE' THEN SELECT * INTO ex FROM exams WHERE id=OLD.exam_id FOR SHARE; ELSE SELECT * INTO ex FROM exams WHERE id=NEW.exam_id FOR SHARE; END IF;
 IF ex.status<>'draft' THEN RAISE EXCEPTION 'Paper can change only in draft exam' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.held_on<ex.start_date OR NEW.held_on>ex.end_date THEN RAISE EXCEPTION 'Paper date must fit exam' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.exam_id) IS DISTINCT FROM (OLD.id,OLD.exam_id) OR ((NEW.subject_id,NEW.held_on,NEW.max_marks,NEW.pass_marks) IS DISTINCT FROM (OLD.subject_id,OLD.held_on,OLD.max_marks,OLD.pass_marks) AND EXISTS(SELECT 1 FROM exam_marks WHERE paper_id=OLD.id))) THEN RAISE EXCEPTION 'Marked paper setup is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER exam_papers_guard BEFORE INSERT OR UPDATE OR DELETE ON exam_papers FOR EACH ROW EXECUTE FUNCTION guard_exam_paper();
CREATE FUNCTION guard_exam_mark() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ex exams;p exam_papers;
BEGIN
 SELECT * INTO ex FROM exams WHERE id=NEW.exam_id FOR SHARE;
 SELECT * INTO p FROM exam_papers WHERE id=NEW.paper_id;
 IF ex.status<>'draft' OR p.exam_id<>NEW.exam_id OR p.held_on>CURRENT_DATE OR NEW.score>p.max_marks THEN RAISE EXCEPTION 'Invalid score, future paper or closed exam' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
 IF (NEW.id,NEW.exam_id,NEW.paper_id,NEW.student_id) IS DISTINCT FROM (OLD.id,OLD.exam_id,OLD.paper_id,OLD.student_id) THEN RAISE EXCEPTION 'Mark identity is immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.outcome,NEW.score,NEW.remark) IS DISTINCT FROM (OLD.outcome,OLD.score,OLD.remark) AND (NEW.change_reason IS NULL OR length(trim(NEW.change_reason))<3) THEN RAISE EXCEPTION 'Mark correction reason required' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER exam_marks_guard BEFORE INSERT OR UPDATE ON exam_marks FOR EACH ROW EXECUTE FUNCTION guard_exam_mark();
CREATE FUNCTION audit_exam_mark() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO exam_mark_audit(mark_id,new_outcome,new_score,new_remark,changed_by) VALUES(NEW.id,NEW.outcome,NEW.score,NEW.remark,NEW.updated_by);
 ELSIF (NEW.outcome,NEW.score,NEW.remark) IS DISTINCT FROM (OLD.outcome,OLD.score,OLD.remark) THEN INSERT INTO exam_mark_audit(mark_id,previous_outcome,previous_score,previous_remark,new_outcome,new_score,new_remark,reason,changed_by) VALUES(NEW.id,OLD.outcome,OLD.score,OLD.remark,NEW.outcome,NEW.score,NEW.remark,NEW.change_reason,NEW.updated_by); END IF; RETURN NEW;
END; $$;
CREATE TRIGGER exam_marks_audit AFTER INSERT OR UPDATE ON exam_marks FOR EACH ROW EXECUTE FUNCTION audit_exam_mark();
CREATE FUNCTION audit_exam_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO exam_events(exam_id,action,actor_id) VALUES(NEW.id,'created',NEW.created_by);
 ELSE INSERT INTO exam_events(exam_id,action,reason,actor_id) VALUES(NEW.id,CASE NEW.status WHEN 'published' THEN 'published' WHEN 'cancelled' THEN 'cancelled' ELSE 'reopened' END,NEW.action_reason,NEW.updated_by); END IF; RETURN NEW;
END; $$;
CREATE TRIGGER exams_audit AFTER INSERT OR UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION audit_exam_event();
CREATE TRIGGER exam_mark_audit_protect BEFORE UPDATE OR DELETE ON exam_mark_audit FOR EACH ROW EXECUTE FUNCTION protect_attendance_audit();
CREATE TRIGGER exam_events_protect BEFORE UPDATE OR DELETE ON exam_events FOR EACH ROW EXECUTE FUNCTION protect_attendance_audit();
CREATE FUNCTION protect_exam_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM exam_candidates c JOIN exams e ON e.id=c.exam_id WHERE c.enrollment_id=NEW.id AND (c.student_id<>NEW.student_id OR e.academic_year_id<>NEW.academic_year_id OR NEW.enrolled_on>e.start_date)) THEN RAISE EXCEPTION 'Enrollment change conflicts with registered exam candidate' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER enrollments_exam_guard BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION protect_exam_enrollment();
CREATE FUNCTION protect_exam_term() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM exams WHERE term_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) THEN RAISE EXCEPTION 'Term dates must contain existing exams' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER terms_exam_guard BEFORE UPDATE ON terms FOR EACH ROW EXECUTE FUNCTION protect_exam_term();
CREATE OR REPLACE FUNCTION validate_year_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM enrollments WHERE academic_year_id=NEW.id AND (enrolled_on<NEW.start_date OR enrolled_on>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE a.academic_year_id=NEW.id AND t.joining_date>NEW.end_date) OR
 EXISTS(SELECT 1 FROM attendance_registers WHERE academic_year_id=NEW.id AND (attendance_date<NEW.start_date OR attendance_date>NEW.end_date)) OR
 EXISTS(SELECT 1 FROM exams WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) THEN RAISE EXCEPTION 'Existing academic records must fit year' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;

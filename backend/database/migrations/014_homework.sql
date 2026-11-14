CREATE TABLE homework (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 section_id uuid NOT NULL,
 class_id uuid NOT NULL,
 academic_year_id uuid NOT NULL,
 subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
 teacher_id uuid REFERENCES teachers(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 title varchar(150) NOT NULL CHECK(length(trim(title))>0),
 details varchar(5000) NOT NULL CHECK(length(trim(details))>0),
 assigned_on date NOT NULL,
 due_on date NOT NULL,
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(due_on>=assigned_on),
 FOREIGN KEY(section_id,class_id) REFERENCES sections(id,class_id) ON DELETE RESTRICT,
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) ON DELETE RESTRICT
);
CREATE INDEX homework_section_due_idx ON homework(section_id,due_on);
CREATE INDEX homework_class_year_idx ON homework(class_id,academic_year_id);
CREATE INDEX homework_subject_idx ON homework(subject_id);
CREATE INDEX homework_teacher_idx ON homework(teacher_id);
CREATE INDEX homework_creator_idx ON homework(created_by);
CREATE TABLE homework_completions (
 homework_id uuid NOT NULL REFERENCES homework(id) ON DELETE RESTRICT,
 student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
 completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(homework_id,student_id)
);
CREATE INDEX homework_completions_student_idx ON homework_completions(student_id);

-- Multi-tenant foundation.
-- Existing rows are assigned to one initial school. Application-level tenant
-- enforcement and tenant-aware composite foreign keys are introduced in follow-up work.

CREATE TABLE schools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(150) NOT NULL
        CHECK (length(trim(name)) BETWEEN 1 AND 150),
    slug varchar(80) NOT NULL UNIQUE
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    status varchar(12) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'archived')),
    timezone varchar(60) NOT NULL DEFAULT 'Asia/Kolkata',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE school_memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role varchar(10) NOT NULL
        CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
    status varchar(10) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'suspended')),
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, school_id),
    UNIQUE (id, school_id)
);

CREATE UNIQUE INDEX school_memberships_one_default_per_user
    ON school_memberships(user_id)
    WHERE is_default = true;

CREATE INDEX school_memberships_school_role_idx
    ON school_memberships(school_id, role, status);

CREATE INDEX school_memberships_user_status_idx
    ON school_memberships(user_id, status);

-- Create the initial tenant. Rename this school after migration using real
-- school details; do not create a second tenant until API isolation is complete.
INSERT INTO schools (name, slug)
VALUES ('Existing School', 'existing-school');

-- Preserve every existing account and its current role as a membership.
INSERT INTO school_memberships (
    school_id, user_id, role, status, is_default
)
SELECT
    (SELECT id FROM schools WHERE slug = 'existing-school'),
    id,
    role,
    CASE WHEN active THEN 'active' ELSE 'inactive' END,
    true
FROM users;

-- Scope all current school-owned tables to the initial tenant.
DO $$
DECLARE
    table_name text;
    first_school_id uuid;
    tenant_tables text[] := ARRAY[
        'academic_years', 'terms', 'classes', 'sections', 'subjects',
        'students', 'parents', 'student_parents', 'enrollments',
        'teachers', 'teacher_assignments',
        'attendance_registers', 'attendance_entries', 'attendance_audit',
        'fee_structures', 'fee_invoices', 'fee_payments', 'fee_events',
        'exam_grading_scales', 'exam_grade_bands', 'exams',
        'exam_candidates', 'exam_papers', 'exam_marks', 'exam_mark_audit',
        'exam_events', 'school_rooms', 'timetable_slots', 'timetable_audit',
        'notices', 'notice_reads', 'notice_audit',
        'student_status_history', 'staff_members', 'homework',
        'homework_completions', 'transport_vehicles', 'transport_routes',
        'transport_stops', 'transport_allocations', 'school_events'
    ];
BEGIN
    SELECT id INTO STRICT first_school_id
    FROM schools
    WHERE slug = 'existing-school';

    FOREACH table_name IN ARRAY tenant_tables LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD COLUMN school_id uuid',
            table_name
        );

        EXECUTE format(
            'UPDATE %I SET school_id = $1 WHERE school_id IS NULL',
            table_name
        ) USING first_school_id;

        EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN school_id SET NOT NULL',
            table_name
        );

        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I
             FOREIGN KEY (school_id) REFERENCES schools(id)
             ON DELETE RESTRICT',
            table_name,
            table_name || '_school_id_fkey'
        );

        EXECUTE format(
            'CREATE INDEX %I ON %I (school_id)',
            table_name || '_school_id_idx',
            table_name
        );
    END LOOP;
END $$;

-- Bind each existing authenticated session to the user's initial-school
-- membership. The next auth change will resolve this context on every request.
ALTER TABLE auth_sessions
    ADD COLUMN active_school_id uuid;

UPDATE auth_sessions
SET active_school_id = (
    SELECT id FROM schools WHERE slug = 'existing-school'
);

ALTER TABLE auth_sessions
    ALTER COLUMN active_school_id SET NOT NULL;

ALTER TABLE auth_sessions
    ADD CONSTRAINT auth_sessions_school_membership_fkey
    FOREIGN KEY (user_id, active_school_id)
    REFERENCES school_memberships(user_id, school_id)
    ON DELETE RESTRICT;

CREATE INDEX auth_sessions_active_school_idx
    ON auth_sessions(active_school_id);

COMMENT ON TABLE schools IS
    'Tenant root: each school owns its school-scoped academic and operational data.';
COMMENT ON TABLE school_memberships IS
    'Maps a global user identity to a school-specific role and membership status.';
COMMENT ON COLUMN auth_sessions.active_school_id IS
    'School context selected for this authenticated session.';

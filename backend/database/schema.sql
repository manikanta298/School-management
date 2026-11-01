-- Complete application schema through Module 2. Use migrations to upgrade.
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(100) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
 email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
 password_hash text NOT NULL,
 role varchar(10) NOT NULL CHECK (role IN ('admin','teacher','student','parent')),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash char(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);
CREATE INDEX users_role_idx ON users(role);

CREATE TABLE academic_years (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 start_date date NOT NULL, end_date date NOT NULL,
 is_current boolean NOT NULL DEFAULT false,
 CHECK(end_date>=start_date)
);
CREATE UNIQUE INDEX academic_years_name_unique ON academic_years(lower(name));
CREATE UNIQUE INDEX academic_years_single_current ON academic_years(is_current) WHERE is_current;
CREATE TABLE terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 start_date date NOT NULL, end_date date NOT NULL,
 CHECK(end_date>=start_date)
);
CREATE UNIQUE INDEX terms_name_unique ON terms(academic_year_id,lower(name));
CREATE INDEX terms_dates_idx ON terms(academic_year_id,start_date,end_date);
CREATE TABLE classes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0)
);
CREATE UNIQUE INDEX classes_name_unique ON classes(academic_year_id,lower(name));
CREATE TABLE sections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX sections_name_unique ON sections(class_id,lower(name));
CREATE TABLE subjects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(100) NOT NULL CHECK(length(trim(name))>0),
 code varchar(20) NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9_-]{1,20}$')
);
CREATE UNIQUE INDEX subjects_name_unique ON subjects(lower(name));
CREATE FUNCTION validate_term_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y academic_years;
BEGIN
 SELECT * INTO y FROM academic_years WHERE id=NEW.academic_year_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Academic year does not exist' USING ERRCODE='23503'; END IF;
 IF NEW.start_date<y.start_date OR NEW.end_date>y.end_date THEN
 RAISE EXCEPTION 'Term dates must fall within academic year' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.academic_year_id AND id<>NEW.id AND start_date<=NEW.end_date AND end_date>=NEW.start_date) THEN
 RAISE EXCEPTION 'Term dates overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER terms_validate_dates BEFORE INSERT OR UPDATE ON terms FOR EACH ROW EXECUTE FUNCTION validate_term_dates();
CREATE FUNCTION validate_year_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE academic_year_id=NEW.id AND (start_date<NEW.start_date OR end_date>NEW.end_date)) THEN
 RAISE EXCEPTION 'Existing terms must fit within academic year' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER years_validate_dates BEFORE UPDATE ON academic_years FOR EACH ROW EXECUTE FUNCTION validate_year_dates();

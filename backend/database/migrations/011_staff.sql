CREATE TABLE staff_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_number varchar(30) NOT NULL UNIQUE CHECK(employee_number ~ '^[A-Z0-9_-]{1,30}$'),
 name varchar(100) NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 staff_type varchar(20) NOT NULL CHECK(staff_type IN ('accountant','receptionist','administrative','transport','librarian','attender','security')),
 phone varchar(30) CHECK(phone IS NULL OR phone ~ '^[+0-9() .-]{7,30}$'),
 email varchar(254) CHECK(email IS NULL OR email=lower(email)),
 address varchar(500),
 joining_date date NOT NULL CHECK(joining_date<=CURRENT_DATE),
 employment_status varchar(8) NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_members_type_status_idx ON staff_members(staff_type,employment_status);

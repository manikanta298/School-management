-- Adds Principal, Accountant, Receptionist, Librarian and Transport Manager roles.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ALTER COLUMN role TYPE varchar(20);
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','principal','accountant','receptionist','librarian','transport_manager','teacher','student','parent'));
ALTER TABLE school_memberships DROP CONSTRAINT school_memberships_role_check;
ALTER TABLE school_memberships ALTER COLUMN role TYPE varchar(20);
ALTER TABLE school_memberships ADD CONSTRAINT school_memberships_role_check CHECK (role IN ('admin','principal','accountant','receptionist','librarian','transport_manager','teacher','student','parent'));

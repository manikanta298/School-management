CREATE TABLE notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title varchar(150) NOT NULL CHECK(length(trim(title))>0),
 body varchar(5000) NOT NULL CHECK(length(trim(body))>0),
 audience varchar(10) NOT NULL DEFAULT 'all' CHECK(audience IN ('all','admin','teacher','student','parent')),
 class_id uuid,academic_year_id uuid,section_id uuid,
 priority varchar(10) NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','important','urgent')),
 available_from timestamptz NOT NULL,expires_at timestamptz CHECK(expires_at>available_from),
 status varchar(10) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),content_revision integer NOT NULL DEFAULT 1 CHECK(content_revision>0),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action_reason varchar(200),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(section_id IS NULL OR class_id IS NOT NULL),
 FOREIGN KEY(class_id,academic_year_id) REFERENCES classes(id,academic_year_id) MATCH FULL ON DELETE RESTRICT,
 FOREIGN KEY(section_id,class_id) REFERENCES sections(id,class_id) ON DELETE RESTRICT
);
CREATE INDEX notices_visible_idx ON notices(status,available_from,expires_at);
CREATE INDEX notices_class_year_idx ON notices(class_id,academic_year_id);
CREATE INDEX notices_year_idx ON notices(academic_year_id);
CREATE INDEX notices_section_idx ON notices(section_id,class_id);
CREATE INDEX notices_creator_idx ON notices(created_by);
CREATE INDEX notices_actor_idx ON notices(updated_by);
CREATE TABLE notice_reads (
 notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 content_revision integer NOT NULL CHECK(content_revision>0),read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(notice_id,user_id,content_revision)
);
CREATE INDEX notice_reads_user_idx ON notice_reads(user_id,notice_id,content_revision);
CREATE TABLE notice_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE RESTRICT,
 action varchar(12) NOT NULL CHECK(action IN ('created','updated','published','unpublished','archived','restored')),
 previous_values jsonb,new_values jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,reason varchar(200),occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notice_audit_notice_idx ON notice_audit(notice_id,id);
CREATE INDEX notice_audit_actor_idx ON notice_audit(actor_id);
CREATE FUNCTION guard_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean;
BEGIN
 IF TG_OP='INSERT' THEN
 IF NEW.status<>'draft' OR NEW.version<>1 OR NEW.content_revision<>1 THEN RAISE EXCEPTION 'Notices start as draft revision one' USING ERRCODE='23514';END IF;
 ELSE
 IF (NEW.id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.created_by,OLD.created_at) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Notice identity/version is protected' USING ERRCODE='23514';END IF;
 changed=(NEW.title,NEW.body,NEW.audience,NEW.class_id,NEW.academic_year_id,NEW.section_id,NEW.priority,NEW.available_from,NEW.expires_at) IS DISTINCT FROM (OLD.title,OLD.body,OLD.audience,OLD.class_id,OLD.academic_year_id,OLD.section_id,OLD.priority,OLD.available_from,OLD.expires_at);
 IF changed AND (OLD.status<>'draft' OR NEW.status<>'draft') THEN RAISE EXCEPTION 'Unpublish before editing notice content' USING ERRCODE='23514';END IF;
 IF NEW.content_revision<>OLD.content_revision+(CASE WHEN changed THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'Content revision must match content change' USING ERRCODE='23514';END IF;
 IF NEW.status=OLD.status THEN
 IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Only draft notices can be saved' USING ERRCODE='23514';END IF;
 ELSIF OLD.status='draft' AND NEW.status='published' THEN
 IF NEW.expires_at IS NOT NULL AND NEW.expires_at<=CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'Change expired visibility dates before publication' USING ERRCODE='23514';END IF;
 ELSIF (OLD.status='published' AND NEW.status='draft') OR (OLD.status IN ('draft','published') AND NEW.status='archived') OR (OLD.status='archived' AND NEW.status='draft') THEN
 IF NEW.action_reason IS NULL OR length(trim(NEW.action_reason))<3 THEN RAISE EXCEPTION 'Lifecycle action reason required' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Invalid notice state transition' USING ERRCODE='23514';END IF;
 END IF;
 NEW.updated_at=now();RETURN NEW;
END; $$;
CREATE TRIGGER notices_guard BEFORE INSERT OR UPDATE ON notices FOR EACH ROW EXECUTE FUNCTION guard_notice();
CREATE FUNCTION audit_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_name text;
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO notice_audit(notice_id,action,new_values,actor_id) VALUES(NEW.id,'created',to_jsonb(NEW),NEW.created_by);
 ELSE action_name=CASE WHEN NEW.status=OLD.status THEN 'updated' WHEN NEW.status='published' THEN 'published' WHEN NEW.status='archived' THEN 'archived' WHEN OLD.status='archived' THEN 'restored' ELSE 'unpublished' END;INSERT INTO notice_audit(notice_id,action,previous_values,new_values,actor_id,reason) VALUES(NEW.id,action_name,to_jsonb(OLD),to_jsonb(NEW),NEW.updated_by,NEW.action_reason);END IF;RETURN NEW;
END; $$;
CREATE TRIGGER notices_audit AFTER INSERT OR UPDATE ON notices FOR EACH ROW EXECUTE FUNCTION audit_notice();
CREATE TRIGGER notice_audit_protect BEFORE UPDATE OR DELETE ON notice_audit FOR EACH ROW EXECUTE FUNCTION protect_attendance_audit();
CREATE TRIGGER notice_reads_protect BEFORE UPDATE OR DELETE ON notice_reads FOR EACH ROW EXECUTE FUNCTION protect_attendance_audit();
CREATE FUNCTION guard_notice_read() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rev integer;
BEGIN
 SELECT content_revision INTO rev FROM notices WHERE id=NEW.notice_id FOR SHARE;
 IF rev IS NULL OR NEW.content_revision<>rev THEN RAISE EXCEPTION 'Acknowledge only the current notice revision' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER notice_reads_guard BEFORE INSERT ON notice_reads FOR EACH ROW EXECUTE FUNCTION guard_notice_read();

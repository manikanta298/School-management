-- Enforce same-school ownership for notices, acknowledgements and notice audit history.
-- Migration 018 assigned existing notice records to the initial school.
-- A notice with no class is school-wide: it is visible only inside its own school.
ALTER TABLE notices
  ADD CONSTRAINT notices_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT notices_class_same_school_fk
    FOREIGN KEY (class_id, school_id) REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT notices_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT notices_section_same_school_fk
    FOREIGN KEY (section_id, school_id) REFERENCES sections(id, school_id) ON DELETE RESTRICT;

ALTER TABLE notice_reads
  ADD CONSTRAINT notice_reads_notice_same_school_fk
    FOREIGN KEY (notice_id, school_id) REFERENCES notices(id, school_id) ON DELETE RESTRICT;

ALTER TABLE notice_audit
  ADD CONSTRAINT notice_audit_notice_same_school_fk
    FOREIGN KEY (notice_id, school_id) REFERENCES notices(id, school_id) ON DELETE RESTRICT;

CREATE INDEX notices_school_visible_idx ON notices(school_id, status, available_from, expires_at);
CREATE INDEX notice_reads_school_notice_idx ON notice_reads(school_id, notice_id, content_revision);
CREATE INDEX notice_audit_school_notice_idx ON notice_audit(school_id, notice_id, id);

CREATE OR REPLACE FUNCTION audit_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_name text;
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO notice_audit(school_id,notice_id,action,new_values,actor_id)
  VALUES(NEW.school_id,NEW.id,'created',to_jsonb(NEW),NEW.created_by);
 ELSE
  action_name=CASE WHEN NEW.status=OLD.status THEN 'updated' WHEN NEW.status='published' THEN 'published' WHEN NEW.status='archived' THEN 'archived' WHEN OLD.status='archived' THEN 'restored' ELSE 'unpublished' END;
  INSERT INTO notice_audit(school_id,notice_id,action,previous_values,new_values,actor_id,reason)
  VALUES(NEW.school_id,NEW.id,action_name,to_jsonb(OLD),to_jsonb(NEW),NEW.updated_by,NEW.action_reason);
 END IF;
 RETURN NEW;
END; $$;

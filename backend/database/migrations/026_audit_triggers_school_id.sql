-- Timetable audit rows must carry the slot's school_id (NOT NULL since tenant migration).
CREATE OR REPLACE FUNCTION audit_timetable_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event text;
BEGIN
 IF TG_OP='INSERT' THEN event='created';INSERT INTO timetable_audit(school_id,slot_id,action,new_values,actor_id,note) VALUES(NEW.school_id,NEW.id,event,to_jsonb(NEW),NEW.changed_by,NEW.change_note);
 ELSE event=CASE WHEN OLD.assignment_id IS NOT NULL AND NEW.assignment_id IS NULL THEN 'detached' WHEN OLD.active AND NOT NEW.active THEN 'deactivated' WHEN NOT OLD.active AND NEW.active THEN 'reactivated' ELSE 'updated' END;INSERT INTO timetable_audit(school_id,slot_id,action,previous_values,new_values,actor_id,note) VALUES(NEW.school_id,NEW.id,event,to_jsonb(OLD),to_jsonb(NEW),NEW.changed_by,NEW.change_note);END IF;RETURN NEW;
END; $$;

-- Notice audit rows must carry the notice's school_id as well.
CREATE OR REPLACE FUNCTION audit_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_name text;
BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO notice_audit(school_id,notice_id,action,new_values,actor_id) VALUES(NEW.school_id,NEW.id,'created',to_jsonb(NEW),NEW.created_by);
 ELSE action_name=CASE WHEN NEW.status=OLD.status THEN 'updated' WHEN NEW.status='published' THEN 'published' WHEN NEW.status='archived' THEN 'archived' WHEN OLD.status='archived' THEN 'restored' ELSE 'unpublished' END;INSERT INTO notice_audit(school_id,notice_id,action,previous_values,new_values,actor_id,reason) VALUES(NEW.school_id,NEW.id,action_name,to_jsonb(OLD),to_jsonb(NEW),NEW.updated_by,NEW.action_reason);END IF;RETURN NEW;
END; $$;

-- Enforce same-school ownership for rooms, timetable slots and timetable audit history.
-- Migration 018 assigned existing timetable records to the initial school.
-- Conflict checks use teacher, section and room ids; with same-school keys each id belongs to exactly one school,
-- so schedules in different schools can never conflict with each other.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_assignments_id_school_unique') THEN
    ALTER TABLE teacher_assignments ADD CONSTRAINT teacher_assignments_id_school_unique UNIQUE (id, school_id);
  END IF;
END $$;

ALTER TABLE school_rooms
  ADD CONSTRAINT school_rooms_id_school_unique UNIQUE (id, school_id);
DROP INDEX IF EXISTS school_rooms_name_unique;
CREATE UNIQUE INDEX school_rooms_school_name_unique ON school_rooms(school_id, lower(name));

ALTER TABLE timetable_slots
  ADD CONSTRAINT timetable_slots_id_school_unique UNIQUE (id, school_id),
  ADD CONSTRAINT timetable_slots_section_same_school_fk
    FOREIGN KEY (section_id, school_id) REFERENCES sections(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT timetable_slots_class_same_school_fk
    FOREIGN KEY (class_id, school_id) REFERENCES classes(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT timetable_slots_year_same_school_fk
    FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT timetable_slots_assignment_same_school_fk
    FOREIGN KEY (assignment_id, school_id) REFERENCES teacher_assignments(id, school_id) ON DELETE SET NULL (assignment_id),
  ADD CONSTRAINT timetable_slots_teacher_same_school_fk
    FOREIGN KEY (teacher_id, school_id) REFERENCES teachers(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT timetable_slots_subject_same_school_fk
    FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT timetable_slots_room_same_school_fk
    FOREIGN KEY (room_id, school_id) REFERENCES school_rooms(id, school_id) ON DELETE RESTRICT;

ALTER TABLE timetable_audit
  ADD CONSTRAINT timetable_audit_slot_same_school_fk
    FOREIGN KEY (slot_id, school_id) REFERENCES timetable_slots(id, school_id) ON DELETE RESTRICT;

CREATE INDEX timetable_slots_school_section_idx ON timetable_slots(school_id, section_id, weekday, effective_from, effective_to) WHERE active;
CREATE INDEX timetable_slots_school_teacher_idx ON timetable_slots(school_id, teacher_id, weekday, effective_from, effective_to) WHERE active;
CREATE INDEX timetable_slots_school_room_idx ON timetable_slots(school_id, room_id, weekday, effective_from, effective_to) WHERE active AND room_id IS NOT NULL;
CREATE INDEX timetable_audit_school_slot_idx ON timetable_audit(school_id, slot_id, id);

CREATE OR REPLACE FUNCTION audit_timetable_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event text;
BEGIN
  IF TG_OP='INSERT' THEN
    event='created';
    INSERT INTO timetable_audit(school_id,slot_id,action,new_values,actor_id,note)
    VALUES(NEW.school_id,NEW.id,event,to_jsonb(NEW),NEW.changed_by,NEW.change_note);
  ELSE
    event=CASE WHEN OLD.assignment_id IS NOT NULL AND NEW.assignment_id IS NULL THEN 'detached'
               WHEN OLD.active AND NOT NEW.active THEN 'deactivated'
               WHEN NOT OLD.active AND NEW.active THEN 'reactivated' ELSE 'updated' END;
    INSERT INTO timetable_audit(school_id,slot_id,action,previous_values,new_values,actor_id,note)
    VALUES(NEW.school_id,NEW.id,event,to_jsonb(OLD),to_jsonb(NEW),NEW.changed_by,NEW.change_note);
  END IF;
  RETURN NEW;
END; $$;

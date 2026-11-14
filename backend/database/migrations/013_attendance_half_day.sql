ALTER TABLE attendance_entries DROP CONSTRAINT attendance_entries_status_check;
ALTER TABLE attendance_entries ADD CONSTRAINT attendance_entries_status_check CHECK(status IN ('present','absent','late','half_day','excused','void'));
ALTER TABLE attendance_audit DROP CONSTRAINT attendance_audit_previous_status_check;
ALTER TABLE attendance_audit ADD CONSTRAINT attendance_audit_previous_status_check CHECK(previous_status IS NULL OR previous_status IN ('present','absent','late','half_day','excused','void'));
ALTER TABLE attendance_audit DROP CONSTRAINT attendance_audit_new_status_check;
ALTER TABLE attendance_audit ADD CONSTRAINT attendance_audit_new_status_check CHECK(new_status IN ('present','absent','late','half_day','excused','void'));

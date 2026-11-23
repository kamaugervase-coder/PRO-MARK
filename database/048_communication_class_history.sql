BEGIN;

ALTER TABLE communication_messages
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_communication_school_class_created
  ON communication_messages(school_id,class_id,created_at DESC);

COMMIT;

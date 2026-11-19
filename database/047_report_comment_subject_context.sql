-- Subject-specific report feedback needs a subject key. Class and headteacher
-- comments remain subject-independent.
ALTER TABLE report_comments ADD COLUMN IF NOT EXISTS subject_id uuid;

ALTER TABLE report_comments DROP CONSTRAINT IF EXISTS report_comments_learner_id_academic_year_id_term_id_comment_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_comments_class_context
  ON report_comments(learner_id, academic_year_id, term_id, comment_type)
  WHERE subject_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_comments_subject_context
  ON report_comments(learner_id, academic_year_id, term_id, comment_type, subject_id)
  WHERE subject_id IS NOT NULL;

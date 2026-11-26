ALTER TABLE communication_messages
  ADD COLUMN IF NOT EXISTS recipient_phone text,
  ADD COLUMN IF NOT EXISTS recipient_consent_confirmed boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_publication_manual_sms_recipient
  ON communication_messages(result_publication_record_id,recipient_phone)
  WHERE result_publication_record_id IS NOT NULL
    AND recipient_phone IS NOT NULL
    AND message_type='PUBLISHED_RESULTS';

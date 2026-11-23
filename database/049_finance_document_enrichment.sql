BEGIN;

ALTER TABLE school_fee_structures
  ADD COLUMN IF NOT EXISTS term_id uuid REFERENCES terms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS learner_category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fee_category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_compulsory boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS applicability text NOT NULL DEFAULT 'ALL';

ALTER TABLE school_fee_charges
  ADD COLUMN IF NOT EXISTS term_id uuid REFERENCES terms(id) ON DELETE SET NULL;

ALTER TABLE school_fee_payments
  ADD COLUMN IF NOT EXISTS payer_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payer_relationship text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS term_id uuid REFERENCES terms(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS school_finance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  term_id uuid REFERENCES terms(id) ON DELETE SET NULL,
  adjustment_type text NOT NULL DEFAULT 'ADJUSTMENT'
    CHECK (adjustment_type IN ('OPENING_BALANCE','BURSARY','DISCOUNT','ADJUSTMENT')),
  direction text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 4 AND 500),
  status text NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  recorded_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, id)
);

CREATE INDEX IF NOT EXISTS school_finance_adjustments_learner_idx
  ON school_finance_adjustments(school_id, learner_id, academic_year_id, term_id, created_at);

COMMIT;

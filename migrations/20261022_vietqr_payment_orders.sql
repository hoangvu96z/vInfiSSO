-- Manual SQL fallback for src/database/migrations/1792713600000-VietQrPaymentOrders.ts.
-- This migration is intentionally not applied by application startup or CI.
BEGIN;

CREATE TABLE IF NOT EXISTS payment_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  bank_bin varchar(6) NOT NULL CHECK (bank_bin ~ '^[0-9]{6}$'),
  bank_name varchar(100) NOT NULL,
  account_number varchar(19) NOT NULL
    CHECK (account_number ~ '^[A-Za-z0-9]{6,19}$'),
  account_name varchar(100) NOT NULL,
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_name varchar(50) NOT NULL,
  plan_label varchar(100) NOT NULL,
  amount bigint NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  reference varchar(24) NOT NULL,
  duration_days smallint NOT NULL CHECK (duration_days BETWEEN 1 AND 366),
  status varchar(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid')),
  bank_bin varchar(6) NOT NULL CHECK (bank_bin ~ '^[0-9]{6}$'),
  bank_name varchar(100) NOT NULL,
  account_number varchar(19) NOT NULL
    CHECK (account_number ~ '^[A-Za-z0-9]{6,19}$'),
  account_name varchar(100) NOT NULL,
  expires_at timestamp NOT NULL,
  paid_at timestamp NULL,
  reviewed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UQ_payment_orders_reference" UNIQUE (reference),
  CONSTRAINT "CHK_payment_orders_amount"
    CHECK (amount BETWEEN 1 AND 9999999999999),
  CONSTRAINT "CHK_payment_orders_reference"
    CHECK (reference ~ '^[A-Z0-9]{8,24}$'),
  CONSTRAINT "CHK_payment_orders_review"
    CHECK ((status = 'pending' AND paid_at IS NULL AND reviewed_by IS NULL)
      OR (status = 'paid' AND paid_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "IDX_payment_orders_user_created"
  ON payment_orders (user_id, created_at);
CREATE INDEX IF NOT EXISTS "IDX_payment_orders_status_created"
  ON payment_orders (status, created_at);

-- The app role needs data access only; DDL remains with the migration operator.
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_settings TO vinfi_sso;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_orders TO vinfi_sso;

COMMIT;

-- Manual schema migration. TypeORM synchronize is disabled and this project
-- does not configure an automatic migration runner.
BEGIN;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id serial PRIMARY KEY,
  coupon_id uuid NOT NULL,
  user_id uuid NOT NULL,
  redeemed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FK_coupon_redemptions_coupon"
    FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
  CONSTRAINT "FK_coupon_redemptions_user"
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT "UQ_coupon_redemptions_coupon_user"
    UNIQUE (coupon_id, user_id)
);

-- Preserve existing, code-addressable coupon redemptions before switching the
-- application to the new coupon-id-based uniqueness check. Duplicate legacy
-- subscription rows collapse to one record per coupon and user.
INSERT INTO coupon_redemptions (coupon_id, user_id, redeemed_at)
SELECT c.id, s."userId", MIN(s."createdAt")
FROM user_subscriptions AS s
JOIN coupons AS c ON c.code = s."grantedByCoupon"
WHERE s."grantedByCoupon" IS NOT NULL
GROUP BY c.id, s."userId"
ON CONFLICT (coupon_id, user_id) DO NOTHING;

COMMIT;

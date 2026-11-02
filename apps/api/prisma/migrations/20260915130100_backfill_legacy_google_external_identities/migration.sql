-- This data-only migration is intentionally separate from the schema DDL.
-- MySQL DDL commits implicitly, whereas this backfill makes no durable change
-- until its final INSERT. A duplicate subject or a second Google identity for
-- one user therefore fails while only a connection-scoped temporary table has
-- been written. The failed migration can be resolved and retried after the
-- sanitized source data is corrected, without schema or partial-backfill
-- recovery.
CREATE TEMPORARY TABLE `_auth_google_identity_preflight` (
    `provider_subject` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    PRIMARY KEY (`provider_subject`),
    UNIQUE INDEX `_auth_google_identity_preflight_user_key`(`user_id`)
);

-- First reserve any existing Google identities. A legacy row inserted below
-- then conflicts for either the same subject or the same user with another
-- subject. No automatic ownership choice or duplicate-key suppression exists.
INSERT INTO `_auth_google_identity_preflight` (`provider_subject`, `user_id`)
SELECT `provider_subject`, `user_id`
FROM `external_identities`
WHERE `provider` = 'google';

-- This also rejects duplicate non-null users.google_sub values before the
-- durable backfill begins, even if a restored snapshot bypassed its legacy
-- unique index.
INSERT INTO `_auth_google_identity_preflight` (`provider_subject`, `user_id`)
SELECT `google_sub`, `id`
FROM `users`
WHERE `google_sub` IS NOT NULL;

DROP TEMPORARY TABLE `_auth_google_identity_preflight`;

-- The preflight above makes this one statement all-or-nothing for the normal
-- conflict classes. It writes ExternalIdentity only and intentionally leaves
-- users.google_sub untouched as the dual-read fallback.
INSERT INTO `external_identities` (
    `id`, `user_id`, `provider`, `provider_subject`, `created_at`, `updated_at`
)
SELECT
    SHA2(CONCAT('masari:legacy-google:', `u`.`id`), 256),
    `u`.`id`,
    'google',
    `u`.`google_sub`,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `users` AS `u`
WHERE `u`.`google_sub` IS NOT NULL;

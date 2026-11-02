-- Email is the login identifier while phone remains an E.164 profile field.
-- This migration is additive and intentionally retains users.google_sub as a
-- dual-read fallback until a later, separately approved migration removes it.
ALTER TABLE `users`
    MODIFY `phone` VARCHAR(32) NULL,
    MODIFY `email` VARCHAR(191) NULL,
    MODIFY `password_hash` VARCHAR(191) NULL,
    ADD COLUMN `phone_verified_at` DATETIME(3) NULL,
    ADD COLUMN `email_verified_at` DATETIME(3) NULL,
    ADD COLUMN `profile_state` ENUM('phone_required', 'complete') NOT NULL DEFAULT 'phone_required';

-- Existing accounts already have Masari profile phones. Preserve their access
-- during the transition; accounts with no phone remain restricted.
UPDATE `users`
SET `profile_state` = 'complete'
WHERE `phone` IS NOT NULL;

CREATE TABLE `external_identities` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `provider` ENUM('google') NOT NULL,
    `provider_subject` VARCHAR(191) NOT NULL,
    `provider_email_snapshot` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `last_authenticated_at` DATETIME(3) NULL,

    UNIQUE INDEX `external_identities_provider_provider_subject_key`(`provider`, `provider_subject`),
    UNIQUE INDEX `external_identities_user_id_provider_key`(`user_id`, `provider`),
    INDEX `external_identities_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `external_identities_user_id_fkey`
      FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `auth_action_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `purpose` ENUM('email_verification', 'password_reset', 'password_set', 'email_change', 'google_registration', 'phone_verification') NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `subject_digest` CHAR(64) NULL,
    `token_digest` CHAR(64) NOT NULL,
    `token_key_version` INTEGER NOT NULL,
    `payload` JSON NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_action_tokens_token_digest_key`(`token_digest`),
    INDEX `auth_action_tokens_purpose_expires_at_consumed_at_idx`(`purpose`, `expires_at`, `consumed_at`),
    INDEX `auth_action_tokens_user_id_purpose_expires_at_idx`(`user_id`, `purpose`, `expires_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `auth_action_tokens_user_id_fkey`
      FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

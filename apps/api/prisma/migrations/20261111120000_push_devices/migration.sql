-- Push notifications (off until PUSH_NOTIFICATIONS_ENABLED=true and Firebase credentials are set).
--
-- push_devices: one row per push token. A token belongs to exactly one account: registering it
-- from another account moves the row. Rows are revoked (not deleted) on logout, session
-- revocation, or when the push service reports the token invalid, and are erased with the account.
-- session_id ties the token to the sign-in that registered it; pushes stop when that session ends.
--
-- notification_preferences: per-account choices. No row means the defaults (push on).
--
-- notifications.push_attempted_at: set when the push sender claims a row, so each notification is
-- pushed at most once across API instances. Existing rows are marked as already handled so turning
-- push on never sends old notifications.

CREATE TABLE `push_devices` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `session_id` VARCHAR(191) NULL,
    `platform` ENUM('android', 'ios', 'web') NOT NULL,
    `token` VARCHAR(512) NOT NULL,
    `app_version` VARCHAR(40) NULL,
    `locale` VARCHAR(10) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` VARCHAR(60) NULL,

    UNIQUE INDEX `push_devices_token_key`(`token`),
    INDEX `push_devices_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `push_devices_session_id_revoked_at_idx`(`session_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `push_devices` ADD CONSTRAINT `push_devices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `push_devices` ADD CONSTRAINT `push_devices_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `auth_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `notification_preferences` (
    `user_id` VARCHAR(191) NOT NULL,
    `push_enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notifications`
    ADD COLUMN `push_attempted_at` DATETIME(3) NULL,
    ADD INDEX `notifications_push_attempted_at_created_at_idx`(`push_attempted_at`, `created_at`);

UPDATE `notifications` SET `push_attempted_at` = `created_at` WHERE `push_attempted_at` IS NULL;

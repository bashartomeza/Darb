-- Card 3: a dedicated, reviewable driver-verification lifecycle. The source
-- onboarding flow currently collects identity/contact consent but no document
-- evidence, so this table intentionally stores decisions rather than invented
-- evidence records.

CREATE TABLE `driver_verifications` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `rejection_reason` VARCHAR(500) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,
    `reviewed_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `driver_verifications_user_id_key`(`user_id`),
    INDEX `driver_verifications_status_submitted_at_idx`(`status`, `submitted_at`),
    INDEX `driver_verifications_reviewed_by_id_idx`(`reviewed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve the operational truth already stored on DriverProfile. Historical
-- reviewer/timestamp data does not exist, so the backfill leaves it NULL.
INSERT INTO `driver_verifications` (
    `id`, `user_id`, `status`, `rejection_reason`, `revision`, `submitted_at`,
    `reviewed_at`, `reviewed_by_id`, `created_at`, `updated_at`
)
SELECT
    CONCAT('drvver_', `u`.`id`),
    `u`.`id`,
    IF(COALESCE(`dp`.`verified`, false), 'approved', 'pending'),
    NULL,
    1,
    COALESCE(`dp`.`created_at`, `u`.`created_at`),
    NULL,
    NULL,
    COALESCE(`dp`.`created_at`, `u`.`created_at`),
    CURRENT_TIMESTAMP(3)
FROM `users` AS `u`
LEFT JOIN `driver_profiles` AS `dp` ON `dp`.`user_id` = `u`.`id`
WHERE `u`.`role` = 'driver';

ALTER TABLE `driver_verifications`
    ADD CONSTRAINT `driver_verifications_user_id_fkey`
        FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `driver_verifications_reviewed_by_id_fkey`
        FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;

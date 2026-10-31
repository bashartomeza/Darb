-- Append-only history of driver verification outcomes (approved, rejected,
-- reopened for re-review). Existing verifications start with no history; the
-- audit log remains the record for decisions taken before this migration.

CREATE TABLE `driver_verification_decisions` (
    `id` VARCHAR(191) NOT NULL,
    `verification_id` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `decision` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `decided_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `driver_verification_decisions_verification_id_created_at_idx`(`verification_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `driver_verification_decisions`
    ADD CONSTRAINT `driver_verification_decisions_verification_id_fkey`
        FOREIGN KEY (`verification_id`) REFERENCES `driver_verifications`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `driver_verification_decisions_decided_by_id_fkey`
        FOREIGN KEY (`decided_by_id`) REFERENCES `users`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;

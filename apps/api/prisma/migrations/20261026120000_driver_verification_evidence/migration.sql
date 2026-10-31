-- Admin-recorded evidence for a driver verification revision: which kinds of
-- document were sighted, with a short note. No files and no document numbers
-- are stored. Append-only; existing verifications start with none.

CREATE TABLE `driver_verification_evidence` (
    `id` VARCHAR(191) NOT NULL,
    `verification_id` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `note` VARCHAR(200) NULL,
    `recorded_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dve_verification_revision_idx`(`verification_id`, `revision`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `driver_verification_evidence`
    ADD CONSTRAINT `driver_verification_evidence_verification_id_fkey`
        FOREIGN KEY (`verification_id`) REFERENCES `driver_verifications`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `driver_verification_evidence_recorded_by_id_fkey`
        FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;

-- Metadata for documents an applicant uploads for a driver verification
-- revision. The file bytes are kept on server storage under `storage_key`
-- (outside the database and outside any web root); this table never holds them.

CREATE TABLE `driver_verification_documents` (
    `id` VARCHAR(191) NOT NULL,
    `verification_id` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `mime_type` VARCHAR(40) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `storage_key` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `driver_verification_documents_storage_key_key`(`storage_key`),
    INDEX `dvd_verification_revision_idx`(`verification_id`, `revision`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `driver_verification_documents`
    ADD CONSTRAINT `driver_verification_documents_verification_id_fkey`
        FOREIGN KEY (`verification_id`) REFERENCES `driver_verifications`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;

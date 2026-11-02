-- Add a release-level workflow so all six localized consent documents move
-- through legal approval and publication atomically. No legal content or
-- consent rows are seeded by this migration.
CREATE TABLE `consent_releases` (
    `id` VARCHAR(191) NOT NULL,
    `version` VARCHAR(50) NOT NULL,
    `status` ENUM('draft', 'approved', 'effective', 'retired') NOT NULL DEFAULT 'draft',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `intended_effective_at` DATETIME(3) NOT NULL,
    `legal_approved_at` DATETIME(3) NULL,
    `legal_approved_by` VARCHAR(191) NULL,
    `activated_at` DATETIME(3) NULL,
    `activated_by` VARCHAR(191) NULL,
    `retired_at` DATETIME(3) NULL,
    `retired_by` VARCHAR(191) NULL,
    `retirement_reason` VARCHAR(500) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `consent_releases_version_key`(`version`),
    INDEX `consent_releases_status_intended_effective_at_idx`(`status`, `intended_effective_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `consent_documents`
    ADD COLUMN `release_id` VARCHAR(191) NULL,
    ADD COLUMN `content_body` TEXT NULL,
    ADD UNIQUE INDEX `consent_documents_release_id_document_type_locale_key`(`release_id`, `document_type`, `locale`),
    ADD CONSTRAINT `consent_documents_release_id_fkey`
      FOREIGN KEY (`release_id`) REFERENCES `consent_releases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

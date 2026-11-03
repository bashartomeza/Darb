-- The bytes of uploaded driver and shop-owner documents, kept in the database instead of
-- on the API server's disk. One row per document, linked through exactly one of the two
-- owner columns and deleted together with its document. Uploads are capped at 5 MiB;
-- MEDIUMBLOB holds up to 16 MiB. Documents uploaded before this table existed stay
-- readable from DRIVER_DOCUMENTS_DIR until `npm run documents:import` copies them in.
-- (MySQL refuses CHECK constraints on columns with ON DELETE CASCADE, so "exactly one
-- owner" is enforced by the API, not here.)

CREATE TABLE `document_files` (
    `id` VARCHAR(191) NOT NULL,
    `driver_document_id` VARCHAR(191) NULL,
    `merchant_document_id` VARCHAR(191) NULL,
    `content_type` VARCHAR(40) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `bytes` MEDIUMBLOB NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `document_files_driver_document_id_key`(`driver_document_id`),
    UNIQUE INDEX `document_files_merchant_document_id_key`(`merchant_document_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `document_files_size_matches` CHECK (`size_bytes` > 0 AND `size_bytes` = LENGTH(`bytes`))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `document_files` ADD CONSTRAINT `document_files_driver_document_id_fkey` FOREIGN KEY (`driver_document_id`) REFERENCES `driver_verification_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `document_files` ADD CONSTRAINT `document_files_merchant_document_id_fkey` FOREIGN KEY (`merchant_document_id`) REFERENCES `merchant_application_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Metadata for documents a shop owner uploads while the account is pending
-- review. The file bytes are kept on server storage under `storage_key`
-- (outside the database and outside any web root); this table never holds them.

CREATE TABLE `merchant_application_documents` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `mime_type` VARCHAR(40) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `storage_key` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `merchant_application_documents_storage_key_key`(`storage_key`),
    INDEX `mad_user_created_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `merchant_application_documents`
    ADD CONSTRAINT `merchant_application_documents_user_id_fkey`
        FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;

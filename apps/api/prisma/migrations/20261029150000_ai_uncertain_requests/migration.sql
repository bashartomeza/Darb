-- Review queue for passenger-assistant requests the parser was not confident about.
-- PII-minimised: redacted text only, no user reference, deleted after expires_at.

CREATE TABLE `uncertain_ai_requests` (
    `id` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(5) NOT NULL,
    `text` VARCHAR(400) NOT NULL,
    `intent_type` VARCHAR(16) NOT NULL,
    `confidence` DECIMAL(3, 2) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `reason` VARCHAR(40) NOT NULL,
    `pickup_key` VARCHAR(80) NULL,
    `dropoff_key` VARCHAR(80) NULL,
    `status` ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
    `resolution_note` VARCHAR(500) NULL,
    `resolved_by_id` VARCHAR(191) NULL,
    `resolved_at` DATETIME(3) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `uncertain_ai_requests_status_created_at_idx`(`status`, `created_at`),
    INDEX `uncertain_ai_requests_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

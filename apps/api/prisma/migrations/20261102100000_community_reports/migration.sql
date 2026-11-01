-- Community reports with one-vote-per-user feedback. Votes never change road or checkpoint status.

CREATE TABLE `community_reports` (
    `id` VARCHAR(191) NOT NULL,
    `author_id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NULL,
    `category` VARCHAR(40) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `location_name` VARCHAR(120) NOT NULL,
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `needs_admin_review` BOOLEAN NOT NULL DEFAULT false,
    `admin_reviewed_at` DATETIME(3) NULL,
    `hidden_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `community_reports_hidden_at_created_at_idx`(`hidden_at`, `created_at`),
    INDEX `community_reports_category_created_at_idx`(`category`, `created_at`),
    INDEX `community_reports_needs_admin_review_admin_reviewed_at_idx`(`needs_admin_review`, `admin_reviewed_at`),
    INDEX `community_reports_author_id_created_at_idx`(`author_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `community_report_votes` (
    `id` VARCHAR(191) NOT NULL,
    `report_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `community_report_votes_user_id_idx`(`user_id`),
    UNIQUE INDEX `community_report_votes_report_id_user_id_key`(`report_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `community_report_flags` (
    `id` VARCHAR(191) NOT NULL,
    `report_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `community_report_flags_user_id_idx`(`user_id`),
    UNIQUE INDEX `community_report_flags_report_id_user_id_key`(`report_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `community_reports` ADD CONSTRAINT `community_reports_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `community_reports` ADD CONSTRAINT `community_reports_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `community_report_votes` ADD CONSTRAINT `community_report_votes_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `community_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `community_report_votes` ADD CONSTRAINT `community_report_votes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `community_report_flags` ADD CONSTRAINT `community_report_flags_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `community_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `community_report_flags` ADD CONSTRAINT `community_report_flags_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

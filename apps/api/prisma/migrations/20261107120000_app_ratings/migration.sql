-- The app rating a user gives from Settings, kept in the database instead of on the phone.
-- One row per account, replaced when the user rates again, erased with the account.

CREATE TABLE `app_ratings` (
    `user_id` VARCHAR(191) NOT NULL,
    `stars` TINYINT NOT NULL,
    `feedback` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `app_ratings_updated_at_idx`(`updated_at`),
    PRIMARY KEY (`user_id`),
    CONSTRAINT `app_ratings_stars_range` CHECK (`stars` BETWEEN 1 AND 5)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `app_ratings` ADD CONSTRAINT `app_ratings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

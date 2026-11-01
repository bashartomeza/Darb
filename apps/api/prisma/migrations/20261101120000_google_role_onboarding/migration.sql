-- Google sign-in onboarding for every role.
--
-- 1. `users.city` records where a passenger (or any account) operates.
-- 2. Driver profiles carry the vehicle and identity details the applicant declares,
--    so the Admin reviews them next to the uploaded documents. All nullable: existing
--    profiles were created by an Admin at approval and have none of them.
-- 3. `merchant_profiles` holds the store a shop owner describes at onboarding.

ALTER TABLE `users` ADD COLUMN `city` VARCHAR(100) NULL;

ALTER TABLE `driver_profiles`
    ADD COLUMN `vehicle_make_model` VARCHAR(80) NULL,
    ADD COLUMN `vehicle_color` VARCHAR(30) NULL,
    ADD COLUMN `plate_number` VARCHAR(20) NULL,
    ADD COLUMN `national_id_number` VARCHAR(40) NULL,
    ADD COLUMN `licence_number` VARCHAR(40) NULL;

CREATE TABLE `merchant_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `store_name` VARCHAR(120) NOT NULL,
    `store_type` VARCHAR(30) NOT NULL,
    `sales_channel` ENUM('online', 'physical', 'both') NOT NULL,
    `city` VARCHAR(100) NOT NULL,
    `address` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `merchant_profiles`
    ADD CONSTRAINT `merchant_profiles_user_id_fkey`
        FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

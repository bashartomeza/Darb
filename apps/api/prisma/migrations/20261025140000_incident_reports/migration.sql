-- User-filed incident reports with an Admin triage lifecycle. The row is the
-- record: there is no emergency-response behaviour attached to it.

CREATE TABLE `incidents` (
    `id` VARCHAR(191) NOT NULL,
    `reporter_id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NULL,
    `category` ENUM('safety', 'delay', 'parcel_damage', 'behavior', 'other') NOT NULL,
    `description` VARCHAR(1000) NOT NULL,
    `status` ENUM('open', 'reviewing', 'resolved') NOT NULL DEFAULT 'open',
    `admin_note` VARCHAR(1000) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `reviewed_by_id` VARCHAR(191) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `incidents_status_created_at_idx`(`status`, `created_at`),
    INDEX `incidents_reporter_id_created_at_idx`(`reporter_id`, `created_at`),
    INDEX `incidents_trip_id_idx`(`trip_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `incidents`
    ADD CONSTRAINT `incidents_reporter_id_fkey`
        FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `incidents_reviewed_by_id_fkey`
        FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `incidents_trip_id_fkey`
        FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;

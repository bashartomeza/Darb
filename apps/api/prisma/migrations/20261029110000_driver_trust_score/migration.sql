-- Driver trust score: cached components on the profile, who cancelled a trip,
-- and passenger ratings (one per passenger per trip, 1-5 stars).

ALTER TABLE `driver_profiles`
    ADD COLUMN `trust_components` JSON NULL,
    ADD COLUMN `trust_computed_at` DATETIME(3) NULL;

ALTER TABLE `trips`
    ADD COLUMN `cancelled_by_user_id` VARCHAR(191) NULL;

CREATE TABLE `trip_ratings` (
    `id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NOT NULL,
    `passenger_id` VARCHAR(191) NOT NULL,
    `driver_id` VARCHAR(191) NOT NULL,
    `stars` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `trip_ratings_trip_passenger_key`(`trip_id`, `passenger_id`),
    INDEX `trip_ratings_driver_id_passenger_id_idx`(`driver_id`, `passenger_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `trip_ratings_stars_range` CHECK (`stars` BETWEEN 1 AND 5)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `trip_ratings`
    ADD CONSTRAINT `trip_ratings_trip_id_fkey`
        FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `trip_ratings_passenger_id_fkey`
        FOREIGN KEY (`passenger_id`) REFERENCES `users`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `trip_ratings_driver_id_fkey`
        FOREIGN KEY (`driver_id`) REFERENCES `driver_profiles`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;

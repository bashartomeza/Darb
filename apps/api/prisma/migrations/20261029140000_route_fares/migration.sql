-- Display-only route fares. Payments are not processed in the app: a fare is an
-- estimate the passenger or merchant pays the driver directly.
--
-- route_fares is append-only tariff history per canonical route and item. The
-- fare in force at time T is the newest row with effective_from <= T; a NULL
-- amount_minor withdraws the fare. Amounts are integer minor units (agorot).
--
-- Passenger requests and parcels snapshot the fare when they are created, so
-- later tariff edits never change past records. Existing rows keep NULL
-- (no fare was shown when they were created).

CREATE TABLE `route_fares` (
    `id` VARCHAR(191) NOT NULL,
    `service_route_id` VARCHAR(191) NOT NULL,
    `item` ENUM('passenger_seat', 'parcel_s', 'parcel_m', 'parcel_l') NOT NULL,
    `amount_minor` INTEGER NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'ILS',
    `effective_from` DATETIME(3) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `created_by_user_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `route_fares_service_route_id_item_effective_from_idx`(`service_route_id`, `item`, `effective_from`),
    PRIMARY KEY (`id`),
    CONSTRAINT `route_fares_amount_minor_check` CHECK (`amount_minor` IS NULL OR (`amount_minor` > 0 AND `amount_minor` <= 10000000))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `route_fares`
    ADD CONSTRAINT `route_fares_service_route_id_fkey`
        FOREIGN KEY (`service_route_id`) REFERENCES `service_routes`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `route_fares_created_by_user_id_fkey`
        FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `passenger_requests`
    ADD COLUMN `fare_id` VARCHAR(191) NULL,
    ADD COLUMN `fare_unit_minor` INTEGER NULL,
    ADD COLUMN `fare_total_minor` INTEGER NULL,
    ADD COLUMN `fare_currency` CHAR(3) NULL;

ALTER TABLE `parcels`
    ADD COLUMN `fare_id` VARCHAR(191) NULL,
    ADD COLUMN `fare_minor` INTEGER NULL,
    ADD COLUMN `fare_currency` CHAR(3) NULL;

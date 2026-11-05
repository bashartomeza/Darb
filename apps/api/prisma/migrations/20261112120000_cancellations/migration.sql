-- Cancellation history. One row per cancelled ride request or order (and per trip a driver
-- cancelled), whoever or whatever cancelled it: the person (passenger, merchant, driver, admin)
-- or the system (automatic cancellation after ORDER_AUTO_CANCEL_MINUTES without a driver).
--
-- actor_role is passenger, merchant, driver, admin or system. reason_code comes from the fixed
-- lists in the API (services/cancellationReasons.ts); note is optional free text.
-- ends_order is false when only the trip was cancelled and the order went back to waiting for
-- another driver (a driver cancelling an accepted trip inside the order's window).
-- References are kept when the row they point at is erased: the history outlives them.

CREATE TABLE `cancellations` (
    `id` VARCHAR(191) NOT NULL,
    `actor_user_id` VARCHAR(191) NULL,
    `actor_role` VARCHAR(20) NOT NULL,
    `passenger_request_id` VARCHAR(191) NULL,
    `merchant_order_id` VARCHAR(191) NULL,
    `trip_id` VARCHAR(191) NULL,
    `reason_code` VARCHAR(40) NOT NULL,
    `note` VARCHAR(300) NULL,
    `automatic` BOOLEAN NOT NULL DEFAULT false,
    `ends_order` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cancellations_created_at_idx`(`created_at`),
    INDEX `cancellations_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `cancellations_passenger_request_id_idx`(`passenger_request_id`),
    INDEX `cancellations_merchant_order_id_idx`(`merchant_order_id`),
    INDEX `cancellations_trip_id_idx`(`trip_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cancellations` ADD CONSTRAINT `cancellations_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `cancellations` ADD CONSTRAINT `cancellations_passenger_request_id_fkey` FOREIGN KEY (`passenger_request_id`) REFERENCES `passenger_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `cancellations` ADD CONSTRAINT `cancellations_merchant_order_id_fkey` FOREIGN KEY (`merchant_order_id`) REFERENCES `merchant_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `cancellations` ADD CONSTRAINT `cancellations_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

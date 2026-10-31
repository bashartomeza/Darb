-- Parcels sent by ordinary passengers. The parcel itself is a normal
-- merchant_orders/parcels row (so matching and dispatch are shared); this table
-- holds only what is specific to a person-to-person parcel. The receiver is not
-- an app user: name, phone and note are kept only until `retention_expires_at`
-- (or until the parcel is cancelled) and are then nulled by the purge job.

CREATE TABLE `passenger_parcel_details` (
    `id` VARCHAR(191) NOT NULL,
    `order_id` VARCHAR(191) NOT NULL,
    `sender_id` VARCHAR(191) NOT NULL,
    `size` VARCHAR(1) NOT NULL,
    `note` VARCHAR(200) NULL,
    `receiver_name` VARCHAR(80) NULL,
    `receiver_phone` VARCHAR(32) NULL,
    `forbidden_items_ack_at` DATETIME(3) NOT NULL,
    `retention_expires_at` DATETIME(3) NOT NULL,
    `receiver_purged_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `passenger_parcel_details_order_id_key`(`order_id`),
    INDEX `ppd_sender_created_idx`(`sender_id`, `created_at`),
    INDEX `ppd_retention_idx`(`retention_expires_at`, `receiver_purged_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `passenger_parcel_details`
    ADD CONSTRAINT `passenger_parcel_details_order_id_fkey`
        FOREIGN KEY (`order_id`) REFERENCES `merchant_orders`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `passenger_parcel_details`
    ADD CONSTRAINT `passenger_parcel_details_sender_id_fkey`
        FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;

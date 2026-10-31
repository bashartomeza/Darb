-- Receiver confirmation of parcel deliveries. The handover code is stored only as a keyed digest,
-- failed_attempts caps wrong guesses, and the confirmation method records how each delivery was
-- closed (receiver code, receiver unavailable with a reason, or an admin override).
CREATE TABLE `delivery_handovers` (
    `id` VARCHAR(191) NOT NULL,
    `merchant_order_id` VARCHAR(191) NOT NULL,
    `code_digest` CHAR(64) NULL,
    `key_version` INTEGER NOT NULL DEFAULT 1,
    `failed_attempts` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `confirmation_method` ENUM('receiver_code', 'receiver_unavailable', 'admin_override') NULL,
    `confirmed_by_id` VARCHAR(191) NULL,
    `confirmed_trip_id` VARCHAR(191) NULL,
    `unavailable_reason` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `delivery_handovers_merchant_order_id_key`(`merchant_order_id`),
    INDEX `delivery_handovers_confirmation_method_confirmed_at_idx`(`confirmation_method`, `confirmed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `delivery_handovers`
    ADD CONSTRAINT `delivery_handovers_merchant_order_id_fkey`
        FOREIGN KEY (`merchant_order_id`) REFERENCES `merchant_orders`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;

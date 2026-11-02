-- Complete legacy capacity accounting, multi-order batching, and explicit
-- cancellation/failure/expiry states without removing existing enum values.

ALTER TABLE `passenger_requests`
  MODIFY `status` ENUM('draft','pending','matched','accepted','picked_up','in_transit','delivered','completed','cancelled','expired') NOT NULL DEFAULT 'pending';

ALTER TABLE `merchant_orders`
  MODIFY `status` ENUM('draft','submitted','batched','matched','assigned','in_transit','delivered','completed','cancelled','failed','expired') NOT NULL DEFAULT 'submitted';

ALTER TABLE `parcels`
  MODIFY `status` ENUM('pending','batched','assigned','picked_up','in_transit','delivered','cancelled','failed','expired') NOT NULL DEFAULT 'pending';

ALTER TABLE `parcel_batches`
  MODIFY `status` ENUM('created','proposed','assigned','picked_up','in_transit','delivered','cancelled','failed','expired') NOT NULL DEFAULT 'created';

ALTER TABLE `trips`
  MODIFY `status` ENUM('created','accepted','pickup_started','picked_up','in_transit','delivered','completed','cancelled','failed') NOT NULL DEFAULT 'created';

ALTER TABLE `matches`
  ADD COLUMN `legacy_capacity_held` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE `parcel_batch_orders` (
  `id` VARCHAR(191) NOT NULL,
  `parcel_batch_id` VARCHAR(191) NOT NULL,
  `merchant_order_id` VARCHAR(191) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `active_membership_key` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `parcel_batch_orders_unique` (`parcel_batch_id`,`merchant_order_id`),
  UNIQUE KEY `parcel_batch_active_membership_key` (`active_membership_key`),
  KEY `parcel_batch_orders_order_created_idx` (`merchant_order_id`,`created_at`),
  CONSTRAINT `parcel_batch_orders_batch_fk`
    FOREIGN KEY (`parcel_batch_id`) REFERENCES `parcel_batches` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `parcel_batch_orders_order_fk`
    FOREIGN KEY (`merchant_order_id`) REFERENCES `merchant_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `parcel_batch_orders` (`id`, `parcel_batch_id`, `merchant_order_id`, `active`, `active_membership_key`)
SELECT
  CONCAT('legacy-', `pb`.`id`),
  `pb`.`id`,
  `pb`.`merchant_order_id`,
  CASE WHEN `pb`.`status` IN ('cancelled','failed','expired') THEN FALSE ELSE TRUE END,
  NULL
FROM `parcel_batches` AS `pb`;

-- Preserve every historical batch membership without failing on databases that
-- already contain multiple active legacy batches for one order. Only one
-- active membership receives the concurrency-protection key; application
-- matching still rejects any order that has any other active membership.
UPDATE `parcel_batch_orders` AS `pbo`
INNER JOIN (
  SELECT `merchant_order_id`, MIN(`id`) AS `keep_id`
  FROM `parcel_batch_orders`
  WHERE `active` = TRUE
  GROUP BY `merchant_order_id`
) AS `keep`
  ON `keep`.`merchant_order_id` = `pbo`.`merchant_order_id`
 AND `keep`.`keep_id` = `pbo`.`id`
SET `pbo`.`active_membership_key` = `pbo`.`merchant_order_id`;

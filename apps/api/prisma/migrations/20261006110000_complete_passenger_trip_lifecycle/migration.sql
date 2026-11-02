-- Complete the persisted passenger lifecycle and add an idempotency guard for
-- legacy trip assignment. Existing rows remain valid and the new key is nullable.
ALTER TABLE `passenger_requests`
  MODIFY `status` ENUM('draft','pending','matched','accepted','picked_up','in_transit','delivered','completed','cancelled') NOT NULL DEFAULT 'pending';

ALTER TABLE `trips`
  ADD COLUMN `legacy_assignment_key` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `trips_legacy_assignment_key_key`(`legacy_assignment_key`);

ALTER TABLE `matches`
  ADD COLUMN `legacy_demand_key` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `matches_legacy_demand_key_key`(`legacy_demand_key`);

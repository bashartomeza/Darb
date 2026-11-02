-- Licence / vehicle / insurance / contract expiry tracking for approved drivers,
-- plus the restricted `documents_expired` state and the renewal marker used by
-- the Admin re-review queue. Additive: existing rows keep NULL dates and are
-- never restricted by the expiry job.

ALTER TABLE `driver_verifications`
    MODIFY `status` ENUM('pending', 'approved', 'rejected', 'documents_expired') NOT NULL DEFAULT 'pending',
    ADD COLUMN `licence_expires_at` DATE NULL,
    ADD COLUMN `vehicle_registration_expires_at` DATE NULL,
    ADD COLUMN `insurance_expires_at` DATE NULL,
    ADD COLUMN `contract_ends_at` DATE NULL,
    ADD COLUMN `documents_expired_at` DATETIME(3) NULL,
    ADD COLUMN `renewal_submitted_at` DATETIME(3) NULL;

CREATE INDEX `dv_status_licence_expiry_idx` ON `driver_verifications`(`status`, `licence_expires_at`);

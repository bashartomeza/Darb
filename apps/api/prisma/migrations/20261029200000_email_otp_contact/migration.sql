-- Masari sends no SMS: one-time codes go to an email address instead.
-- Invitations carry the contact email the Admin entered next to the invited phone, and onboarding
-- attempts carry the address the code is delivered to. Both are nullable and additive: rows created
-- before this migration have no address and can only be verified with the fake (demo/test) provider.

ALTER TABLE `invitations`
    ADD COLUMN `contact_email` VARCHAR(191) NULL;

ALTER TABLE `onboarding_attempts`
    ADD COLUMN `delivery_email` VARCHAR(191) NULL;

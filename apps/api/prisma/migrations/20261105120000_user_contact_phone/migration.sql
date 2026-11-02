-- Email sign-up collects a phone number as an additional contact detail. It is stored as entered, is
-- not verified and is not unique, so it lives beside `phone` (the verified, unique identity) instead of in it.
-- Nullable and additive: existing rows keep NULL.

ALTER TABLE `users`
    ADD COLUMN `contact_phone` VARCHAR(32) NULL;

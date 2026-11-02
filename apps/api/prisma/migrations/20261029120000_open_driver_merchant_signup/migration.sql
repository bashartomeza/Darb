-- Open driver / shop-owner signup (no invitation code).
--
-- 1. An onboarding attempt may now exist without an invitation. The unique index
--    on `invitation_id` is kept (MySQL allows many NULLs), so an invitation still
--    backs at most one attempt.
-- 2. `users.review_submitted_at` records when an applicant sent a complete
--    application for admin review. Every existing driver and shop owner is
--    backfilled as submitted, so the current review queue is unchanged.

ALTER TABLE `onboarding_attempts` DROP FOREIGN KEY `onboarding_attempts_invitation_id_fkey`;

ALTER TABLE `onboarding_attempts` MODIFY `invitation_id` VARCHAR(191) NULL;

ALTER TABLE `onboarding_attempts`
    ADD CONSTRAINT `onboarding_attempts_invitation_id_fkey`
        FOREIGN KEY (`invitation_id`) REFERENCES `invitations`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `users` ADD COLUMN `review_submitted_at` DATETIME(3) NULL;

UPDATE `users` SET `review_submitted_at` = `created_at` WHERE `role` IN ('driver', 'merchant');

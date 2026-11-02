-- Registration emails carry a short code instead of the long token. The code is stored only as a
-- keyed digest, and failed_attempts caps wrong guesses per sign-up.
ALTER TABLE `auth_action_tokens`
  ADD COLUMN `code_digest` CHAR(64) NULL,
  ADD COLUMN `failed_attempts` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `auth_action_tokens_subject_digest_purpose_idx` ON `auth_action_tokens`(`subject_digest`, `purpose`);

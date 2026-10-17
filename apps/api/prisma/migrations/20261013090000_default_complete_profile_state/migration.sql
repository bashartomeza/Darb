-- Phone verification is removed from the profile lifecycle. New accounts are
-- active without a separate phone challenge, so the profile defaults to the
-- complete state and no account can be left waiting on phone verification.
ALTER TABLE `users`
    MODIFY `profile_state` ENUM('phone_required', 'complete') NOT NULL DEFAULT 'complete';

UPDATE `users`
SET `profile_state` = 'complete'
WHERE `profile_state` = 'phone_required';

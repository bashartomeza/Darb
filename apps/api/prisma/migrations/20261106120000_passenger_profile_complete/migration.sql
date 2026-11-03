-- The app no longer has a separate phone step: passengers give a contact number at sign-up
-- (`contact_phone`) and use Darb straight away. Passenger accounts created before that change
-- were left waiting for a phone they can no longer add, so every product request was refused.
-- Data only and idempotent: drivers, merchants and admins are untouched.

UPDATE `users`
SET `profile_state` = 'complete'
WHERE `role` = 'passenger'
  AND `profile_state` = 'phone_required';

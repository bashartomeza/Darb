-- Email + Google self-service authentication.
-- Additive MySQL migration: adds credential columns for email/password and
-- Google OAuth sign-in, relaxes phone/password_hash to nullable so Google-only
-- and email-only accounts are representable, and extends the audit enum.

ALTER TABLE `users`
  ADD COLUMN `email` VARCHAR(191) NULL,
  ADD COLUMN `google_sub` VARCHAR(191) NULL,
  MODIFY `phone` VARCHAR(191) NULL,
  MODIFY `password_hash` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `users_email_key` ON `users`(`email`);
CREATE UNIQUE INDEX `users_google_sub_key` ON `users`(`google_sub`);

ALTER TABLE `audit_events` MODIFY `action` ENUM(
  'auth_login', 'auth_register', 'auth_google_login', 'auth_google_link',
  'session_created', 'session_refreshed', 'session_revoked', 'logout_all',
  'refresh_token_reuse_detected', 'account_status_changed', 'login_blocked_by_status',
  'demo_reset', 'passenger_request_created', 'passenger_request_cancelled',
  'driver_route_created', 'driver_route_deactivated', 'merchant_order_created',
  'parcel_batch_created', 'comparison_run_created', 'match_accepted', 'match_rejected',
  'trip_status_updated', 'location_recorded', 'tracking_simulation_step',
  'driver_verification', 'match_decision', 'admin_action', 'invitation_created',
  'invitation_revoked', 'invitation_redeemed', 'otp_challenge_created', 'otp_verified',
  'consent_recorded', 'invitation_consumed', 'onboarding_attempt_created',
  'otp_dispatch_accepted', 'otp_dispatch_rejected', 'otp_verification_failed',
  'onboarding_session_created', 'onboarding_session_revoked', 'consent_document_created',
  'abuse_limit_reached', 'idempotency_conflict', 'onboarding_started', 'onboarding_resumed',
  'otp_resent', 'registration_completed', 'registration_completion_failed',
  'pending_status_session_created', 'onboarding_status_accessed', 'onboarding_rate_limited',
  'onboarding_idempotency_conflict', 'route_created', 'route_version_created',
  'route_draft_updated', 'route_stops_updated', 'route_version_published',
  'route_version_paused', 'route_version_resumed', 'route_version_retired',
  'route_retired', 'stop_created', 'stop_updated', 'stop_retired',
  'driver_availability_created', 'driver_availability_updated',
  'driver_availability_status_changed', 'driver_availability_activated',
  'driver_availability_paused', 'driver_availability_resumed',
  'driver_availability_cancelled', 'canonical_passenger_request_created',
  'canonical_merchant_order_created', 'capacity_reserved', 'capacity_confirmed',
  'capacity_released', 'capacity_expired', 'canonical_matching_run_started',
  'canonical_matching_run_completed', 'canonical_offer_created', 'canonical_offer_accepted',
  'canonical_offer_rejected', 'canonical_offer_expired', 'canonical_offer_reassigned',
  'canonical_trip_created', 'canonical_dispatch_unavailable', 'canonical_manifest_created',
  'canonical_manifest_offered', 'canonical_manifest_accepted', 'canonical_manifest_rejected',
  'canonical_manifest_expired', 'canonical_manifest_invalidated',
  'canonical_manifest_regrouped', 'canonical_shared_trip_created'
) NOT NULL;

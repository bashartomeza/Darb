-- Preserve canonical offer constraints while allowing legacy offer expiry,
-- acceptance, rejection, and expiry timestamps introduced by dispatch.
-- Applied migrations remain unchanged.
ALTER TABLE `matches`
  DROP CHECK `matches_canonical_shape_chk`,
  ADD CONSTRAINT `matches_canonical_shape_chk` CHECK (
    (`operational_mode` = 'legacy' AND `canonical_match_version` IS NULL AND
     `route_version_id` IS NULL AND `dispatch_id` IS NULL AND `reservation_id` IS NULL AND
     `attempt_number` IS NULL AND `offered_at` IS NULL AND
     `reject_reason` IS NULL AND `score_version` IS NULL AND `active_dispatch_key` IS NULL AND
     `accepted_dispatch_key` IS NULL AND `demand_checksum` IS NULL AND
     `active_driver_route_key` IS NULL AND `accepted_driver_route_key` IS NULL AND
     `canonical_assignment_key` IS NULL AND `manifest_id` IS NULL AND
     `active_manifest_key` IS NULL AND `accepted_manifest_key` IS NULL)
    OR
    (`operational_mode` = 'canonical_route_v1' AND
     `canonical_match_version` = 'canonical_route_match_v1' AND
     `manifest_id` IS NULL AND `route_version_id` IS NOT NULL AND `dispatch_id` IS NOT NULL AND
     `reservation_id` IS NOT NULL AND `attempt_number` BETWEEN 1 AND 5 AND
     `offered_at` IS NOT NULL AND `expires_at` > `offered_at` AND `parcel_batch_id` IS NULL AND
     `demand_checksum` REGEXP '^[0-9a-f]{64}$' AND
     ((`passenger_request_id` IS NOT NULL AND `merchant_order_id` IS NULL) OR
      (`merchant_order_id` IS NOT NULL AND `passenger_request_id` IS NULL)) AND
     `score_version` = 'canonical_route_match_v1' AND `expiry_failure_count` BETWEEN 0 AND 3 AND
     `active_manifest_key` IS NULL AND `accepted_manifest_key` IS NULL AND
     ((`status` = 'sent_to_driver' AND `active_dispatch_key` = `dispatch_id` AND
       `accepted_dispatch_key` IS NULL AND `active_driver_route_key` = `driver_route_id` AND
       `accepted_driver_route_key` IS NULL AND `canonical_assignment_key` IS NULL AND
       `accepted_at` IS NULL AND `rejected_at` IS NULL AND `expired_at` IS NULL AND
       `reject_reason` IS NULL) OR
      (`status` = 'accepted' AND `active_dispatch_key` IS NULL AND
       `accepted_dispatch_key` = `dispatch_id` AND `active_driver_route_key` IS NULL AND
       `accepted_driver_route_key` = `driver_route_id` AND `canonical_assignment_key` IS NOT NULL AND
       `accepted_at` IS NOT NULL AND `rejected_at` IS NULL AND `expired_at` IS NULL AND
       `reject_reason` IS NULL) OR
      (`status` = 'rejected' AND `active_dispatch_key` IS NULL AND
       `accepted_dispatch_key` IS NULL AND `active_driver_route_key` IS NULL AND
       `accepted_driver_route_key` IS NULL AND `canonical_assignment_key` IS NULL AND
       `accepted_at` IS NULL AND `rejected_at` IS NOT NULL AND `expired_at` IS NULL AND
       `reject_reason` IS NOT NULL) OR
      (`status` = 'expired' AND `active_dispatch_key` IS NULL AND
       `accepted_dispatch_key` IS NULL AND `active_driver_route_key` IS NULL AND
       `accepted_driver_route_key` IS NULL AND `canonical_assignment_key` IS NULL AND
       `accepted_at` IS NULL AND `rejected_at` IS NULL AND `expired_at` IS NOT NULL AND
       `reject_reason` IS NULL)))
    OR
    (`operational_mode` = 'canonical_route_v1' AND
     `canonical_match_version` = 'canonical_shared_trip_match_v1' AND
     `manifest_id` IS NOT NULL AND `route_version_id` IS NOT NULL AND
     `dispatch_id` IS NULL AND `passenger_request_id` IS NULL AND `merchant_order_id` IS NULL AND
     `parcel_batch_id` IS NULL AND `reservation_id` IS NOT NULL AND `attempt_number` IS NULL AND
     `offered_at` IS NOT NULL AND `expires_at` > `offered_at` AND
     `score_version` = 'canonical_route_match_v1' AND `demand_checksum` IS NULL AND
     `active_dispatch_key` IS NULL AND `accepted_dispatch_key` IS NULL AND
     `canonical_assignment_key` IS NULL AND `expiry_failure_count` BETWEEN 0 AND 3 AND
     ((`status` = 'sent_to_driver' AND `active_manifest_key` = `manifest_id` AND
       `accepted_manifest_key` IS NULL AND `active_driver_route_key` = `driver_route_id` AND
       `accepted_driver_route_key` IS NULL AND `accepted_at` IS NULL AND
       `rejected_at` IS NULL AND `expired_at` IS NULL AND `reject_reason` IS NULL) OR
      (`status` = 'accepted' AND `active_manifest_key` IS NULL AND
       `accepted_manifest_key` = `manifest_id` AND `active_driver_route_key` IS NULL AND
       `accepted_driver_route_key` = `driver_route_id` AND `accepted_at` IS NOT NULL AND
       `rejected_at` IS NULL AND `expired_at` IS NULL AND `reject_reason` IS NULL) OR
      (`status` = 'rejected' AND `active_manifest_key` IS NULL AND
       `accepted_manifest_key` IS NULL AND `active_driver_route_key` IS NULL AND
       `accepted_driver_route_key` IS NULL AND `accepted_at` IS NULL AND
       `rejected_at` IS NOT NULL AND `expired_at` IS NULL AND `reject_reason` IS NOT NULL) OR
      (`status` IN ('expired', 'invalidated') AND `active_manifest_key` IS NULL AND
       `accepted_manifest_key` IS NULL AND `active_driver_route_key` IS NULL AND
       `accepted_driver_route_key` IS NULL AND `accepted_at` IS NULL AND
       `rejected_at` IS NULL AND `expired_at` IS NOT NULL AND `reject_reason` IS NULL)))
  );

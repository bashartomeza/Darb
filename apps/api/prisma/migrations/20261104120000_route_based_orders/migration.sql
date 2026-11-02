-- Route-based orders (docs/routes/route-based-orders.md).
--
-- Every new passenger request, merchant order, passenger parcel and driver
-- route names one predefined service route and carries the exact pickup and
-- drop-off as free text. They stay legacy rows (operational_mode 'legacy',
-- canonical_entry_version NULL) so the legacy matcher keeps serving them, but
-- they now record the route's version in `route_version_id`.
--
-- The canonical shape checks used to require legacy rows to have no route at
-- all. They are rebuilt so a legacy row may carry `route_version_id` (and a
-- merchant order its requested departure window), while every other canonical
-- column (stop ids, canonical timestamps) must still be NULL on legacy rows.
-- The canonical branches are unchanged.

ALTER TABLE `passenger_requests`
  ADD COLUMN `pickup_details` VARCHAR(300) NULL,
  ADD COLUMN `dropoff_details` VARCHAR(300) NULL,
  DROP CHECK `passenger_requests_canonical_shape_chk`,
  ADD CONSTRAINT `passenger_requests_canonical_shape_chk` CHECK (
    (`operational_mode` = 'legacy' AND `canonical_entry_version` IS NULL AND
     `pickup_stop_id` IS NULL AND `dropoff_stop_id` IS NULL AND
     `requested_departure_from` IS NULL AND `requested_departure_until` IS NULL AND
     `canonical_created_at` IS NULL)
    OR
    (`operational_mode` = 'canonical_route_v1' AND
     `canonical_entry_version` = 'canonical_route_v1' AND `route_version_id` IS NOT NULL AND
     `pickup_stop_id` IS NOT NULL AND `dropoff_stop_id` IS NOT NULL AND
     `requested_departure_from` IS NOT NULL AND `requested_departure_until` IS NOT NULL AND
     `requested_departure_until` > `requested_departure_from` AND `canonical_created_at` IS NOT NULL)
  );

ALTER TABLE `merchant_orders`
  ADD COLUMN `pickup_details` VARCHAR(300) NULL,
  DROP CHECK `merchant_orders_canonical_shape_chk`,
  ADD CONSTRAINT `merchant_orders_canonical_shape_chk` CHECK (
    (`operational_mode` = 'legacy' AND `canonical_entry_version` IS NULL AND
     `pickup_stop_id` IS NULL AND `canonical_created_at` IS NULL AND
     ((`requested_departure_from` IS NULL AND `requested_departure_until` IS NULL) OR
      (`requested_departure_from` IS NOT NULL AND `requested_departure_until` IS NOT NULL AND
       `requested_departure_until` > `requested_departure_from`)))
    OR
    (`operational_mode` = 'canonical_route_v1' AND
     `canonical_entry_version` = 'canonical_route_v1' AND `route_version_id` IS NOT NULL AND
     `pickup_stop_id` IS NOT NULL AND `requested_departure_from` IS NOT NULL AND
     `requested_departure_until` IS NOT NULL AND
     `requested_departure_until` > `requested_departure_from` AND `canonical_created_at` IS NOT NULL)
  );

ALTER TABLE `parcels`
  ADD COLUMN `dropoff_details` VARCHAR(300) NULL,
  ADD COLUMN `receiver_name` VARCHAR(80) NULL,
  ADD COLUMN `receiver_phone` VARCHAR(32) NULL,
  DROP CHECK `parcels_canonical_shape_chk`,
  ADD CONSTRAINT `parcels_canonical_shape_chk` CHECK (
    (`operational_mode` = 'legacy' AND `canonical_entry_version` IS NULL AND
     `destination_stop_id` IS NULL)
    OR
    (`operational_mode` = 'canonical_route_v1' AND
     `canonical_entry_version` = 'canonical_route_v1' AND
     `route_version_id` IS NOT NULL AND `destination_stop_id` IS NOT NULL)
  ),
  ADD CONSTRAINT `parcels_receiver_phone_e164_chk` CHECK (
    `receiver_phone` IS NULL OR
    (CHAR_LENGTH(`receiver_phone`) BETWEEN 2 AND 16 AND `receiver_phone` REGEXP '^\\+[1-9][0-9]{0,14}$')
  );

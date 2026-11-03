-- Driver prices inside an admin range. Payments are still not processed in the
-- app: every price is an estimate the passenger or merchant pays the driver.
--
-- route_fares rows now also carry the range a driver may choose within for that
-- item. The table stays append-only history: a new range is a new row with its
-- own effective_from, reason and author. Both bounds are NULL (the driver
-- cannot change the default) or both set with min <= default <= max.
--
-- driver_routes keep the prices the driver chose when going online, one per
-- item. NULL means the route's default applies.

ALTER TABLE `route_fares`
    ADD COLUMN `min_minor` INTEGER NULL,
    ADD COLUMN `max_minor` INTEGER NULL,
    ADD CONSTRAINT `route_fares_driver_range_check` CHECK (
        (`min_minor` IS NULL AND `max_minor` IS NULL)
        OR (
            `amount_minor` IS NOT NULL
            AND `min_minor` > 0
            AND `min_minor` <= `amount_minor`
            AND `amount_minor` <= `max_minor`
            AND `max_minor` <= 10000000
        )
    );

ALTER TABLE `driver_routes`
    ADD COLUMN `seat_price_minor` INTEGER NULL,
    ADD COLUMN `parcel_s_price_minor` INTEGER NULL,
    ADD COLUMN `parcel_m_price_minor` INTEGER NULL,
    ADD COLUMN `parcel_l_price_minor` INTEGER NULL,
    ADD CONSTRAINT `driver_routes_seat_price_check` CHECK (`seat_price_minor` IS NULL OR (`seat_price_minor` > 0 AND `seat_price_minor` <= 10000000)),
    ADD CONSTRAINT `driver_routes_parcel_s_price_check` CHECK (`parcel_s_price_minor` IS NULL OR (`parcel_s_price_minor` > 0 AND `parcel_s_price_minor` <= 10000000)),
    ADD CONSTRAINT `driver_routes_parcel_m_price_check` CHECK (`parcel_m_price_minor` IS NULL OR (`parcel_m_price_minor` > 0 AND `parcel_m_price_minor` <= 10000000)),
    ADD CONSTRAINT `driver_routes_parcel_l_price_check` CHECK (`parcel_l_price_minor` IS NULL OR (`parcel_l_price_minor` > 0 AND `parcel_l_price_minor` <= 10000000));

-- Indexes for the retention purge jobs (docs/operations/data-retention.md), which find old rows
-- by age in small batches. Without them each batch would scan the whole table.
CREATE INDEX `location_events_recorded_at_idx` ON `location_events`(`recorded_at`);

CREATE INDEX `notifications_created_at_idx` ON `notifications`(`created_at`);

CREATE INDEX `abuse_counters_expires_at_idx` ON `abuse_counters`(`expires_at`);

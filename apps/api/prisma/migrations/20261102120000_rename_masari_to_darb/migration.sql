-- Brand rename: Masari -> Darb. The comparison table kept the old brand in three column names.
ALTER TABLE `comparison_runs`
    RENAME COLUMN `masari_trips` TO `darb_trips`,
    RENAME COLUMN `masari_estimated_distance` TO `darb_estimated_distance`,
    RENAME COLUMN `masari_estimated_cost` TO `darb_estimated_cost`;

-- Places of interest for the map (cafes, pharmacies, fuel stations, ...), loaded from
-- OpenStreetMap by `npm run places:import` (docs/maps/places.md) and editable by admins.
-- category is free text checked by the API against apps/api/data/map-place-categories.json,
-- so a new category needs no migration. osm_id ("node/123") makes the import repeatable;
-- admin_edited rows are left alone by later imports. active=0 hides a place from the apps.

CREATE TABLE `map_places` (
    `id` VARCHAR(191) NOT NULL,
    `category` VARCHAR(40) NOT NULL,
    `name_ar` VARCHAR(191) NULL,
    `name_en` VARCHAR(191) NULL,
    `latitude` DECIMAL(9, 6) NOT NULL,
    `longitude` DECIMAL(9, 6) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `opening_hours` VARCHAR(500) NULL,
    `city` VARCHAR(40) NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'osm',
    `osm_id` VARCHAR(40) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `admin_edited` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `map_places_osm_id_key`(`osm_id`),
    INDEX `map_places_active_category_latitude_longitude_idx`(`active`, `category`, `latitude`, `longitude`),
    INDEX `map_places_category_city_idx`(`category`, `city`),
    PRIMARY KEY (`id`),
    CONSTRAINT `map_places_latitude_range` CHECK (`latitude` BETWEEN -90 AND 90),
    CONSTRAINT `map_places_longitude_range` CHECK (`longitude` BETWEEN -180 AND 180)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- "This place is wrong" reports from the apps, reviewed on the admin places page.
CREATE TABLE `map_place_reports` (
    `id` VARCHAR(191) NOT NULL,
    `place_id` VARCHAR(191) NOT NULL,
    `reporter_id` VARCHAR(191) NULL,
    `reason` VARCHAR(30) NOT NULL,
    `note` VARCHAR(300) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,

    UNIQUE INDEX `map_place_reports_place_id_reporter_id_key`(`place_id`, `reporter_id`),
    INDEX `map_place_reports_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `map_place_reports` ADD CONSTRAINT `map_place_reports_place_id_fkey` FOREIGN KEY (`place_id`) REFERENCES `map_places`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `map_place_reports` ADD CONSTRAINT `map_place_reports_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

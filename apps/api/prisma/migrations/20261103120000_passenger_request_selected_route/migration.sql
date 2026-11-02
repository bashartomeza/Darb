-- Persist the driver route a passenger picked when booking. Matching and
-- recovery read the pin from the request row instead of one device.

-- AlterTable
ALTER TABLE `passenger_requests` ADD COLUMN `selected_driver_route_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `passenger_requests_selected_driver_route_id_idx` ON `passenger_requests`(`selected_driver_route_id`);

-- AddForeignKey
ALTER TABLE `passenger_requests` ADD CONSTRAINT `passenger_requests_selected_driver_route_id_fkey` FOREIGN KEY (`selected_driver_route_id`) REFERENCES `driver_routes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

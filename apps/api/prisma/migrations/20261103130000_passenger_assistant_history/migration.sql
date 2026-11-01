-- Passenger assistant chat history, owned by the passenger and erased with the account.

CREATE TABLE `passenger_assistant_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `passenger_id` VARCHAR(191) NOT NULL,
    `saved_request_id` VARCHAR(191) NULL,
    `next_sequence` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `passenger_assistant_conversations_passenger_id_updated_at_idx`(`passenger_id`, `updated_at`),
    INDEX `passenger_assistant_conversations_saved_request_id_idx`(`saved_request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `passenger_assistant_messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `role` ENUM('user', 'assistant') NOT NULL,
    `text` VARCHAR(2000) NOT NULL,
    `payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `passenger_assistant_messages_conversation_id_sequence_key`(`conversation_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `passenger_assistant_conversations` ADD CONSTRAINT `passenger_assistant_conversations_passenger_id_fkey` FOREIGN KEY (`passenger_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `passenger_assistant_conversations` ADD CONSTRAINT `passenger_assistant_conversations_saved_request_id_fkey` FOREIGN KEY (`saved_request_id`) REFERENCES `passenger_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `passenger_assistant_messages` ADD CONSTRAINT `passenger_assistant_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `passenger_assistant_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

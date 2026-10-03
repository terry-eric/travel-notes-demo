CREATE TABLE `trips` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`previous` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`mutation_id` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE TABLE `trip_members` (
	`email` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);

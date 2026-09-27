CREATE TABLE `closet_sample_preview` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`source_hash` text NOT NULL,
	`reference_hash` text NOT NULL,
	`task_id` text,
	`result_key` text,
	`result_hash` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`next_poll_at` integer NOT NULL
);

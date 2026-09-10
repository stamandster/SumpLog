CREATE TABLE `owner_credentials` (
  `id` integer PRIMARY KEY NOT NULL,
  `password_hash` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (`id` = 1)
);

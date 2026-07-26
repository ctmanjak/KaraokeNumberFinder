-- Add an explicit, server-authoritative role for admin-only operations.
CREATE TYPE "user_role" AS ENUM ('user', 'admin');

ALTER TABLE "users"
ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'user';

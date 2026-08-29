ALTER TABLE "rentnerproxy"."users" ADD COLUMN "profile_image_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."users" ADD COLUMN "profile_image_webp" "bytea";
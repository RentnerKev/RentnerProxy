CREATE SCHEMA "rentnerproxy";
--> statement-breakpoint
ALTER TABLE "public"."system_settings" SET SCHEMA "rentnerproxy";
--> statement-breakpoint
ALTER FUNCTION "public"."rentnerproxy_set_system_settings_updated_at"()
SET SCHEMA "rentnerproxy";

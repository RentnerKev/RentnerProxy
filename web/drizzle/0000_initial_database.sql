CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE FUNCTION "public"."rentnerproxy_set_system_settings_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW."updated_at" := statement_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "system_settings_set_updated_at"
BEFORE UPDATE ON "system_settings"
FOR EACH ROW
EXECUTE FUNCTION "public"."rentnerproxy_set_system_settings_updated_at"();

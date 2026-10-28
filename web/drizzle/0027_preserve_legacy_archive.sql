CREATE TABLE IF NOT EXISTS "rentnerproxy"."proxy_host_legacy_settings" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
    "proxy_host_id" uuid NOT NULL,
    "advanced_config" text,
    "unsupported_settings" jsonb,
    "archived_at" timestamp with time zone DEFAULT now() NOT NULL
);

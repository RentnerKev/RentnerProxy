CREATE TABLE "rentnerproxy"."proxy_host_legacy_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proxy_host_id" uuid NOT NULL,
	"advanced_config" text,
	"unsupported_settings" jsonb,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
WITH host_settings AS (
    SELECT p."id", p."advanced_config",
        CASE WHEN jsonb_typeof(s."value") = 'string'
            THEN (s."value" #>> '{}')::jsonb
            ELSE s."value"
        END AS "value"
    FROM "rentnerproxy"."proxy_hosts" p
    LEFT JOIN "rentnerproxy"."system_settings" s
      ON s."key" = 'proxy_runtime_host_v1:' || lower(p."id"::text)
)
INSERT INTO "rentnerproxy"."proxy_host_legacy_settings" ("proxy_host_id", "advanced_config", "unsupported_settings")
SELECT
    s."id",
    NULLIF(s."advanced_config", ''),
    CASE
        WHEN s."value"->'httpSettings' ? 'sendTimeoutSeconds'
          OR s."value"->'httpSettings' ? 'keepaliveTimeoutSeconds'
        THEN jsonb_strip_nulls(jsonb_build_object(
            'sendTimeoutSeconds', s."value"->'httpSettings'->'sendTimeoutSeconds',
            'keepaliveTimeoutSeconds', s."value"->'httpSettings'->'keepaliveTimeoutSeconds'
        ))
        ELSE NULL
    END
FROM host_settings s
WHERE NULLIF(s."advanced_config", '') IS NOT NULL
   OR s."value"->'httpSettings' ? 'sendTimeoutSeconds'
   OR s."value"->'httpSettings' ? 'keepaliveTimeoutSeconds';
--> statement-breakpoint
DO $$
DECLARE archived_count integer;
BEGIN
    SELECT count(*) INTO archived_count FROM "rentnerproxy"."proxy_host_legacy_settings";
    IF archived_count > 0 THEN
        RAISE NOTICE 'Caddy upgrade archived % proxy host legacy setting record(s); review proxy_host_legacy_settings.', archived_count;
    END IF;
END $$;
--> statement-breakpoint
WITH archived_settings AS (
    SELECT s."key",
        CASE WHEN jsonb_typeof(s."value") = 'string'
            THEN (s."value" #>> '{}')::jsonb
            ELSE s."value"
        END AS "value"
    FROM "rentnerproxy"."system_settings" s
    JOIN "rentnerproxy"."proxy_host_legacy_settings" a
      ON s."key" = 'proxy_runtime_host_v1:' || lower(a."proxy_host_id"::text)
    WHERE a."unsupported_settings" IS NOT NULL
)
UPDATE "rentnerproxy"."system_settings" AS s
SET "value" = jsonb_set(
    a."value",
    '{httpSettings}',
    COALESCE(a."value"->'httpSettings', '{}'::jsonb)
        - 'sendTimeoutSeconds'
        - 'keepaliveTimeoutSeconds'
),
    "updated_at" = now()
FROM archived_settings a
WHERE s."key" = a."key";
--> statement-breakpoint
DELETE FROM "rentnerproxy"."permissions"
WHERE "key" = 'proxy_hosts.advanced_config';
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" DROP COLUMN "advanced_config";

ALTER TYPE "rentnerproxy"."audit_resource" ADD VALUE 'host-monitoring' BEFORE 'proxy-runtime';--> statement-breakpoint
CREATE TABLE "rentnerproxy"."host_check_incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"policy_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"recovery_started_at" timestamp with time zone,
	"recovered_at" timestamp with time zone,
	"failure_code" varchar(32) NOT NULL,
	"recovery_code" varchar(32),
	"closed_reason" varchar(24),
	"closed_at" timestamp with time zone,
	CONSTRAINT "host_check_incidents_closed_reason_check" CHECK ("rentnerproxy"."host_check_incidents"."closed_reason" is null or "rentnerproxy"."host_check_incidents"."closed_reason" in ('recovered','policy_changed','monitoring_disabled')),
	CONSTRAINT "host_check_incidents_closed_at_check" CHECK (("rentnerproxy"."host_check_incidents"."closed_reason" is null) = ("rentnerproxy"."host_check_incidents"."closed_at" is null) and ("rentnerproxy"."host_check_incidents"."closed_at" is null or "rentnerproxy"."host_check_incidents"."closed_at" >= "rentnerproxy"."host_check_incidents"."detected_at")),
	CONSTRAINT "host_check_incidents_dates_check" CHECK ("rentnerproxy"."host_check_incidents"."detected_at" >= "rentnerproxy"."host_check_incidents"."started_at" and ("rentnerproxy"."host_check_incidents"."recovery_started_at" is null or "rentnerproxy"."host_check_incidents"."recovery_started_at" >= "rentnerproxy"."host_check_incidents"."started_at") and ("rentnerproxy"."host_check_incidents"."recovered_at" is null or "rentnerproxy"."host_check_incidents"."recovered_at" >= "rentnerproxy"."host_check_incidents"."detected_at")),
	CONSTRAINT "host_check_incidents_recovery_check" CHECK (("rentnerproxy"."host_check_incidents"."closed_reason" is not distinct from 'recovered' and "rentnerproxy"."host_check_incidents"."recovery_started_at" is not null and "rentnerproxy"."host_check_incidents"."recovered_at" is not null and "rentnerproxy"."host_check_incidents"."recovery_code" is not null) or ("rentnerproxy"."host_check_incidents"."closed_reason" is distinct from 'recovered' and "rentnerproxy"."host_check_incidents"."recovered_at" is null and "rentnerproxy"."host_check_incidents"."recovery_code" is null)),
	CONSTRAINT "host_check_incidents_failure_code_check" CHECK ("rentnerproxy"."host_check_incidents"."failure_code" in ('unexpected_status','upstream_unreachable','upstream_timeout','upstream_dns_failed','tls_failed')),
	CONSTRAINT "host_check_incidents_recovery_code_check" CHECK ("rentnerproxy"."host_check_incidents"."recovery_code" is null or "rentnerproxy"."host_check_incidents"."recovery_code" = 'expected_status')
);
--> statement-breakpoint
CREATE TABLE "rentnerproxy"."host_check_observations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_version" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(10) NOT NULL,
	"code" varchar(32) NOT NULL,
	"duration_ms" integer,
	"http_status" integer,
	CONSTRAINT "host_check_observations_status_check" CHECK ("rentnerproxy"."host_check_observations"."status" in ('unknown','healthy','unhealthy')),
	CONSTRAINT "host_check_observations_code_check" CHECK ("rentnerproxy"."host_check_observations"."code" in ('expected_status','unexpected_status','upstream_unreachable','upstream_timeout','upstream_dns_failed','tls_failed','configuration_stale','configuration_changed','host_not_active','runtime_unavailable','busy','invalid_response')),
	CONSTRAINT "host_check_observations_duration_check" CHECK ("rentnerproxy"."host_check_observations"."duration_ms" is null or "rentnerproxy"."host_check_observations"."duration_ms" between 0 and 12000),
	CONSTRAINT "host_check_observations_http_status_check" CHECK ("rentnerproxy"."host_check_observations"."http_status" is null or "rentnerproxy"."host_check_observations"."http_status" between 100 and 599)
);
--> statement-breakpoint
CREATE TABLE "rentnerproxy"."host_check_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proxy_host_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" uuid DEFAULT uuidv7() NOT NULL,
	"context_proof" varchar(71),
	"context_revision" varchar(71),
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"timeout_ms" integer DEFAULT 3000 NOT NULL,
	"expected_status" integer DEFAULT 200 NOT NULL,
	"failure_threshold" integer DEFAULT 3 NOT NULL,
	"recovery_threshold" integer DEFAULT 2 NOT NULL,
	"retention_days" integer DEFAULT 7 NOT NULL,
	"sample_limit" integer DEFAULT 1440 NOT NULL,
	"incident_limit" integer DEFAULT 100 NOT NULL,
	"state" varchar(10) DEFAULT 'unknown' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"failure_started_at" timestamp with time zone,
	"recovery_started_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_outcome" varchar(10),
	"last_code" varchar(32),
	"last_duration_ms" integer,
	"last_http_status" integer,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"configured_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_check_policies_domain_check" CHECK ("rentnerproxy"."host_check_policies"."domain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and "rentnerproxy"."host_check_policies"."domain" !~ '^[0-9.]+$'),
	CONSTRAINT "host_check_policies_interval_check" CHECK ("rentnerproxy"."host_check_policies"."interval_seconds" between 30 and 86400),
	CONSTRAINT "host_check_policies_timeout_check" CHECK ("rentnerproxy"."host_check_policies"."timeout_ms" between 1000 and 10000),
	CONSTRAINT "host_check_policies_status_check" CHECK ("rentnerproxy"."host_check_policies"."expected_status" between 100 and 599),
	CONSTRAINT "host_check_policies_thresholds_check" CHECK ("rentnerproxy"."host_check_policies"."failure_threshold" between 1 and 20 and "rentnerproxy"."host_check_policies"."recovery_threshold" between 1 and 20),
	CONSTRAINT "host_check_policies_retention_check" CHECK ("rentnerproxy"."host_check_policies"."retention_days" between 1 and 30 and "rentnerproxy"."host_check_policies"."sample_limit" between 10 and 10000 and "rentnerproxy"."host_check_policies"."incident_limit" between 1 and 1000),
	CONSTRAINT "host_check_policies_state_check" CHECK ("rentnerproxy"."host_check_policies"."state" in ('unknown','healthy','unhealthy')),
	CONSTRAINT "host_check_policies_streaks_check" CHECK ("rentnerproxy"."host_check_policies"."failure_count" between 0 and "rentnerproxy"."host_check_policies"."failure_threshold" and "rentnerproxy"."host_check_policies"."recovery_count" between 0 and "rentnerproxy"."host_check_policies"."recovery_threshold" and ("rentnerproxy"."host_check_policies"."failure_count" = 0) = ("rentnerproxy"."host_check_policies"."failure_started_at" is null) and ("rentnerproxy"."host_check_policies"."recovery_count" = 0) = ("rentnerproxy"."host_check_policies"."recovery_started_at" is null)),
	CONSTRAINT "host_check_policies_lease_check" CHECK (("rentnerproxy"."host_check_policies"."lease_token" is null) = ("rentnerproxy"."host_check_policies"."lease_expires_at" is null)),
	CONSTRAINT "host_check_policies_context_check" CHECK (("rentnerproxy"."host_check_policies"."context_proof" is null and "rentnerproxy"."host_check_policies"."context_revision" is null) or ("rentnerproxy"."host_check_policies"."context_proof" is not null and "rentnerproxy"."host_check_policies"."context_revision" is not null and "rentnerproxy"."host_check_policies"."context_proof" ~ '^sha256:[a-f0-9]{64}$' and "rentnerproxy"."host_check_policies"."context_revision" ~ '^sha256:[a-f0-9]{64}$')),
	CONSTRAINT "host_check_policies_last_outcome_check" CHECK ("rentnerproxy"."host_check_policies"."last_outcome" is null or "rentnerproxy"."host_check_policies"."last_outcome" in ('unknown','healthy','unhealthy')),
	CONSTRAINT "host_check_policies_last_duration_check" CHECK ("rentnerproxy"."host_check_policies"."last_duration_ms" is null or "rentnerproxy"."host_check_policies"."last_duration_ms" between 0 and 12000),
	CONSTRAINT "host_check_policies_last_http_status_check" CHECK ("rentnerproxy"."host_check_policies"."last_http_status" is null or "rentnerproxy"."host_check_policies"."last_http_status" between 100 and 599),
	CONSTRAINT "host_check_policies_last_code_check" CHECK ("rentnerproxy"."host_check_policies"."last_code" is null or "rentnerproxy"."host_check_policies"."last_code" in ('expected_status','unexpected_status','upstream_unreachable','upstream_timeout','upstream_dns_failed','tls_failed','configuration_stale','configuration_changed','host_not_active','runtime_unavailable','busy','invalid_response'))
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_check_incidents" ADD CONSTRAINT "host_check_incidents_policy_id_host_check_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "rentnerproxy"."host_check_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_check_observations" ADD CONSTRAINT "host_check_observations_policy_id_host_check_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "rentnerproxy"."host_check_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_check_policies" ADD CONSTRAINT "host_check_policies_proxy_host_id_proxy_hosts_id_fk" FOREIGN KEY ("proxy_host_id") REFERENCES "rentnerproxy"."proxy_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_check_policies" ADD CONSTRAINT "host_check_policies_configured_by_users_id_fk" FOREIGN KEY ("configured_by") REFERENCES "rentnerproxy"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_check_incidents_one_open_unique" ON "rentnerproxy"."host_check_incidents" USING btree ("policy_id") WHERE "rentnerproxy"."host_check_incidents"."closed_reason" is null;--> statement-breakpoint
CREATE INDEX "host_check_incidents_policy_time_idx" ON "rentnerproxy"."host_check_incidents" USING btree ("policy_id","started_at","id");--> statement-breakpoint
CREATE INDEX "host_check_incidents_closed_time_idx" ON "rentnerproxy"."host_check_incidents" USING btree ("closed_at","id") WHERE "rentnerproxy"."host_check_incidents"."closed_at" is not null;--> statement-breakpoint
CREATE INDEX "host_check_observations_policy_time_idx" ON "rentnerproxy"."host_check_observations" USING btree ("policy_id","checked_at","id");--> statement-breakpoint
CREATE INDEX "host_check_observations_time_idx" ON "rentnerproxy"."host_check_observations" USING btree ("checked_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "host_check_policies_host_unique" ON "rentnerproxy"."host_check_policies" USING btree ("proxy_host_id");--> statement-breakpoint
CREATE INDEX "host_check_policies_due_idx" ON "rentnerproxy"."host_check_policies" USING btree ("next_check_at") WHERE "rentnerproxy"."host_check_policies"."enabled";--> statement-breakpoint
CREATE INDEX "host_check_policies_lease_idx" ON "rentnerproxy"."host_check_policies" USING btree ("lease_expires_at") WHERE "rentnerproxy"."host_check_policies"."lease_token" is not null;
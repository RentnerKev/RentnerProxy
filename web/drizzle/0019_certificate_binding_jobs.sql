CREATE TABLE "rentnerproxy"."certificate_binding_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_user_id" uuid,
	"proxy_host_id" uuid,
	"certificate_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"request_digest" varchar(64) NOT NULL,
	"domains" text[] NOT NULL,
	"required_permissions" text[] NOT NULL,
	"host_revision" varchar(64) NOT NULL,
	"assigned_revision" varchar(64),
	"desired_enabled" boolean NOT NULL,
	"desired_force_https" boolean NOT NULL,
	"request_ciphertext" "bytea",
	"request_iv" "bytea",
	"stage" varchar(20) DEFAULT 'preparing' NOT NULL,
	"controller_stage" varchar(40),
	"controller_operation_id" uuid,
	"last_error_code" varchar(64),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"retry_requested" boolean DEFAULT false NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_jobs_actor_idempotency_unique" UNIQUE("actor_user_id","idempotency_key"),
	CONSTRAINT "certificate_jobs_certificate_unique" UNIQUE("certificate_id"),
	CONSTRAINT "certificate_jobs_stage_check" CHECK ("rentnerproxy"."certificate_binding_jobs"."stage" in ('preparing','issuing','applying','applied','failed','needs_attention')),
	CONSTRAINT "certificate_jobs_attempts_check" CHECK ("rentnerproxy"."certificate_binding_jobs"."attempt_count" >= 0),
	CONSTRAINT "certificate_jobs_domains_check" CHECK (cardinality("rentnerproxy"."certificate_binding_jobs"."domains") between 1 and 100),
	CONSTRAINT "certificate_jobs_permissions_check" CHECK (cardinality("rentnerproxy"."certificate_binding_jobs"."required_permissions") between 1 and 10),
	CONSTRAINT "certificate_jobs_secret_check" CHECK (("rentnerproxy"."certificate_binding_jobs"."request_ciphertext" is null and "rentnerproxy"."certificate_binding_jobs"."request_iv" is null) or ("rentnerproxy"."certificate_binding_jobs"."request_ciphertext" is not null and "rentnerproxy"."certificate_binding_jobs"."request_iv" is not null and octet_length("rentnerproxy"."certificate_binding_jobs"."request_ciphertext") between 17 and 65536 and octet_length("rentnerproxy"."certificate_binding_jobs"."request_iv") = 12)),
	CONSTRAINT "certificate_jobs_lease_check" CHECK (("rentnerproxy"."certificate_binding_jobs"."lease_token" is null) = ("rentnerproxy"."certificate_binding_jobs"."lease_expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificate_binding_jobs" ADD CONSTRAINT "certificate_binding_jobs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "rentnerproxy"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificate_binding_jobs" ADD CONSTRAINT "certificate_binding_jobs_proxy_host_id_proxy_hosts_id_fk" FOREIGN KEY ("proxy_host_id") REFERENCES "rentnerproxy"."proxy_hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificate_binding_jobs" ADD CONSTRAINT "certificate_binding_jobs_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "rentnerproxy"."certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificate_jobs_due_idx" ON "rentnerproxy"."certificate_binding_jobs" USING btree ("stage","next_attempt_at");--> statement-breakpoint
CREATE INDEX "certificate_jobs_host_created_idx" ON "rentnerproxy"."certificate_binding_jobs" USING btree ("proxy_host_id","created_at");
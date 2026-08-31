CREATE TABLE "rentnerproxy"."trusted_cas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" varchar(120) NOT NULL,
	"pem" text NOT NULL,
	"fingerprint_sha256" varchar(71) NOT NULL,
	"subject" varchar(512) NOT NULL,
	"issuer" varchar(512) NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_cas_fingerprint_sha256_unique" UNIQUE("fingerprint_sha256"),
	CONSTRAINT "trusted_cas_name_check" CHECK (length(btrim("rentnerproxy"."trusted_cas"."name")) > 0),
	CONSTRAINT "trusted_cas_fingerprint_sha256_check" CHECK ("rentnerproxy"."trusted_cas"."fingerprint_sha256" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "trusted_cas_validity_check" CHECK ("rentnerproxy"."trusted_cas"."not_before" < "rentnerproxy"."trusted_cas"."not_after"),
	CONSTRAINT "trusted_cas_pem_limit_check" CHECK (octet_length("rentnerproxy"."trusted_cas"."pem") between 1 and 262144)
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD COLUMN "verify_upstream_tls" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Preserve the previous implicit opt-out for HTTPS hosts that already exist at migration time.
-- The column default stays true for all hosts created after this migration.
UPDATE "rentnerproxy"."proxy_hosts" SET "verify_upstream_tls" = false WHERE "forward_scheme" = 'https';--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD COLUMN "upstream_tls_server_name" varchar(253);--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD COLUMN "trusted_ca_id" uuid;--> statement-breakpoint
CREATE INDEX "trusted_cas_created_at_idx" ON "rentnerproxy"."trusted_cas" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD CONSTRAINT "proxy_hosts_trusted_ca_id_trusted_cas_id_fk" FOREIGN KEY ("trusted_ca_id") REFERENCES "rentnerproxy"."trusted_cas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proxy_hosts_trusted_ca_id_idx" ON "rentnerproxy"."proxy_hosts" USING btree ("trusted_ca_id");--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD CONSTRAINT "proxy_hosts_trusted_ca_verification_check" CHECK ("rentnerproxy"."proxy_hosts"."trusted_ca_id" is null or ("rentnerproxy"."proxy_hosts"."forward_scheme" = 'https' and "rentnerproxy"."proxy_hosts"."verify_upstream_tls" = true));
CREATE TABLE "rentnerproxy"."certificate_domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"certificate_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_domains_certificate_domain_unique" UNIQUE("certificate_id","domain"),
	CONSTRAINT "certificate_domains_canonical_check" CHECK ("rentnerproxy"."certificate_domains"."domain" ~ '^([*][.])?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and "rentnerproxy"."certificate_domains"."domain" !~ '^[0-9.]+$')
);
--> statement-breakpoint
CREATE TABLE "rentnerproxy"."certificates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" varchar(120) NOT NULL,
	"source" varchar(10) NOT NULL,
	"environment" varchar(10),
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"operation" varchar(10) DEFAULT 'idle' NOT NULL,
	"issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"issuer" varchar(512),
	"fingerprint" varchar(71),
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_name_check" CHECK (length(btrim("rentnerproxy"."certificates"."name")) > 0),
	CONSTRAINT "certificates_source_check" CHECK ("rentnerproxy"."certificates"."source" in ('manual', 'acme')),
	CONSTRAINT "certificates_environment_check" CHECK (("rentnerproxy"."certificates"."source" = 'manual' and "rentnerproxy"."certificates"."environment" is null) or ("rentnerproxy"."certificates"."source" = 'acme' and "rentnerproxy"."certificates"."environment" is not null and "rentnerproxy"."certificates"."environment" in ('staging', 'production'))),
	CONSTRAINT "certificates_status_check" CHECK ("rentnerproxy"."certificates"."status" in ('pending', 'valid', 'failed')),
	CONSTRAINT "certificates_operation_check" CHECK ("rentnerproxy"."certificates"."operation" in ('idle', 'issuing', 'renewing')),
	CONSTRAINT "certificates_validity_check" CHECK ("rentnerproxy"."certificates"."status" != 'valid' or ("rentnerproxy"."certificates"."issued_at" is not null and "rentnerproxy"."certificates"."expires_at" is not null and "rentnerproxy"."certificates"."issued_at" < "rentnerproxy"."certificates"."expires_at" and "rentnerproxy"."certificates"."fingerprint" is not null)),
	CONSTRAINT "certificates_fingerprint_check" CHECK ("rentnerproxy"."certificates"."fingerprint" is null or "rentnerproxy"."certificates"."fingerprint" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD COLUMN "certificate_id" uuid;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD COLUMN "force_https" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificate_domains" ADD CONSTRAINT "certificate_domains_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "rentnerproxy"."certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificate_domains_certificate_id_idx" ON "rentnerproxy"."certificate_domains" USING btree ("certificate_id");--> statement-breakpoint
CREATE INDEX "certificates_expires_at_idx" ON "rentnerproxy"."certificates" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD CONSTRAINT "proxy_hosts_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "rentnerproxy"."certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proxy_hosts_certificate_id_idx" ON "rentnerproxy"."proxy_hosts" USING btree ("certificate_id");--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD CONSTRAINT "proxy_hosts_force_https_check" CHECK ("rentnerproxy"."proxy_hosts"."force_https" = false or "rentnerproxy"."proxy_hosts"."certificate_id" is not null);
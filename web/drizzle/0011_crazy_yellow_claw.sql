CREATE TABLE "rentnerproxy"."redirect_hosts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"destination" varchar(2048) NOT NULL,
	"status_code" integer DEFAULT 302 NOT NULL,
	"preserve_request_uri" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"certificate_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirect_hosts_status_code_check" CHECK ("rentnerproxy"."redirect_hosts"."status_code" in (301, 302, 307, 308))
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_host_domains" RENAME TO "host_domains";--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_domains" RENAME CONSTRAINT "proxy_host_domains_pkey" TO "host_domains_pkey";--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_domains" RENAME CONSTRAINT "proxy_host_domains_domain_unique" TO "host_domains_domain_unique";--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_domains" RENAME CONSTRAINT "proxy_host_domains_domain_canonical_check" TO "host_domains_domain_canonical_check";--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_domains" RENAME CONSTRAINT "proxy_host_domains_proxy_host_id_proxy_hosts_id_fk" TO "host_domains_proxy_host_id_proxy_hosts_id_fk";--> statement-breakpoint
ALTER INDEX "rentnerproxy"."proxy_host_domains_proxy_host_id_idx" RENAME TO "host_domains_proxy_host_id_idx";--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_domains" ALTER COLUMN "proxy_host_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_domains" ADD COLUMN "redirect_host_id" uuid;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_domains" ADD CONSTRAINT "host_domains_exactly_one_owner_check" CHECK (num_nonnulls("proxy_host_id", "redirect_host_id") = 1);--> statement-breakpoint
ALTER TABLE "rentnerproxy"."host_domains" ADD CONSTRAINT "host_domains_redirect_host_id_redirect_hosts_id_fk" FOREIGN KEY ("redirect_host_id") REFERENCES "rentnerproxy"."redirect_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."redirect_hosts" ADD CONSTRAINT "redirect_hosts_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "rentnerproxy"."certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_domains_redirect_host_id_idx" ON "rentnerproxy"."host_domains" USING btree ("redirect_host_id");--> statement-breakpoint
CREATE INDEX "redirect_hosts_enabled_idx" ON "rentnerproxy"."redirect_hosts" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "redirect_hosts_certificate_id_idx" ON "rentnerproxy"."redirect_hosts" USING btree ("certificate_id");

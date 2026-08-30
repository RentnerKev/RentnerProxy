CREATE TABLE "rentnerproxy"."proxy_host_domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proxy_host_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proxy_host_domains_domain_unique" UNIQUE("domain"),
	CONSTRAINT "proxy_host_domains_domain_canonical_check" CHECK ("rentnerproxy"."proxy_host_domains"."domain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and "rentnerproxy"."proxy_host_domains"."domain" !~ '^[0-9.]+$')
);
--> statement-breakpoint
CREATE TABLE "rentnerproxy"."proxy_hosts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"forward_scheme" varchar(5) NOT NULL,
	"forward_host" varchar(253) NOT NULL,
	"forward_port" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proxy_hosts_forward_scheme_check" CHECK ("rentnerproxy"."proxy_hosts"."forward_scheme" in ('http', 'https')),
	CONSTRAINT "proxy_hosts_forward_port_check" CHECK ("rentnerproxy"."proxy_hosts"."forward_port" between 1 and 65535),
	CONSTRAINT "proxy_hosts_forward_host_check" CHECK (length(btrim("rentnerproxy"."proxy_hosts"."forward_host")) > 0)
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_host_domains" ADD CONSTRAINT "proxy_host_domains_proxy_host_id_proxy_hosts_id_fk" FOREIGN KEY ("proxy_host_id") REFERENCES "rentnerproxy"."proxy_hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proxy_host_domains_proxy_host_id_idx" ON "rentnerproxy"."proxy_host_domains" USING btree ("proxy_host_id");--> statement-breakpoint
CREATE INDEX "proxy_hosts_enabled_idx" ON "rentnerproxy"."proxy_hosts" USING btree ("enabled");
CREATE TYPE "rentnerproxy"."access_policy_combination" AS ENUM('all', 'any');--> statement-breakpoint
CREATE TYPE "rentnerproxy"."access_policy_mode" AS ENUM('public', 'authenticated', 'ip-restricted', 'combined');--> statement-breakpoint
CREATE TABLE "rentnerproxy"."access_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"mode" "rentnerproxy"."access_policy_mode" NOT NULL,
	"combination" "rentnerproxy"."access_policy_combination",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_policies_combination_check" CHECK (("rentnerproxy"."access_policies"."mode" = 'combined' and "rentnerproxy"."access_policies"."combination" is not null) or ("rentnerproxy"."access_policies"."mode" <> 'combined' and "rentnerproxy"."access_policies"."combination" is null))
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD COLUMN "access_policy_id" uuid;--> statement-breakpoint
CREATE INDEX "access_policies_mode_idx" ON "rentnerproxy"."access_policies" USING btree ("mode");--> statement-breakpoint
ALTER TABLE "rentnerproxy"."proxy_hosts" ADD CONSTRAINT "proxy_hosts_access_policy_id_access_policies_id_fk" FOREIGN KEY ("access_policy_id") REFERENCES "rentnerproxy"."access_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proxy_hosts_access_policy_id_idx" ON "rentnerproxy"."proxy_hosts" USING btree ("access_policy_id");
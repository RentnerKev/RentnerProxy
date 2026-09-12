CREATE TABLE "rentnerproxy"."access_policy_basic_auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"policy_id" uuid NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."access_policy_basic_auth_accounts" ADD CONSTRAINT "access_policy_basic_auth_accounts_policy_id_access_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "rentnerproxy"."access_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_policy_basic_auth_accounts_policy_id_idx" ON "rentnerproxy"."access_policy_basic_auth_accounts" USING btree ("policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_policy_basic_auth_accounts_policy_username_unique" ON "rentnerproxy"."access_policy_basic_auth_accounts" USING btree ("policy_id","username");
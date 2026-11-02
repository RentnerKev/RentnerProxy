ALTER TABLE "rentnerproxy"."users" ADD COLUMN "oidc_provider_id" uuid;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."sessions" ADD COLUMN "oidc_proof" jsonb DEFAULT '{}'::jsonb;
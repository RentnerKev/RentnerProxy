CREATE TYPE "rentnerproxy"."audit_action" AS ENUM('login', 'logout', 'create', 'update', 'delete', 'enable', 'disable', 'rotate', 'reset', 'accept', 'reauthenticate', 'import', 'replace', 'request', 'renew', 'save', 'apply');--> statement-breakpoint
CREATE TYPE "rentnerproxy"."audit_actor_kind" AS ENUM('user', 'anonymous', 'system');--> statement-breakpoint
CREATE TYPE "rentnerproxy"."audit_resource" AS ENUM('session', 'password', 'totp', 'recovery-codes', 'passkey', 'invite', 'setup', 'security-settings', 'user', 'role', 'proxy-host', 'redirect-host', 'access-policy', 'basic-auth-account', 'certificate', 'trusted-ca', 'proxy-runtime-settings', 'proxy-host-settings', 'proxy-runtime');--> statement-breakpoint
CREATE TYPE "rentnerproxy"."audit_result" AS ENUM('success', 'failure', 'denied');--> statement-breakpoint
CREATE TABLE "rentnerproxy"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" "rentnerproxy"."audit_actor_kind" NOT NULL,
	"action" "rentnerproxy"."audit_action" NOT NULL,
	"resource" "rentnerproxy"."audit_resource" NOT NULL,
	"target_id" uuid,
	"result" "rentnerproxy"."audit_result" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_metadata_size_check" CHECK (pg_column_size("rentnerproxy"."audit_events"."metadata") <= 4096)
);
--> statement-breakpoint
CREATE INDEX "audit_events_created_at_id_idx" ON "rentnerproxy"."audit_events" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_user_id_idx" ON "rentnerproxy"."audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_resource_idx" ON "rentnerproxy"."audit_events" USING btree ("action","resource");--> statement-breakpoint
CREATE INDEX "audit_events_result_idx" ON "rentnerproxy"."audit_events" USING btree ("result");
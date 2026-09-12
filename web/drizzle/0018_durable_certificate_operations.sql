ALTER TYPE "rentnerproxy"."audit_action" ADD VALUE 'accepted';--> statement-breakpoint
ALTER TYPE "rentnerproxy"."audit_action" ADD VALUE 'started';--> statement-breakpoint
ALTER TYPE "rentnerproxy"."audit_action" ADD VALUE 'issued';--> statement-breakpoint
ALTER TYPE "rentnerproxy"."audit_action" ADD VALUE 'activated';--> statement-breakpoint
ALTER TYPE "rentnerproxy"."audit_action" ADD VALUE 'renewed';--> statement-breakpoint
ALTER TYPE "rentnerproxy"."audit_action" ADD VALUE 'retry_scheduled';--> statement-breakpoint
ALTER TYPE "rentnerproxy"."audit_action" ADD VALUE 'failed';--> statement-breakpoint
CREATE TABLE "rentnerproxy"."certificate_event_cursor" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cursor" varchar(512),
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_event_cursor_singleton_check" CHECK ("rentnerproxy"."certificate_event_cursor"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "rentnerproxy"."certificate_event_receipts" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"stage" varchar(32) NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"error_code" varchar(64),
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_event_receipts_kind_check" CHECK ("rentnerproxy"."certificate_event_receipts"."kind" in ('accepted', 'started', 'issued', 'activated', 'renewed', 'retry_scheduled', 'failed')),
	CONSTRAINT "certificate_event_receipts_stage_check" CHECK ("rentnerproxy"."certificate_event_receipts"."stage" in ('queued', 'creating_order', 'preparing_challenge', 'waiting_for_validation', 'finalizing', 'certificate_ready', 'applying', 'applied', 'retry_scheduled', 'failed', 'needs_attention'))
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "current_operation" jsonb;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "challenge_type" varchar(7);--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "last_activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "next_renewal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD COLUMN "controller_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "certificate_event_receipts_received_at_idx" ON "rentnerproxy"."certificate_event_receipts" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "certificate_event_receipts_certificate_id_idx" ON "rentnerproxy"."certificate_event_receipts" USING btree ("certificate_id");--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD CONSTRAINT "certificates_challenge_type_check" CHECK ("rentnerproxy"."certificates"."challenge_type" is null or "rentnerproxy"."certificates"."challenge_type" in ('http-01', 'dns-01'));--> statement-breakpoint
ALTER TABLE "rentnerproxy"."certificates" ADD CONSTRAINT "certificates_attempt_count_check" CHECK ("rentnerproxy"."certificates"."attempt_count" >= 0);
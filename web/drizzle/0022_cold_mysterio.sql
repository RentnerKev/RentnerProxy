ALTER TYPE "rentnerproxy"."audit_resource" ADD VALUE 'npm-import';--> statement-breakpoint
CREATE TABLE "rentnerproxy"."npm_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_user_id" uuid,
	"source_fingerprint" varchar(64) NOT NULL,
	"source_schema" varchar(32) NOT NULL,
	"result" jsonb NOT NULL,
	"runtime_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "npm_import_runs_fingerprint_check" CHECK ("rentnerproxy"."npm_import_runs"."source_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "npm_import_runs_runtime_status_check" CHECK ("rentnerproxy"."npm_import_runs"."runtime_status" in ('applied', 'pending'))
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."npm_import_runs" ADD CONSTRAINT "npm_import_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "rentnerproxy"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "npm_import_runs_created_at_idx" ON "rentnerproxy"."npm_import_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "npm_import_runs_fingerprint_idx" ON "rentnerproxy"."npm_import_runs" USING btree ("source_fingerprint");
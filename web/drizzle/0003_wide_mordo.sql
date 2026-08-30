CREATE TABLE "rentnerproxy"."passkeys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_type" varchar(32) NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkeys_counter_check" CHECK ("rentnerproxy"."passkeys"."counter" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rentnerproxy"."user_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rentnerproxy"."user_totp_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"secret_iv" "bytea" NOT NULL,
	"last_used_counter" bigint DEFAULT -1 NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_totp_factors_secret_iv_length_check" CHECK (octet_length("rentnerproxy"."user_totp_factors"."secret_iv") = 12),
	CONSTRAINT "user_totp_factors_last_used_counter_check" CHECK ("rentnerproxy"."user_totp_factors"."last_used_counter" >= -1)
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."sessions" ADD COLUMN "reauthenticated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "rentnerproxy"."sessions" SET "reauthenticated_at" = "created_at";--> statement-breakpoint
ALTER TABLE "rentnerproxy"."sessions" ALTER COLUMN "reauthenticated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "rentnerproxy"."sessions" ALTER COLUMN "reauthenticated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "rentnerproxy"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "rentnerproxy"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentnerproxy"."user_totp_factors" ADD CONSTRAINT "user_totp_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "rentnerproxy"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_id_unique_idx" ON "rentnerproxy"."passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_id_idx" ON "rentnerproxy"."passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_recovery_codes_user_id_code_hash_unique_idx" ON "rentnerproxy"."user_recovery_codes" USING btree ("user_id","code_hash");--> statement-breakpoint
CREATE INDEX "user_recovery_codes_user_id_idx" ON "rentnerproxy"."user_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_totp_factors_user_id_unique_idx" ON "rentnerproxy"."user_totp_factors" USING btree ("user_id");
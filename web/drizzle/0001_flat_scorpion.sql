CREATE TABLE "rentnerproxy"."user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme_mode" varchar(20) DEFAULT 'light' NOT NULL,
	CONSTRAINT "user_settings_theme_mode_check" CHECK ("rentnerproxy"."user_settings"."theme_mode" in ('light', 'dark'))
);
--> statement-breakpoint
ALTER TABLE "rentnerproxy"."user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "rentnerproxy"."users"("id") ON DELETE cascade ON UPDATE no action;
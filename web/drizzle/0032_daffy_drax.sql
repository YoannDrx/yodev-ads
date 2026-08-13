CREATE TABLE "yodev_mail_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "yodev_mail_events_message_idx" ON "yodev_mail_events" USING btree ("message_id","occurred_at");
--> statement-breakpoint
REVOKE ALL ON TABLE "yodev_mail_events" FROM PUBLIC, yodev_app, yodev_auth, yodev_purge;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "yodev_mail_events" TO yodev_system;

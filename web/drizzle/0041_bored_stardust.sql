CREATE TABLE "operational_leases" (
	"component" varchar(64) PRIMARY KEY NOT NULL,
	"owner" varchar(160) NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operational_leases_expiry_idx" ON "operational_leases" USING btree ("lease_expires_at");--> statement-breakpoint
REVOKE ALL ON "operational_leases" FROM PUBLIC, "yodev_app", "yodev_auth";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "operational_leases" TO "yodev_system", "yodev_purge";

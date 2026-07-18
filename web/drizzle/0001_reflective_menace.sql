CREATE TABLE "alert_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"fingerprint" varchar(128) NOT NULL,
	"severity" varchar(24) DEFAULT 'warning' NOT NULL,
	"title" varchar(220) NOT NULL,
	"description" text NOT NULL,
	"campaign_id" varchar(32),
	"campaign_name" varchar(220),
	"value" numeric(22, 4),
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_prefix" varchar(16) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"created_by" varchar(64) NOT NULL,
	"kind" varchar(48) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"threshold" numeric(14, 2) NOT NULL,
	"schedule" varchar(24) DEFAULT 'daily' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"label" varchar(160) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_prefix" varchar(12) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "brand_name" SET DEFAULT 'Vigihat';--> statement-breakpoint
UPDATE "workspaces" SET "brand_name" = 'Vigihat', "updated_at" = now() WHERE "brand_name" = 'VigieAds';--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD CONSTRAINT "alert_incidents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD CONSTRAINT "alert_incidents_agent_id_monitoring_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."monitoring_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD CONSTRAINT "alert_incidents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_agents" ADD CONSTRAINT "monitoring_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_agents" ADD CONSTRAINT "monitoring_agents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_incidents_fingerprint_idx" ON "alert_incidents" USING btree ("workspace_id","fingerprint");--> statement-breakpoint
CREATE INDEX "alert_incidents_workspace_status_idx" ON "alert_incidents" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_token_hash_idx" ON "api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "monitoring_agents_workspace_idx" ON "monitoring_agents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "monitoring_agents_enabled_idx" ON "monitoring_agents" USING btree ("workspace_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_hash_idx" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_workspace_idx" ON "share_links" USING btree ("workspace_id");

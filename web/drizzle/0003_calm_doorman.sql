CREATE TABLE "approval_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"author_user_id" varchar(64) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"label" varchar(120) NOT NULL,
	"encrypted_destination" text NOT NULL,
	"destination_hint" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"minimum_severity" varchar(24) DEFAULT 'warning' NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"incident_id" uuid,
	"event_key" varchar(180) NOT NULL,
	"status" varchar(24) NOT NULL,
	"provider_message_id" varchar(128),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"snapshot_date" varchar(10) NOT NULL,
	"currency_code" varchar(3) NOT NULL,
	"cost_micros" numeric(22, 0) DEFAULT '0' NOT NULL,
	"impressions" numeric(22, 0) DEFAULT '0' NOT NULL,
	"clicks" numeric(22, 0) DEFAULT '0' NOT NULL,
	"conversions" numeric(22, 4) DEFAULT '0' NOT NULL,
	"active_campaigns" integer DEFAULT 0 NOT NULL,
	"source_window_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan" varchar(24) DEFAULT 'solo' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "subscription_status" varchar(32) DEFAULT 'inactive' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_customer_id" varchar(64);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_subscription_id" varchar(64);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "subscription_current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "notification_email" varchar(254);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "maximum_daily_budget_micros" numeric(22, 0);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "maximum_monthly_spend_micros" numeric(22, 0);--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_incident_id_alert_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."alert_incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_comments_approval_idx" ON "approval_comments" USING btree ("workspace_id","approval_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_channels_workspace_idx" ON "notification_channels" USING btree ("workspace_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_event_channel_idx" ON "notification_deliveries" USING btree ("event_key","channel_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_workspace_idx" ON "notification_deliveries" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_snapshots_client_date_idx" ON "performance_snapshots" USING btree ("client_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "performance_snapshots_workspace_date_idx" ON "performance_snapshots" USING btree ("workspace_id","snapshot_date");
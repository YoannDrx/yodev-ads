CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"approved_by" varchar(64),
	"kind" varchar(48) NOT NULL,
	"title" varchar(220) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"idempotency_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"validation_request_id" varchar(128),
	"execution_request_id" varchar(128),
	"error_message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" varchar(64) NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(128),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"google_customer_id" varchar(10) NOT NULL,
	"name" varchar(180) NOT NULL,
	"currency_code" varchar(3) DEFAULT 'EUR' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Paris' NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_ads_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"manager_customer_id" varchar(10) NOT NULL,
	"google_email" varchar(254),
	"encrypted_refresh_token" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"connected_by" varchar(64) NOT NULL,
	"last_successful_use_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"managed_spend_micros" numeric(22, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_organization_id" varchar(64) NOT NULL,
	"owner_user_id" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"brand_name" varchar(120) DEFAULT 'VigieAds' NOT NULL,
	"brand_tagline" varchar(180) DEFAULT 'Pilotez chaque compte avec confiance.' NOT NULL,
	"accent_color" varchar(16) DEFAULT '#635BFF' NOT NULL,
	"logo_url" text,
	"approval_mode" varchar(24) DEFAULT 'single' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_ads_connections" ADD CONSTRAINT "google_ads_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_idempotency_idx" ON "approval_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "approvals_workspace_status_idx" ON "approval_requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "audit_workspace_created_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_workspace_customer_idx" ON "clients" USING btree ("workspace_id","google_customer_id");--> statement-breakpoint
CREATE INDEX "clients_workspace_idx" ON "clients" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_workspace_idx" ON "google_ads_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "connections_manager_idx" ON "google_ads_connections" USING btree ("manager_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_workspace_month_idx" ON "usage_snapshots" USING btree ("workspace_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_clerk_org_idx" ON "workspaces" USING btree ("clerk_organization_id");--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_user_id");
CREATE TABLE "approval_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"approver_user_id" varchar(64) NOT NULL,
	"decision" varchar(24) NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"primary_kpi" varchar(32) NOT NULL,
	"target_cpa_micros" numeric(22, 0),
	"target_roas" numeric(12, 4),
	"monthly_budget_micros" numeric(22, 0) NOT NULL,
	"conversion_value_micros" numeric(22, 0),
	"margin_percent" numeric(8, 2),
	"tracked_conversion_actions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_action_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"resource_name" text NOT NULL,
	"snapshot_date" varchar(10) NOT NULL,
	"name" varchar(220) NOT NULL,
	"status" varchar(24) NOT NULL,
	"category" varchar(64),
	"origin" varchar(64),
	"primary_for_goal" boolean DEFAULT false NOT NULL,
	"include_in_conversions_metric" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone,
	"enhanced_conversions_enabled" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_account_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"metric_date" varchar(10) NOT NULL,
	"currency_code" varchar(3) NOT NULL,
	"cost_micros" numeric(22, 0) DEFAULT '0' NOT NULL,
	"impressions" numeric(22, 0) DEFAULT '0' NOT NULL,
	"clicks" numeric(22, 0) DEFAULT '0' NOT NULL,
	"conversions" numeric(22, 4) DEFAULT '0' NOT NULL,
	"conversion_value_micros" numeric(22, 0) DEFAULT '0' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_campaign_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" varchar(32) NOT NULL,
	"metric_date" varchar(10) NOT NULL,
	"campaign_name" varchar(220) NOT NULL,
	"campaign_type" varchar(48),
	"status" varchar(24),
	"currency_code" varchar(3) NOT NULL,
	"cost_micros" numeric(22, 0) DEFAULT '0' NOT NULL,
	"impressions" numeric(22, 0) DEFAULT '0' NOT NULL,
	"clicks" numeric(22, 0) DEFAULT '0' NOT NULL,
	"conversions" numeric(22, 4) DEFAULT '0' NOT NULL,
	"conversion_value_micros" numeric(22, 0) DEFAULT '0' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"tombstone_hash" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"artifact_key" text,
	"artifact_hash" varchar(64),
	"expires_at" timestamp with time zone,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"change_resource_name" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"changed_by" varchar(254),
	"resource_type" varchar(64) NOT NULL,
	"operation" varchar(24) NOT NULL,
	"old_resource" jsonb,
	"new_resource" jsonb,
	"internal_audit_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"state" varchar(24) NOT NULL,
	"worker_id" varchar(128) NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"type" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"maximum_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"terms_version" varchar(32) NOT NULL,
	"privacy_version" varchar(32) NOT NULL,
	"dpa_version" varchar(32),
	"locale" varchar(8) NOT NULL,
	"context" varchar(48) NOT NULL,
	"request_fingerprint" varchar(64),
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mutation_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"state" varchar(24) DEFAULT 'claimed' NOT NULL,
	"validation_request_id" varchar(128),
	"google_request_id" varchar(128),
	"result" jsonb,
	"error_message" text,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"share_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"otp_hash" varchar(64),
	"otp_expires_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"decision" varchar(24),
	"decision_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"campaign_id" varchar(32),
	"currency_code" varchar(3) NOT NULL,
	"maximum_daily_budget_micros" numeric(22, 0),
	"maximum_monthly_spend_micros" numeric(22, 0),
	"maximum_variation_percent" numeric(8, 2),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"stripe_created_at" timestamp with time zone NOT NULL,
	"status" varchar(24) DEFAULT 'processing' NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_clerk_user_id" varchar(64) NOT NULL,
	"workspace_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"dns_token_hash" varchar(64) NOT NULL,
	"verification_status" varchar(24) DEFAULT 'pending' NOT NULL,
	"vercel_status" varchar(24) DEFAULT 'not_submitted' NOT NULL,
	"verified_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "plan" SET DEFAULT 'trial';--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "scopes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_ip_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "resource_name" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "expected_state" jsonb;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "proposed_state" jsonb;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "expected_state_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "required_approvals" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "execution_state" varchar(24) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "reconciliation_state" varchar(24) DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "terminal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "required_approvals" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "allow_self_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "access_state" varchar(32) DEFAULT 'suspended' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "locale" varchar(8) DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "country_code" varchar(2) DEFAULT 'FR' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_email" varchar(254);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "purge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "terms_version" varchar(32);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "privacy_version" varchar(32);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "mutations_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_goals" ADD CONSTRAINT "client_goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_goals" ADD CONSTRAINT "client_goals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_action_snapshots" ADD CONSTRAINT "conversion_action_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_action_snapshots" ADD CONSTRAINT "conversion_action_snapshots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_account_metrics" ADD CONSTRAINT "daily_account_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_account_metrics" ADD CONSTRAINT "daily_account_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_campaign_metrics" ADD CONSTRAINT "daily_campaign_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_campaign_metrics" ADD CONSTRAINT "daily_campaign_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_change_events" ADD CONSTRAINT "google_change_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_change_events" ADD CONSTRAINT "google_change_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_change_events" ADD CONSTRAINT "google_change_events_internal_audit_event_id_audit_events_id_fk" FOREIGN KEY ("internal_audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_executions" ADD CONSTRAINT "mutation_executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_executions" ADD CONSTRAINT "mutation_executions_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_recipients" ADD CONSTRAINT "report_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_recipients" ADD CONSTRAINT "report_recipients_share_id_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_policies" ADD CONSTRAINT "safety_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_policies" ADD CONSTRAINT "safety_policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_votes_approval_user_idx" ON "approval_votes" USING btree ("approval_id","approver_user_id");--> statement-breakpoint
CREATE INDEX "approval_votes_workspace_idx" ON "approval_votes" USING btree ("workspace_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_goals_client_idx" ON "client_goals" USING btree ("workspace_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_action_snapshots_resource_date_idx" ON "conversion_action_snapshots" USING btree ("client_id","resource_name","snapshot_date");--> statement-breakpoint
CREATE INDEX "conversion_action_snapshots_workspace_idx" ON "conversion_action_snapshots" USING btree ("workspace_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_account_metrics_client_date_idx" ON "daily_account_metrics" USING btree ("client_id","metric_date");--> statement-breakpoint
CREATE INDEX "daily_account_metrics_workspace_date_idx" ON "daily_account_metrics" USING btree ("workspace_id","metric_date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_campaign_metrics_campaign_date_idx" ON "daily_campaign_metrics" USING btree ("client_id","campaign_id","metric_date");--> statement-breakpoint
CREATE INDEX "daily_campaign_metrics_workspace_date_idx" ON "daily_campaign_metrics" USING btree ("workspace_id","metric_date");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_requests_workspace_idx" ON "deletion_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "export_jobs_workspace_idx" ON "export_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "google_change_events_resource_idx" ON "google_change_events" USING btree ("client_id","change_resource_name");--> statement-breakpoint
CREATE INDEX "google_change_events_workspace_date_idx" ON "google_change_events" USING btree ("workspace_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_attempts_job_attempt_idx" ON "job_attempts" USING btree ("job_id","attempt");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","available_at","priority");--> statement-breakpoint
CREATE INDEX "legal_acceptances_workspace_idx" ON "legal_acceptances" USING btree ("workspace_id","accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mutation_executions_approval_attempt_idx" ON "mutation_executions" USING btree ("approval_id","attempt");--> statement-breakpoint
CREATE INDEX "mutation_executions_workspace_state_idx" ON "mutation_executions" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "report_recipients_share_email_idx" ON "report_recipients" USING btree ("share_id","email");--> statement-breakpoint
CREATE INDEX "safety_policies_scope_idx" ON "safety_policies" USING btree ("workspace_id","client_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_webhook_events_event_idx" ON "stripe_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_grants_creator_idx" ON "trial_grants" USING btree ("creator_clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_grants_workspace_idx" ON "trial_grants" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_domains_hostname_idx" ON "workspace_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "workspace_domains_workspace_idx" ON "workspace_domains" USING btree ("workspace_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yodev_app') THEN
    CREATE ROLE yodev_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yodev_system') THEN
    CREATE ROLE yodev_system NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yodev_purge') THEN
    CREATE ROLE yodev_purge NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  -- The migration owner needs role membership to run staging verification and
  -- provision restricted LOGIN credentials. Runtime transactions still SET
  -- LOCAL ROLE explicitly and production URLs must use separate LOGIN users.
  EXECUTE format('GRANT yodev_app, yodev_system, yodev_purge TO %I', current_user);
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO yodev_app, yodev_system, yodev_purge;
--> statement-breakpoint
DO $$
DECLARE
  tenant_table text;
  tenant_tables text[] := ARRAY[
    'workspaces', 'google_ads_connections', 'clients', 'approval_requests', 'audit_events',
    'usage_snapshots', 'monitoring_agents', 'alert_incidents', 'share_links', 'api_keys',
    'performance_snapshots', 'notification_channels', 'notification_deliveries', 'approval_comments',
    'client_approval_feedback', 'trial_grants', 'legal_acceptances', 'approval_votes',
    'mutation_executions', 'safety_policies', 'client_goals', 'daily_account_metrics',
    'daily_campaign_metrics', 'google_change_events', 'conversion_action_snapshots', 'jobs',
    'job_attempts', 'export_jobs', 'deletion_requests', 'report_recipients', 'workspace_domains'
  ];
  tenant_expression text;
BEGIN
  FOREACH tenant_table IN ARRAY tenant_tables LOOP
    tenant_expression := CASE
      WHEN tenant_table = 'workspaces'
        THEN 'id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid'
      ELSE 'workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid'
    END;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_app ON %I TO yodev_app USING (%s) WITH CHECK (%s)',
      tenant_table,
      tenant_expression,
      tenant_expression
    );
    EXECUTE format(
      'CREATE POLICY tenant_system_access ON %I TO yodev_system USING (true) WITH CHECK (true)',
      tenant_table
    );
    EXECUTE format(
      'CREATE POLICY tenant_purge_access ON %I TO yodev_purge USING (true) WITH CHECK (true)',
      tenant_table
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO yodev_app', tenant_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO yodev_system, yodev_purge', tenant_table);
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM yodev_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE stripe_webhook_events TO yodev_system, yodev_purge;
--> statement-breakpoint
CREATE UNIQUE INDEX clients_workspace_id_id_idx ON clients (workspace_id, id);
CREATE UNIQUE INDEX approvals_workspace_id_id_idx ON approval_requests (workspace_id, id);
CREATE UNIQUE INDEX agents_workspace_id_id_idx ON monitoring_agents (workspace_id, id);
CREATE UNIQUE INDEX incidents_workspace_id_id_idx ON alert_incidents (workspace_id, id);
CREATE UNIQUE INDEX shares_workspace_id_id_idx ON share_links (workspace_id, id);
CREATE UNIQUE INDEX channels_workspace_id_id_idx ON notification_channels (workspace_id, id);
CREATE UNIQUE INDEX audit_workspace_id_id_idx ON audit_events (workspace_id, id);
CREATE UNIQUE INDEX jobs_workspace_id_id_idx ON jobs (workspace_id, id);
--> statement-breakpoint
ALTER TABLE approval_requests ADD CONSTRAINT approvals_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE monitoring_agents ADD CONSTRAINT agents_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE alert_incidents ADD CONSTRAINT incidents_workspace_agent_fk
  FOREIGN KEY (workspace_id, agent_id) REFERENCES monitoring_agents (workspace_id, id) NOT VALID;
ALTER TABLE alert_incidents ADD CONSTRAINT incidents_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE share_links ADD CONSTRAINT shares_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE performance_snapshots ADD CONSTRAINT performance_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE notification_deliveries ADD CONSTRAINT deliveries_workspace_channel_fk
  FOREIGN KEY (workspace_id, channel_id) REFERENCES notification_channels (workspace_id, id) NOT VALID;
ALTER TABLE notification_deliveries ADD CONSTRAINT deliveries_workspace_incident_fk
  FOREIGN KEY (workspace_id, incident_id) REFERENCES alert_incidents (workspace_id, id) NOT VALID;
ALTER TABLE approval_comments ADD CONSTRAINT comments_workspace_approval_fk
  FOREIGN KEY (workspace_id, approval_id) REFERENCES approval_requests (workspace_id, id) NOT VALID;
ALTER TABLE client_approval_feedback ADD CONSTRAINT feedback_workspace_share_fk
  FOREIGN KEY (workspace_id, share_id) REFERENCES share_links (workspace_id, id) NOT VALID;
ALTER TABLE client_approval_feedback ADD CONSTRAINT feedback_workspace_approval_fk
  FOREIGN KEY (workspace_id, approval_id) REFERENCES approval_requests (workspace_id, id) NOT VALID;
ALTER TABLE approval_votes ADD CONSTRAINT votes_workspace_approval_fk
  FOREIGN KEY (workspace_id, approval_id) REFERENCES approval_requests (workspace_id, id) NOT VALID;
ALTER TABLE mutation_executions ADD CONSTRAINT executions_workspace_approval_fk
  FOREIGN KEY (workspace_id, approval_id) REFERENCES approval_requests (workspace_id, id) NOT VALID;
ALTER TABLE safety_policies ADD CONSTRAINT safety_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE client_goals ADD CONSTRAINT goals_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE daily_account_metrics ADD CONSTRAINT account_metrics_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE daily_campaign_metrics ADD CONSTRAINT campaign_metrics_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE google_change_events ADD CONSTRAINT changes_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE google_change_events ADD CONSTRAINT changes_workspace_audit_fk
  FOREIGN KEY (workspace_id, internal_audit_event_id) REFERENCES audit_events (workspace_id, id) NOT VALID;
ALTER TABLE conversion_action_snapshots ADD CONSTRAINT conversions_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;
ALTER TABLE job_attempts ADD CONSTRAINT attempts_workspace_job_fk
  FOREIGN KEY (workspace_id, job_id) REFERENCES jobs (workspace_id, id) NOT VALID;
ALTER TABLE report_recipients ADD CONSTRAINT recipients_workspace_share_fk
  FOREIGN KEY (workspace_id, share_id) REFERENCES share_links (workspace_id, id) NOT VALID;
--> statement-breakpoint
CREATE UNIQUE INDEX workspaces_stripe_subscription_unique_idx
  ON workspaces (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE workspaces ADD CONSTRAINT workspaces_access_state_check CHECK (
  access_state IN ('internal', 'trial', 'active', 'grace', 'suspended', 'deletion_pending', 'deleted')
);
ALTER TABLE workspaces ADD CONSTRAINT workspaces_plan_check CHECK (
  plan IN ('trial', 'solo', 'studio', 'agency', 'internal')
);
ALTER TABLE workspaces ADD CONSTRAINT workspaces_required_approvals_check CHECK (required_approvals IN (1, 2));

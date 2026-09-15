ALTER TABLE "clients" ADD COLUMN "managed_selected" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "management_priority" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_accessible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "inventory_observed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE clients SET managed_selected = active AND NOT is_manager, google_accessible = active;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY google_customer_id, id) AS priority
  FROM clients WHERE NOT is_manager
)
UPDATE clients SET management_priority = ranked.priority FROM ranked WHERE clients.id = ranked.id;
--> statement-breakpoint
ALTER TABLE clients ADD CONSTRAINT clients_management_priority_check CHECK (management_priority >= 0);
--> statement-breakpoint
CREATE INDEX audit_google_inventory_observation_idx ON audit_events(workspace_id, entity_id, created_at DESC, id DESC)
  WHERE action IN ('google_ads.accounts_synced', 'google_ads.accounts_synced_after_plan_change');

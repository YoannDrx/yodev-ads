CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" varchar(64) NOT NULL,
	"body" text NOT NULL,
	"mentions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid,
	"created_by" varchar(64) NOT NULL,
	"title" varchar(220) NOT NULL,
	"description" text NOT NULL,
	"status" varchar(24) DEFAULT 'todo' NOT NULL,
	"priority" varchar(24) DEFAULT 'normal' NOT NULL,
	"assigned_to" varchar(64),
	"source_type" varchar(32) DEFAULT 'manual' NOT NULL,
	"source_entity_id" varchar(128),
	"due_at" timestamp with time zone,
	"sla_minutes" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_workspace_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workspace_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_tasks" ADD CONSTRAINT "workspace_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_tasks" ADD CONSTRAINT "workspace_tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("workspace_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_tasks_queue_idx" ON "workspace_tasks" USING btree ("workspace_id","status","due_at");--> statement-breakpoint
CREATE INDEX "workspace_tasks_assignee_idx" ON "workspace_tasks" USING btree ("workspace_id","assigned_to","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_tasks_source_idx" ON "workspace_tasks" USING btree ("workspace_id","source_type","source_entity_id");--> statement-breakpoint
ALTER TABLE workspace_tasks ADD CONSTRAINT workspace_tasks_status_check
  CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled'));--> statement-breakpoint
ALTER TABLE workspace_tasks ADD CONSTRAINT workspace_tasks_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));--> statement-breakpoint
ALTER TABLE workspace_tasks ADD CONSTRAINT workspace_tasks_source_type_check
  CHECK (source_type IN ('manual', 'alert', 'approval', 'report'));--> statement-breakpoint
ALTER TABLE workspace_tasks ADD CONSTRAINT workspace_tasks_sla_check
  CHECK (sla_minutes IS NULL OR sla_minutes > 0);--> statement-breakpoint
CREATE UNIQUE INDEX workspace_tasks_workspace_id_id_idx ON workspace_tasks (workspace_id, id);--> statement-breakpoint
CREATE UNIQUE INDEX task_comments_workspace_id_id_idx ON task_comments (workspace_id, id);--> statement-breakpoint
ALTER TABLE workspace_tasks ADD CONSTRAINT workspace_tasks_workspace_client_fk
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) NOT VALID;--> statement-breakpoint
ALTER TABLE task_comments ADD CONSTRAINT task_comments_workspace_task_fk
  FOREIGN KEY (workspace_id, task_id) REFERENCES workspace_tasks (workspace_id, id) NOT VALID;--> statement-breakpoint
ALTER TABLE workspace_tasks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_tasks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation_app ON workspace_tasks TO yodev_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_system_access ON workspace_tasks TO yodev_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenant_purge_access ON workspace_tasks TO yodev_purge USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_tasks TO yodev_app, yodev_system, yodev_purge;--> statement-breakpoint
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE task_comments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation_app ON task_comments TO yodev_app
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_system_access ON task_comments TO yodev_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenant_purge_access ON task_comments TO yodev_purge USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON task_comments TO yodev_app, yodev_system, yodev_purge;

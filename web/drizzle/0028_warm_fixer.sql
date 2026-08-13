ALTER TABLE "trial_grants" DROP CONSTRAINT "trial_grants_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "trial_grants" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
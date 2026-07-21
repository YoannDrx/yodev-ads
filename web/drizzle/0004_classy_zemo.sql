CREATE TABLE "client_approval_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"share_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"author_name" varchar(120) NOT NULL,
	"decision" varchar(24) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "allow_feedback" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "client_approval_feedback" ADD CONSTRAINT "client_approval_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_approval_feedback" ADD CONSTRAINT "client_approval_feedback_share_id_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_approval_feedback" ADD CONSTRAINT "client_approval_feedback_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_feedback_share_approval_idx" ON "client_approval_feedback" USING btree ("share_id","approval_id");--> statement-breakpoint
CREATE INDEX "client_feedback_workspace_idx" ON "client_approval_feedback" USING btree ("workspace_id","created_at");
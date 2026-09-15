CREATE INDEX "alert_comments_page_idx" ON "alert_comments" USING btree ("workspace_id","incident_id","created_at","id");--> statement-breakpoint
CREATE INDEX "alert_incidents_page_idx" ON "alert_incidents" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "approval_comments_page_idx" ON "approval_comments" USING btree ("workspace_id","approval_id","created_at","id");--> statement-breakpoint
CREATE INDEX "approvals_page_idx" ON "approval_requests" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_page_idx" ON "audit_events" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "support_messages_page_idx" ON "support_messages" USING btree ("workspace_id","ticket_id","created_at","id");--> statement-breakpoint
CREATE INDEX "support_tickets_page_idx" ON "support_tickets" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "support_tickets_reader_page_idx" ON "support_tickets" USING btree ("workspace_id","requested_by","created_at","id");--> statement-breakpoint
CREATE INDEX "task_comments_page_idx" ON "task_comments" USING btree ("workspace_id","task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "workspace_tasks_page_idx" ON "workspace_tasks" USING btree ("workspace_id","created_at","id");
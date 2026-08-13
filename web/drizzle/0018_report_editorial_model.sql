ALTER TABLE "share_links" ADD COLUMN "editorial_comment" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "action_plan" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "locale" varchar(8) DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "period_days" integer DEFAULT 30 NOT NULL;
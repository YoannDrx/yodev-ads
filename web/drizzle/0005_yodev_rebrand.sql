ALTER TABLE "workspaces" ALTER COLUMN "brand_name" SET DEFAULT 'Ads by Yodev';--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "accent_color" SET DEFAULT '#19A58F';--> statement-breakpoint
UPDATE "workspaces" SET "brand_name" = 'Ads by Yodev', "updated_at" = now() WHERE "brand_name" = 'Vigieads';--> statement-breakpoint
UPDATE "workspaces" SET "accent_color" = '#19A58F', "updated_at" = now() WHERE "accent_color" = '#635BFF';

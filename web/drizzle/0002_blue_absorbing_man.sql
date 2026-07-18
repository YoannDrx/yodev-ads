ALTER TABLE "workspaces" ALTER COLUMN "brand_name" SET DEFAULT 'Vigieads';--> statement-breakpoint
UPDATE "workspaces"
SET "brand_name" = 'Vigieads', "updated_at" = now()
WHERE "brand_name" IN ('Vigihat', 'VigieAds');

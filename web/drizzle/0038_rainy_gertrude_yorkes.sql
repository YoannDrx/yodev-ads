ALTER TABLE "auth_members" DROP CONSTRAINT "auth_members_role_check";--> statement-breakpoint
ALTER TABLE "auth_invitations" DROP CONSTRAINT "auth_invitations_role_check";--> statement-breakpoint
UPDATE "auth_members" SET "role" = 'strategist' WHERE "role" = 'operator';--> statement-breakpoint
UPDATE "auth_members" SET "role" = 'client' WHERE "role" = 'viewer';--> statement-breakpoint
UPDATE "auth_invitations" SET "role" = 'strategist' WHERE "role" = 'operator';--> statement-breakpoint
UPDATE "auth_invitations" SET "role" = 'client' WHERE "role" = 'viewer';--> statement-breakpoint
ALTER TABLE "auth_invitations" ALTER COLUMN "role" SET DEFAULT 'client';--> statement-breakpoint
ALTER TABLE "auth_members" ALTER COLUMN "role" SET DEFAULT 'client';--> statement-breakpoint
ALTER TABLE "auth_members" ADD CONSTRAINT "auth_members_role_check"
  CHECK ("role" IN ('owner', 'admin', 'strategist', 'analyst', 'client'));--> statement-breakpoint
ALTER TABLE "auth_invitations" ADD CONSTRAINT "auth_invitations_role_check"
  CHECK ("role" IN ('admin', 'strategist', 'analyst', 'client'));

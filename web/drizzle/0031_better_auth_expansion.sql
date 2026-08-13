DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yodev_auth') THEN
    CREATE ROLE yodev_auth NOLOGIN NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT yodev_auth TO %I', current_user);
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO yodev_auth;
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" varchar(32) DEFAULT 'viewer' NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(32) DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(140) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"logo" text,
	"metadata" text,
	"legacy_clerk_organization_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" varchar(32) NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" varchar(32) DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"legacy_clerk_user_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_notification_preferences" RENAME COLUMN "clerk_user_id" TO "auth_user_id";--> statement-breakpoint
DROP INDEX "member_preferences_workspace_user_idx";--> statement-breakpoint
ALTER TABLE "trial_grants" ALTER COLUMN "creator_clerk_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "clerk_organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_grants" ADD COLUMN "creator_auth_user_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "auth_organization_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "auth_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_invitations" ADD CONSTRAINT "auth_invitations_organization_id_auth_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."auth_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_invitations" ADD CONSTRAINT "auth_invitations_inviter_id_auth_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_members" ADD CONSTRAINT "auth_members_organization_id_auth_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."auth_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_members" ADD CONSTRAINT "auth_members_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_passkeys" ADD CONSTRAINT "auth_passkeys_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_active_organization_id_auth_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."auth_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_idx" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_invitations_organization_idx" ON "auth_invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auth_invitations_email_status_idx" ON "auth_invitations" USING btree ("email","status");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_members_organization_user_idx" ON "auth_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "auth_members_user_idx" ON "auth_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_organizations_slug_idx" ON "auth_organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_organizations_legacy_clerk_idx" ON "auth_organizations" USING btree ("legacy_clerk_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_passkeys_credential_idx" ON "auth_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "auth_passkeys_user_idx" ON "auth_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_idx" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiration_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_idx" ON "auth_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_legacy_clerk_idx" ON "auth_users" USING btree ("legacy_clerk_user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_creator_auth_user_id_auth_users_id_fk" FOREIGN KEY ("creator_auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_auth_organization_id_auth_organizations_id_fk" FOREIGN KEY ("auth_organization_id") REFERENCES "public"."auth_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_auth_owner_user_id_auth_users_id_fk" FOREIGN KEY ("auth_owner_user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_grants_auth_creator_idx" ON "trial_grants" USING btree ("creator_auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_auth_org_idx" ON "workspaces" USING btree ("auth_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_preferences_workspace_user_idx" ON "member_notification_preferences" USING btree ("workspace_id","auth_user_id");
--> statement-breakpoint
ALTER TABLE "auth_members" ADD CONSTRAINT "auth_members_role_check"
  CHECK ("role" IN ('owner', 'admin', 'operator', 'analyst', 'viewer'));
--> statement-breakpoint
ALTER TABLE "auth_invitations" ADD CONSTRAINT "auth_invitations_role_check"
  CHECK ("role" IN ('admin', 'operator', 'analyst', 'viewer'));
--> statement-breakpoint
ALTER TABLE "auth_invitations" ADD CONSTRAINT "auth_invitations_status_check"
  CHECK ("status" IN ('pending', 'accepted', 'rejected', 'canceled'));
--> statement-breakpoint
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_identity_check"
  CHECK ("creator_auth_user_id" IS NOT NULL OR "creator_clerk_user_id" IS NOT NULL);
--> statement-breakpoint
REVOKE ALL ON TABLE
  "auth_accounts", "auth_invitations", "auth_members", "auth_organizations",
  "auth_passkeys", "auth_rate_limits", "auth_sessions", "auth_users", "auth_verifications"
  FROM PUBLIC, yodev_app, yodev_purge;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "auth_accounts", "auth_invitations", "auth_members", "auth_organizations",
  "auth_passkeys", "auth_rate_limits", "auth_sessions", "auth_users", "auth_verifications"
  TO yodev_auth;
--> statement-breakpoint
GRANT SELECT ON TABLE "auth_users" TO yodev_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "auth_invitations", "auth_members", "auth_organizations", "auth_sessions"
  TO yodev_system;
GRANT DELETE ON TABLE "auth_organizations" TO yodev_purge;
--> statement-breakpoint
GRANT SELECT ("auth_organization_id", "plan") ON TABLE "workspaces" TO yodev_auth;

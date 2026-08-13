import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}

// Better Auth owns authentication, sessions and organization memberships. These
// tables are global identity data and are intentionally not tenant-RLS tables;
// migration 0031 grants them only to the dedicated yodev_auth role plus the
// narrowly-scoped system/purge roles used by application services.
export const authUsers = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    role: varchar('role', { length: 32 }).default('user').notNull(),
    banned: boolean('banned').default(false).notNull(),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    legacyClerkUserId: varchar('legacy_clerk_user_id', { length: 128 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('auth_users_email_idx').on(table.email),
    uniqueIndex('auth_users_legacy_clerk_idx').on(table.legacyClerkUserId),
  ],
)

export const authOrganizations = pgTable(
  'auth_organizations',
  {
    id: text('id').primaryKey(),
    name: varchar('name', { length: 140 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(),
    logo: text('logo'),
    metadata: text('metadata'),
    legacyClerkOrganizationId: varchar('legacy_clerk_organization_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_organizations_slug_idx').on(table.slug),
    uniqueIndex('auth_organizations_legacy_clerk_idx').on(table.legacyClerkOrganizationId),
  ],
)

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'cascade' }).notNull(),
    activeOrganizationId: text('active_organization_id').references(() => authOrganizations.id, { onDelete: 'set null' }),
    impersonatedBy: text('impersonated_by'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('auth_sessions_token_idx').on(table.token),
    index('auth_sessions_user_idx').on(table.userId),
    index('auth_sessions_expiration_idx').on(table.expiresAt),
  ],
)

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: varchar('provider_id', { length: 64 }).notNull(),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'cascade' }).notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('auth_accounts_provider_account_idx').on(table.providerId, table.accountId),
    index('auth_accounts_user_idx').on(table.userId),
  ],
)

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('auth_verifications_identifier_idx').on(table.identifier)],
)

export const authMembers = pgTable(
  'auth_members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => authOrganizations.id, { onDelete: 'cascade' }).notNull(),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'cascade' }).notNull(),
    role: varchar('role', { length: 32 }).default('viewer').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('auth_members_organization_user_idx').on(table.organizationId, table.userId),
    index('auth_members_user_idx').on(table.userId),
  ],
)

export const authInvitations = pgTable(
  'auth_invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => authOrganizations.id, { onDelete: 'cascade' }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    role: varchar('role', { length: 32 }).default('viewer').notNull(),
    status: varchar('status', { length: 32 }).default('pending').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    inviterId: text('inviter_id').references(() => authUsers.id, { onDelete: 'cascade' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('auth_invitations_organization_idx').on(table.organizationId),
    index('auth_invitations_email_status_idx').on(table.email, table.status),
  ],
)

export const authPasskeys = pgTable(
  'auth_passkeys',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'cascade' }).notNull(),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').default(0).notNull(),
    deviceType: varchar('device_type', { length: 32 }).notNull(),
    backedUp: boolean('backed_up').default(false).notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    aaguid: text('aaguid'),
  },
  (table) => [
    uniqueIndex('auth_passkeys_credential_idx').on(table.credentialID),
    index('auth_passkeys_user_idx').on(table.userId),
  ],
)

export const authRateLimits = pgTable('auth_rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').default(0).notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkOrganizationId: varchar('clerk_organization_id', { length: 64 }),
    authOrganizationId: text('auth_organization_id').references(() => authOrganizations.id, { onDelete: 'set null' }),
    authOwnerUserId: text('auth_owner_user_id').references(() => authUsers.id, { onDelete: 'restrict' }),
    ownerUserId: varchar('owner_user_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(),
    brandName: varchar('brand_name', { length: 120 }).default('Ads by Yodev').notNull(),
    brandTagline: varchar('brand_tagline', { length: 180 }).default('Pilotez chaque compte avec confiance.').notNull(),
    accentColor: varchar('accent_color', { length: 16 }).default('#19A58F').notNull(),
    logoUrl: text('logo_url'),
    approvalMode: varchar('approval_mode', { length: 24 }).default('single').notNull(),
    requiredApprovals: integer('required_approvals').default(1).notNull(),
    allowSelfApproval: boolean('allow_self_approval').default(false).notNull(),
    plan: varchar('plan', { length: 24 }).default('trial').notNull(),
    accessState: varchar('access_state', { length: 32 }).default('suspended').notNull(),
    trialStartedAt: timestamp('trial_started_at', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
    locale: varchar('locale', { length: 8 }).default('fr').notNull(),
    timezone: varchar('timezone', { length: 64 }).default('Europe/Paris').notNull(),
    countryCode: varchar('country_code', { length: 2 }).default('FR').notNull(),
    billingEmail: varchar('billing_email', { length: 254 }),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    purgeAt: timestamp('purge_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    termsVersion: varchar('terms_version', { length: 32 }),
    privacyVersion: varchar('privacy_version', { length: 32 }),
    mutationsEnabled: boolean('mutations_enabled').default(false).notNull(),
    subscriptionStatus: varchar('subscription_status', { length: 32 }).default('inactive').notNull(),
    stripeCustomerId: varchar('stripe_customer_id', { length: 64 }),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 64 }),
    checkoutAttemptId: uuid('checkout_attempt_id'),
    checkoutReservedAt: timestamp('checkout_reserved_at', { withTimezone: true }),
    subscriptionCurrentPeriodEnd: timestamp('subscription_current_period_end', { withTimezone: true }),
    stripeStateAppliedAt: timestamp('stripe_state_applied_at', { withTimezone: true }),
    notificationEmail: varchar('notification_email', { length: 254 }),
    maximumDailyBudgetMicros: numeric('maximum_daily_budget_micros', { precision: 22, scale: 0 }),
    maximumMonthlySpendMicros: numeric('maximum_monthly_spend_micros', { precision: 22, scale: 0 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workspaces_clerk_org_idx').on(table.clerkOrganizationId),
    uniqueIndex('workspaces_auth_org_idx').on(table.authOrganizationId),
    index('workspaces_owner_idx').on(table.ownerUserId),
  ],
)

export const googleAdsConnections = pgTable(
  'google_ads_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    managerCustomerId: varchar('manager_customer_id', { length: 10 }).notNull(),
    googleEmail: varchar('google_email', { length: 254 }),
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    scopes: text('scopes').array().default([]).notNull(),
    status: varchar('status', { length: 24 }).default('active').notNull(),
    connectedBy: varchar('connected_by', { length: 64 }).notNull(),
    lastSuccessfulUseAt: timestamp('last_successful_use_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('connections_workspace_idx').on(table.workspaceId),
    index('connections_manager_idx').on(table.managerCustomerId),
  ],
)

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    googleCustomerId: varchar('google_customer_id', { length: 10 }).notNull(),
    name: varchar('name', { length: 180 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).default('EUR').notNull(),
    timezone: varchar('timezone', { length: 64 }).default('Europe/Paris').notNull(),
    isManager: boolean('is_manager').default(false).notNull(),
    active: boolean('active').default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('clients_workspace_customer_idx').on(table.workspaceId, table.googleCustomerId),
    index('clients_workspace_idx').on(table.workspaceId),
  ],
)

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    requestedBy: varchar('requested_by', { length: 64 }).notNull(),
    approvedBy: varchar('approved_by', { length: 64 }),
    kind: varchar('kind', { length: 48 }).notNull(),
    title: varchar('title', { length: 220 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    resourceName: text('resource_name'),
    expectedState: jsonb('expected_state').$type<Record<string, unknown>>(),
    proposedState: jsonb('proposed_state').$type<Record<string, unknown>>(),
    impactPreview: jsonb('impact_preview').$type<import('../lib/mutation-impact').MutationImpactPreview>(),
    observationWindowDays: integer('observation_window_days').default(7).notNull(),
    expectedStateHash: varchar('expected_state_hash', { length: 64 }),
    requiredApprovals: integer('required_approvals').default(1).notNull(),
    executionState: varchar('execution_state', { length: 24 }).default('pending').notNull(),
    reconciliationState: varchar('reconciliation_state', { length: 24 }).default('not_required').notNull(),
    status: varchar('status', { length: 24 }).default('pending').notNull(),
    idempotencyKey: uuid('idempotency_key').defaultRandom().notNull(),
    validationRequestId: varchar('validation_request_id', { length: 128 }),
    executionRequestId: varchar('execution_request_id', { length: 128 }),
    errorMessage: text('error_message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('approvals_idempotency_idx').on(table.idempotencyKey),
    index('approvals_workspace_status_idx').on(table.workspaceId, table.status),
  ],
)

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    actorUserId: varchar('actor_user_id', { length: 64 }).notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 128 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('audit_workspace_created_idx').on(table.workspaceId, table.createdAt)],
)

export const usageSnapshots = pgTable(
  'usage_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    month: varchar('month', { length: 7 }).notNull(),
    apiCalls: integer('api_calls').default(0).notNull(),
    managedSpendMicros: numeric('managed_spend_micros', { precision: 22, scale: 0 }).default('0').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('usage_workspace_month_idx').on(table.workspaceId, table.month)],
)

export const monitoringAgents = pgTable(
  'monitoring_agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 48 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description').notNull(),
    threshold: numeric('threshold', { precision: 14, scale: 2 }).notNull(),
    schedule: varchar('schedule', { length: 24 }).default('daily').notNull(),
    reminderIntervalHours: integer('reminder_interval_hours'),
    enabled: boolean('enabled').default(true).notNull(),
    approvalRequired: boolean('approval_required').default(true).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('monitoring_agents_workspace_idx').on(table.workspaceId),
    index('monitoring_agents_enabled_idx').on(table.workspaceId, table.enabled),
  ],
)

export const alertIncidents = pgTable(
  'alert_incidents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: uuid('agent_id')
      .references(() => monitoringAgents.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
    severity: varchar('severity', { length: 24 }).default('warning').notNull(),
    title: varchar('title', { length: 220 }).notNull(),
    description: text('description').notNull(),
    campaignId: varchar('campaign_id', { length: 32 }),
    campaignName: varchar('campaign_name', { length: 220 }),
    value: numeric('value', { precision: 22, scale: 4 }),
    status: varchar('status', { length: 24 }).default('open').notNull(),
    assignedTo: varchar('assigned_to', { length: 64 }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    occurrenceCount: integer('occurrence_count').default(1).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('alert_incidents_fingerprint_idx').on(table.workspaceId, table.fingerprint),
    index('alert_incidents_workspace_status_idx').on(table.workspaceId, table.status),
  ],
)

export const alertComments = pgTable(
  'alert_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    incidentId: uuid('incident_id').references(() => alertIncidents.id, { onDelete: 'cascade' }).notNull(),
    authorUserId: varchar('author_user_id', { length: 64 }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('alert_comments_incident_idx').on(table.workspaceId, table.incidentId, table.createdAt)],
)

export const workspaceTasks = pgTable(
  'workspace_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    title: varchar('title', { length: 220 }).notNull(),
    description: text('description').notNull(),
    status: varchar('status', { length: 24 }).default('todo').notNull(),
    priority: varchar('priority', { length: 24 }).default('normal').notNull(),
    assignedTo: varchar('assigned_to', { length: 64 }),
    sourceType: varchar('source_type', { length: 32 }).default('manual').notNull(),
    sourceEntityId: varchar('source_entity_id', { length: 128 }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    slaMinutes: integer('sla_minutes'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('workspace_tasks_queue_idx').on(table.workspaceId, table.status, table.dueAt),
    index('workspace_tasks_assignee_idx').on(table.workspaceId, table.assignedTo, table.status),
    uniqueIndex('workspace_tasks_source_idx').on(table.workspaceId, table.sourceType, table.sourceEntityId),
  ],
)

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    taskId: uuid('task_id').references(() => workspaceTasks.id, { onDelete: 'cascade' }).notNull(),
    authorUserId: varchar('author_user_id', { length: 64 }).notNull(),
    body: text('body').notNull(),
    mentions: text('mentions').array().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('task_comments_task_idx').on(table.workspaceId, table.taskId, table.createdAt)],
)

export const memberNotificationPreferences = pgTable(
  'member_notification_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    authUserId: text('auth_user_id').notNull(),
    mentionHandle: varchar('mention_handle', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    encryptedEmail: text('encrypted_email').notNull(),
    mentionNotifications: boolean('mention_notifications').default(true).notNull(),
    digestCadence: varchar('digest_cadence', { length: 16 }).default('none').notNull(),
    digestHour: integer('digest_hour').default(8).notNull(),
    timezone: varchar('timezone', { length: 64 }).default('Europe/Paris').notNull(),
    lastDigestKey: varchar('last_digest_key', { length: 32 }),
    lastDigestAt: timestamp('last_digest_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('member_preferences_workspace_user_idx').on(table.workspaceId, table.authUserId),
    uniqueIndex('member_preferences_workspace_handle_idx').on(table.workspaceId, table.mentionHandle),
    index('member_preferences_digest_idx').on(table.digestCadence, table.digestHour),
  ],
)

export const activationMilestones = pgTable(
  'activation_milestones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    milestone: varchar('milestone', { length: 48 }).notNull(),
    actorUserId: varchar('actor_user_id', { length: 64 }).notNull(),
    sourceEntityId: varchar('source_entity_id', { length: 128 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('activation_milestones_workspace_milestone_idx').on(table.workspaceId, table.milestone),
    index('activation_milestones_occurred_idx').on(table.occurredAt),
  ],
)

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    requestedBy: varchar('requested_by', { length: 64 }).notNull(),
    subject: varchar('subject', { length: 220 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    priority: varchar('priority', { length: 24 }).default('normal').notNull(),
    status: varchar('status', { length: 24 }).default('open').notNull(),
    assignedTo: varchar('assigned_to', { length: 64 }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('support_tickets_workspace_status_idx').on(table.workspaceId, table.status, table.lastMessageAt),
    index('support_tickets_status_priority_idx').on(table.status, table.priority, table.lastMessageAt),
  ],
)

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    ticketId: uuid('ticket_id').references(() => supportTickets.id, { onDelete: 'cascade' }).notNull(),
    authorUserId: varchar('author_user_id', { length: 64 }).notNull(),
    authorKind: varchar('author_kind', { length: 24 }).notNull(),
    body: text('body').notNull(),
    internal: boolean('internal').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('support_messages_ticket_idx').on(table.workspaceId, table.ticketId, table.createdAt)],
)

export const platformIncidents = pgTable(
  'platform_incidents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    titleFr: varchar('title_fr', { length: 220 }).notNull(),
    titleEn: varchar('title_en', { length: 220 }).notNull(),
    component: varchar('component', { length: 32 }).notNull(),
    impact: varchar('impact', { length: 24 }).notNull(),
    status: varchar('status', { length: 24 }).default('investigating').notNull(),
    public: boolean('public').default(true).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('platform_incidents_public_date_idx').on(table.public, table.startedAt)],
)

export const platformIncidentUpdates = pgTable(
  'platform_incident_updates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    incidentId: uuid('incident_id').references(() => platformIncidents.id, { onDelete: 'cascade' }).notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    messageFr: text('message_fr').notNull(),
    messageEn: text('message_en').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('platform_incident_updates_incident_idx').on(table.incidentId, table.createdAt)],
)

export const subprocessorChangeNotices = pgTable(
  'subprocessor_change_notices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    vendorName: varchar('vendor_name', { length: 160 }).notNull(),
    changeType: varchar('change_type', { length: 24 }).notNull(),
    summaryFr: text('summary_fr').notNull(),
    summaryEn: text('summary_en').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 24 }).default('scheduled').notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('subprocessor_change_notices_due_idx').on(table.status, table.createdAt)],
)

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    label: varchar('label', { length: 160 }).notNull(),
    editorialComment: text('editorial_comment'),
    actionPlan: text('action_plan'),
    locale: varchar('locale', { length: 8 }).default('fr').notNull(),
    periodDays: integer('period_days').default(30).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    tokenPrefix: varchar('token_prefix', { length: 12 }).notNull(),
    active: boolean('active').default(true).notNull(),
    allowFeedback: boolean('allow_feedback').default(true).notNull(),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('share_links_token_hash_idx').on(table.tokenHash),
    index('share_links_workspace_idx').on(table.workspaceId),
  ],
)

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    tokenPrefix: varchar('token_prefix', { length: 16 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    scopes: text('scopes').array().default([]).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastIpHash: varchar('last_ip_hash', { length: 64 }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('api_keys_token_hash_idx').on(table.tokenHash),
    index('api_keys_workspace_idx').on(table.workspaceId),
  ],
)

export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('rate_limit_bucket_unique_idx').on(table.keyHash, table.windowStart),
    index('rate_limit_expiry_idx').on(table.expiresAt),
  ],
)

export const secretRevelations = pgTable(
  'secret_revelations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    encryptedSecret: text('encrypted_secret').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revealedAt: timestamp('revealed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('secret_revelations_lookup_idx').on(table.workspaceId, table.userId, table.expiresAt)],
)

export const performanceSnapshots = pgTable(
  'performance_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    snapshotDate: varchar('snapshot_date', { length: 10 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    costMicros: numeric('cost_micros', { precision: 22, scale: 0 }).default('0').notNull(),
    impressions: numeric('impressions', { precision: 22, scale: 0 }).default('0').notNull(),
    clicks: numeric('clicks', { precision: 22, scale: 0 }).default('0').notNull(),
    conversions: numeric('conversions', { precision: 22, scale: 4 }).default('0').notNull(),
    activeCampaigns: integer('active_campaigns').default(0).notNull(),
    sourceWindowDays: integer('source_window_days').default(30).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('performance_snapshots_client_date_idx').on(table.clientId, table.snapshotDate),
    index('performance_snapshots_workspace_date_idx').on(table.workspaceId, table.snapshotDate),
  ],
)

export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 24 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    encryptedDestination: text('encrypted_destination').notNull(),
    destinationHint: varchar('destination_hint', { length: 120 }).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    minimumSeverity: varchar('minimum_severity', { length: 24 }).default('warning').notNull(),
    lastDeliveredAt: timestamp('last_delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [index('notification_channels_workspace_idx').on(table.workspaceId, table.enabled)],
)

export const notificationOAuthSessions = pgTable(
  'notification_oauth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 24 }).notNull(),
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    scopes: text('scopes').array().default([]).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('notification_oauth_sessions_workspace_user_idx').on(table.workspaceId, table.userId, table.provider),
    index('notification_oauth_sessions_expiry_idx').on(table.expiresAt),
  ],
)

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    channelId: uuid('channel_id')
      .references(() => notificationChannels.id, { onDelete: 'cascade' })
      .notNull(),
    incidentId: uuid('incident_id').references(() => alertIncidents.id, { onDelete: 'set null' }),
    eventKey: varchar('event_key', { length: 180 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 128 }),
    errorMessage: text('error_message'),
    attemptCount: integer('attempt_count').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('notification_deliveries_event_channel_idx').on(table.eventKey, table.channelId),
    index('notification_deliveries_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
)

export const approvalComments = pgTable(
  'approval_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    approvalId: uuid('approval_id')
      .references(() => approvalRequests.id, { onDelete: 'cascade' })
      .notNull(),
    authorUserId: varchar('author_user_id', { length: 64 }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('approval_comments_approval_idx').on(table.workspaceId, table.approvalId, table.createdAt)],
)

export const clientApprovalFeedback = pgTable(
  'client_approval_feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    shareId: uuid('share_id')
      .references(() => shareLinks.id, { onDelete: 'cascade' })
      .notNull(),
    approvalId: uuid('approval_id')
      .references(() => approvalRequests.id, { onDelete: 'cascade' })
      .notNull(),
    authorName: varchar('author_name', { length: 120 }).notNull(),
    decision: varchar('decision', { length: 24 }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('client_feedback_share_approval_idx').on(table.shareId, table.approvalId),
    index('client_feedback_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
)

export const trialGrants = pgTable(
  'trial_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    creatorClerkUserId: varchar('creator_clerk_user_id', { length: 64 }),
    creatorAuthUserId: text('creator_auth_user_id').references(() => authUsers.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('trial_grants_creator_idx').on(table.creatorClerkUserId),
    uniqueIndex('trial_grants_auth_creator_idx').on(table.creatorAuthUserId),
    uniqueIndex('trial_grants_workspace_idx').on(table.workspaceId),
  ],
)

export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: varchar('event_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 24 }).default('processing').notNull(),
    errorMessage: text('error_message'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('stripe_webhook_events_event_idx').on(table.eventId)],
)

export const yodevMailEvents = pgTable(
  'yodev_mail_events',
  {
    eventId: uuid('event_id').primaryKey(),
    messageId: uuid('message_id').notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('yodev_mail_events_message_idx').on(table.messageId, table.occurredAt)],
)

export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    termsVersion: varchar('terms_version', { length: 32 }).notNull(),
    privacyVersion: varchar('privacy_version', { length: 32 }).notNull(),
    dpaVersion: varchar('dpa_version', { length: 32 }),
    locale: varchar('locale', { length: 8 }).notNull(),
    context: varchar('context', { length: 48 }).notNull(),
    requestFingerprint: varchar('request_fingerprint', { length: 64 }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('legal_acceptances_workspace_idx').on(table.workspaceId, table.acceptedAt)],
)

export const approvalVotes = pgTable(
  'approval_votes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    approvalId: uuid('approval_id')
      .references(() => approvalRequests.id, { onDelete: 'cascade' })
      .notNull(),
    approverUserId: varchar('approver_user_id', { length: 64 }).notNull(),
    decision: varchar('decision', { length: 24 }).notNull(),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('approval_votes_approval_user_idx').on(table.approvalId, table.approverUserId),
    index('approval_votes_workspace_idx').on(table.workspaceId, table.decidedAt),
  ],
)

export const mutationExecutions = pgTable(
  'mutation_executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    approvalId: uuid('approval_id')
      .references(() => approvalRequests.id, { onDelete: 'cascade' })
      .notNull(),
    attempt: integer('attempt').default(1).notNull(),
    state: varchar('state', { length: 24 }).default('claimed').notNull(),
    validationRequestId: varchar('validation_request_id', { length: 128 }),
    googleRequestId: varchar('google_request_id', { length: 128 }),
    result: jsonb('result').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('mutation_executions_approval_attempt_idx').on(table.approvalId, table.attempt),
    index('mutation_executions_workspace_state_idx').on(table.workspaceId, table.state),
  ],
)

export const mutationObservations = pgTable(
  'mutation_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    approvalId: uuid('approval_id').references(() => approvalRequests.id, { onDelete: 'cascade' }).notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
    status: varchar('status', { length: 24 }).default('scheduled').notNull(),
    windowDays: integer('window_days').default(7).notNull(),
    campaignIds: text('campaign_ids').array().default([]).notNull(),
    baselineFrom: varchar('baseline_from', { length: 10 }).notNull(),
    baselineThrough: varchar('baseline_through', { length: 10 }).notNull(),
    observationFrom: varchar('observation_from', { length: 10 }).notNull(),
    observationThrough: varchar('observation_through', { length: 10 }).notNull(),
    baselineMetrics: jsonb('baseline_metrics').$type<import('../lib/mutation-observation').MutationObservationMetrics>().notNull(),
    observedMetrics: jsonb('observed_metrics').$type<import('../lib/mutation-observation').MutationObservationMetrics>(),
    outcome: jsonb('outcome').$type<Record<string, unknown>>(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('mutation_observations_approval_idx').on(table.approvalId),
    index('mutation_observations_workspace_status_idx').on(table.workspaceId, table.status),
  ],
)

export const safetyPolicies = pgTable(
  'safety_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: varchar('campaign_id', { length: 32 }),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    maximumDailyBudgetMicros: numeric('maximum_daily_budget_micros', { precision: 22, scale: 0 }),
    maximumMonthlySpendMicros: numeric('maximum_monthly_spend_micros', { precision: 22, scale: 0 }),
    maximumVariationPercent: numeric('maximum_variation_percent', { precision: 8, scale: 2 }),
    enabled: boolean('enabled').default(true).notNull(),
    ...timestamps,
  },
  (table) => [index('safety_policies_scope_idx').on(table.workspaceId, table.clientId, table.campaignId)],
)

export const clientGoals = pgTable(
  'client_goals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    primaryKpi: varchar('primary_kpi', { length: 32 }).notNull(),
    targetCpaMicros: numeric('target_cpa_micros', { precision: 22, scale: 0 }),
    targetRoas: numeric('target_roas', { precision: 12, scale: 4 }),
    targetConversions: numeric('target_conversions', { precision: 22, scale: 4 }),
    targetConversionValueMicros: numeric('target_conversion_value_micros', { precision: 22, scale: 0 }),
    monthlyBudgetMicros: numeric('monthly_budget_micros', { precision: 22, scale: 0 }).notNull(),
    conversionValueMicros: numeric('conversion_value_micros', { precision: 22, scale: 0 }),
    marginPercent: numeric('margin_percent', { precision: 8, scale: 2 }),
    trackedConversionActions: text('tracked_conversion_actions').array().default([]).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('client_goals_client_idx').on(table.workspaceId, table.clientId)],
)

export const dailyAccountMetrics = pgTable(
  'daily_account_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    metricDate: varchar('metric_date', { length: 10 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    costMicros: numeric('cost_micros', { precision: 22, scale: 0 }).default('0').notNull(),
    impressions: numeric('impressions', { precision: 22, scale: 0 }).default('0').notNull(),
    clicks: numeric('clicks', { precision: 22, scale: 0 }).default('0').notNull(),
    conversions: numeric('conversions', { precision: 22, scale: 4 }).default('0').notNull(),
    conversionValueMicros: numeric('conversion_value_micros', { precision: 22, scale: 0 }).default('0').notNull(),
    collectedAt: timestamp('collected_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('daily_account_metrics_client_date_idx').on(table.clientId, table.metricDate),
    index('daily_account_metrics_workspace_date_idx').on(table.workspaceId, table.metricDate),
  ],
)

export const dailyCampaignMetrics = pgTable(
  'daily_campaign_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    campaignId: varchar('campaign_id', { length: 32 }).notNull(),
    metricDate: varchar('metric_date', { length: 10 }).notNull(),
    campaignName: varchar('campaign_name', { length: 220 }).notNull(),
    campaignType: varchar('campaign_type', { length: 48 }),
    status: varchar('status', { length: 24 }),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    costMicros: numeric('cost_micros', { precision: 22, scale: 0 }).default('0').notNull(),
    impressions: numeric('impressions', { precision: 22, scale: 0 }).default('0').notNull(),
    clicks: numeric('clicks', { precision: 22, scale: 0 }).default('0').notNull(),
    conversions: numeric('conversions', { precision: 22, scale: 4 }).default('0').notNull(),
    conversionValueMicros: numeric('conversion_value_micros', { precision: 22, scale: 0 }).default('0').notNull(),
    collectedAt: timestamp('collected_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('daily_campaign_metrics_campaign_date_idx').on(table.clientId, table.campaignId, table.metricDate),
    index('daily_campaign_metrics_workspace_date_idx').on(table.workspaceId, table.metricDate),
  ],
)

export const googleChangeEvents = pgTable(
  'google_change_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    // Stable change_event resource name (timestamp/command/mutate indexes).
    changeResourceName: text('change_resource_name').notNull(),
    changedResourceName: text('changed_resource_name'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
    changedBy: varchar('changed_by', { length: 254 }),
    clientType: varchar('client_type', { length: 64 }),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    operation: varchar('operation', { length: 24 }).notNull(),
    changedFields: text('changed_fields').array().default([]).notNull(),
    oldResource: jsonb('old_resource').$type<Record<string, unknown>>(),
    newResource: jsonb('new_resource').$type<Record<string, unknown>>(),
    internalAuditEventId: uuid('internal_audit_event_id').references(() => auditEvents.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('google_change_events_resource_idx').on(table.clientId, table.changeResourceName),
    index('google_change_events_workspace_date_idx').on(table.workspaceId, table.changedAt),
  ],
)

export const conversionActionSnapshots = pgTable(
  'conversion_action_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    resourceName: text('resource_name').notNull(),
    snapshotDate: varchar('snapshot_date', { length: 10 }).notNull(),
    name: varchar('name', { length: 220 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    category: varchar('category', { length: 64 }),
    origin: varchar('origin', { length: 64 }),
    actionType: varchar('action_type', { length: 96 }),
    primaryForGoal: boolean('primary_for_goal').default(false).notNull(),
    includeInConversionsMetric: boolean('include_in_conversions_metric').default(false).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    lastConversionAt: timestamp('last_conversion_at', { withTimezone: true }),
    lastReceivedAt: timestamp('last_received_at', { withTimezone: true }),
    enhancedConversionsEnabled: boolean('enhanced_conversions_enabled'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('conversion_action_snapshots_resource_date_idx').on(table.clientId, table.resourceName, table.snapshotDate),
    index('conversion_action_snapshots_workspace_idx').on(table.workspaceId, table.snapshotDate),
  ],
)

export const offlineConversionDiagnostics = pgTable(
  'offline_conversion_diagnostics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
    snapshotDate: varchar('snapshot_date', { length: 10 }).notNull(),
    uploadClient: varchar('upload_client', { length: 64 }).notNull(),
    status: varchar('status', { length: 48 }).notNull(),
    lastUploadAt: timestamp('last_upload_at', { withTimezone: true }),
    totalEventCount: numeric('total_event_count', { precision: 22, scale: 0 }).default('0').notNull(),
    successfulEventCount: numeric('successful_event_count', { precision: 22, scale: 0 }).default('0').notNull(),
    pendingEventCount: numeric('pending_event_count', { precision: 22, scale: 0 }).default('0').notNull(),
    successRate: numeric('success_rate', { precision: 8, scale: 6 }),
    alerts: jsonb('alerts').$type<Array<Record<string, unknown>>>().default([]).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('offline_conversion_diagnostics_client_date_idx').on(table.clientId, table.uploadClient, table.snapshotDate),
    index('offline_conversion_diagnostics_workspace_idx').on(table.workspaceId, table.snapshotDate),
  ],
)

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 }).notNull(),
    deduplicationKey: varchar('deduplication_key', { length: 240 }),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
    priority: integer('priority').default(100).notNull(),
    status: varchar('status', { length: 24 }).default('queued').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    leaseOwner: varchar('lease_owner', { length: 128 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').default(0).notNull(),
    maximumAttempts: integer('maximum_attempts').default(5).notNull(),
    lastError: text('last_error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('jobs_claim_idx').on(table.status, table.availableAt, table.priority),
    uniqueIndex('jobs_deduplication_idx').on(table.deduplicationKey),
  ],
)

export const jobAttempts = pgTable(
  'job_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .references(() => jobs.id, { onDelete: 'cascade' })
      .notNull(),
    attempt: integer('attempt').notNull(),
    state: varchar('state', { length: 24 }).notNull(),
    workerId: varchar('worker_id', { length: 128 }).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 128 }),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('job_attempts_job_attempt_idx').on(table.jobId, table.attempt)],
)

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    requestedBy: varchar('requested_by', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).default('queued').notNull(),
    progress: integer('progress').default(0).notNull(),
    artifactKey: text('artifact_key'),
    artifactHash: varchar('artifact_hash', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('export_jobs_workspace_idx').on(table.workspaceId, table.createdAt)],
)

export const deletionRequests = pgTable(
  'deletion_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    requestedBy: varchar('requested_by', { length: 64 }).notNull(),
    previousAccessState: varchar('previous_access_state', { length: 32 }).notNull(),
    status: varchar('status', { length: 24 }).default('pending').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    purgeAt: timestamp('purge_at', { withTimezone: true }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    tombstoneHash: varchar('tombstone_hash', { length: 64 }),
  },
  (table) => [uniqueIndex('deletion_requests_workspace_idx').on(table.workspaceId)],
)

export const workspaceDeletionTombstones = pgTable(
  'workspace_deletion_tombstones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceHash: varchar('workspace_hash', { length: 64 }).notNull(),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }).notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true }).defaultNow().notNull(),
    retainUntil: timestamp('retain_until', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('workspace_tombstones_hash_idx').on(table.workspaceHash)],
)

export const reportRecipients = pgTable(
  'report_recipients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    shareId: uuid('share_id')
      .references(() => shareLinks.id, { onDelete: 'cascade' })
      .notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    otpHash: varchar('otp_hash', { length: 64 }),
    otpExpiresAt: timestamp('otp_expires_at', { withTimezone: true }),
    otpAttemptCount: integer('otp_attempt_count').default(0).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    sessionTokenHash: varchar('session_token_hash', { length: 64 }),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),
    decision: varchar('decision', { length: 24 }),
    decisionAt: timestamp('decision_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('report_recipients_share_email_idx').on(table.shareId, table.email)],
)

export const reportTemplates = pgTable(
  'report_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    locale: varchar('locale', { length: 8 }).default('fr').notNull(),
    periodDays: integer('period_days').default(30).notNull(),
    editorialComment: text('editorial_comment'),
    actionPlan: text('action_plan'),
    currentVersion: integer('current_version').default(1).notNull(),
    active: boolean('active').default(true).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('report_templates_workspace_name_idx').on(table.workspaceId, table.name)],
)

export const reportTemplateVersions = pgTable(
  'report_template_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    templateId: uuid('template_id').references(() => reportTemplates.id, { onDelete: 'cascade' }).notNull(),
    version: integer('version').notNull(),
    editedBy: varchar('edited_by', { length: 64 }).notNull(),
    snapshot: jsonb('snapshot').$type<{
      name: string
      locale: 'fr' | 'en'
      periodDays: number
      editorialComment: string | null
      actionPlan: string | null
    }>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('report_template_versions_template_version_idx').on(table.templateId, table.version),
    index('report_template_versions_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
)

export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
    templateId: uuid('template_id').references(() => reportTemplates.id, { onDelete: 'set null' }),
    shareId: uuid('share_id').references(() => shareLinks.id, { onDelete: 'cascade' }).notNull(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    cadence: varchar('cadence', { length: 16 }).notNull(),
    scheduleWeekday: integer('schedule_weekday'),
    scheduleMonthday: integer('schedule_monthday'),
    sendHour: integer('send_hour').default(8).notNull(),
    timezone: varchar('timezone', { length: 64 }).default('Europe/Paris').notNull(),
    recipientEmails: text('recipient_emails').array().default([]).notNull(),
    encryptedReportToken: text('encrypted_report_token').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    deliveryLeaseUntil: timestamp('delivery_lease_until', { withTimezone: true }),
    lastRunKey: varchar('last_run_key', { length: 32 }),
    lastDeliveredAt: timestamp('last_delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('report_schedules_share_idx').on(table.shareId),
    index('report_schedules_due_idx').on(table.enabled, table.cadence, table.sendHour),
    index('report_schedules_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
)

export const workspaceDomains = pgTable(
  'workspace_domains',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    hostname: varchar('hostname', { length: 253 }).notNull(),
    dnsTokenHash: varchar('dns_token_hash', { length: 64 }).notNull(),
    verificationStatus: varchar('verification_status', { length: 24 }).default('pending').notNull(),
    vercelStatus: varchar('vercel_status', { length: 24 }).default('not_submitted').notNull(),
    vercelConfiguration: jsonb('vercel_configuration').$type<Record<string, unknown>>(),
    lastError: text('last_error'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workspace_domains_hostname_idx').on(table.hostname),
    index('workspace_domains_workspace_idx').on(table.workspaceId),
  ],
)

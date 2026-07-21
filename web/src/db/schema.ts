import {
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

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkOrganizationId: varchar('clerk_organization_id', { length: 64 }).notNull(),
    ownerUserId: varchar('owner_user_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(),
    brandName: varchar('brand_name', { length: 120 }).default('Vigieads').notNull(),
    brandTagline: varchar('brand_tagline', { length: 180 }).default('Pilotez chaque compte avec confiance.').notNull(),
    accentColor: varchar('accent_color', { length: 16 }).default('#635BFF').notNull(),
    logoUrl: text('logo_url'),
    approvalMode: varchar('approval_mode', { length: 24 }).default('single').notNull(),
    plan: varchar('plan', { length: 24 }).default('solo').notNull(),
    subscriptionStatus: varchar('subscription_status', { length: 32 }).default('inactive').notNull(),
    stripeCustomerId: varchar('stripe_customer_id', { length: 64 }),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 64 }),
    subscriptionCurrentPeriodEnd: timestamp('subscription_current_period_end', { withTimezone: true }),
    notificationEmail: varchar('notification_email', { length: 254 }),
    maximumDailyBudgetMicros: numeric('maximum_daily_budget_micros', { precision: 22, scale: 0 }),
    maximumMonthlySpendMicros: numeric('maximum_monthly_spend_micros', { precision: 22, scale: 0 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workspaces_clerk_org_idx').on(table.clerkOrganizationId),
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
    detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('alert_incidents_fingerprint_idx').on(table.workspaceId, table.fingerprint),
    index('alert_incidents_workspace_status_idx').on(table.workspaceId, table.status),
  ],
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
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('api_keys_token_hash_idx').on(table.tokenHash),
    index('api_keys_workspace_idx').on(table.workspaceId),
  ],
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
    status: varchar('status', { length: 24 }).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 128 }),
    errorMessage: text('error_message'),
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

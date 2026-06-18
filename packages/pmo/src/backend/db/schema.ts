import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const pmoSchema = pgSchema('pmo');

/**
 * ProjectPlanGuard (PMO-01) data layer.
 *
 * One table per mock-dataset sheet (DS01–DS08 + REF + KPI norms), all tenant-scoped
 * with a surrogate uuid PK plus the dataset's natural key. No cross-schema FKs — the
 * dataset's string IDs (project_id, plan_id, member_id, …) are resolved in-app.
 *
 * Benchmark similarity embeddings (over DS05/DS04) are NOT defined here: they are
 * managed by the `@mastra/pg` PgVector store in its own `pmo_rag` schema, wired in
 * the Benchmark phase — mirroring identity_rag / knowledge_rag.
 *
 * Field reference: docs/projectplanguard/02-dataset-reference.md
 * Output contract:  docs/projectplanguard/05-feasibility-rules-and-ds07.md
 */

// ── DS01 — Project Plan (1 row = 1 task/milestone in a plan under review) ──────────
export const ds01Tasks = pmoSchema.table(
  'ds01_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    project_id: text('project_id').notNull(), // FK→ref_project (resolved in-app)
    project_name: text('project_name'),
    task_id: text('task_id').notNull(), // unique within a plan
    task_name: text('task_name'),
    assignee_id: text('assignee_id'), // FK→ref_member
    start_date: date('start_date', { mode: 'string' }),
    end_date: date('end_date', { mode: 'string' }),
    effort_days: real('effort_days'),
    percent_complete: real('percent_complete'), // 0.0–1.0
    status: text('status'), // Not Started/In Progress/Completed/Blocked/Delayed
    milestone_flag: boolean('milestone_flag').default(false).notNull(),
    dependencies: text('dependencies'), // CSV of prerequisite task_ids (may form a cycle)
    phase: text('phase'), // Discovery/Design/Development/Testing/Deployment
    risk_note: text('risk_note'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('ds01_by_tenant_project').on(t.tenant_id, t.project_id),
    uniqueIndex('ds01_uniq_task_per_tenant').on(t.tenant_id, t.project_id, t.task_id),
  ],
);

// ── DS02 — PMO Standard Template (1 row = 1 required component) ────────────────────
export const ds02Template = pmoSchema.table(
  'ds02_template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    template_id: text('template_id').notNull(),
    template_name: text('template_name'),
    version: text('version'),
    effective_date: date('effective_date', { mode: 'string' }),
    component_id: text('component_id').notNull(),
    section_code: text('section_code'), // S01–S08
    component_name: text('component_name'),
    required: boolean('required').default(true).notNull(),
    validation_rule: text('validation_rule'),
    weight: real('weight'), // all components sum to 1.0
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ds02_uniq_component_per_tenant').on(t.tenant_id, t.template_id, t.component_id),
  ],
);

// ── DS03 — Resource Allocation (1 row = 1 member × project allocation snapshot) ────
export const ds03Alloc = pmoSchema.table(
  'ds03_alloc',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    member_id: text('member_id').notNull(), // FK→ref_member
    project_id: text('project_id').notNull(), // FK→ref_project
    role: text('role'),
    allocation_pct: real('allocation_pct'),
    start_date: date('start_date', { mode: 'string' }),
    end_date: date('end_date', { mode: 'string' }),
    busy_rate: real('busy_rate'), // sum of member's allocation across projects (e.g. 1.25 = 125%)
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('ds03_by_tenant_member').on(t.tenant_id, t.member_id),
    index('ds03_by_tenant_project').on(t.tenant_id, t.project_id),
  ],
);

// ── DS04 — Velocity History (1 row = 1 sprint of a completed project) ──────────────
export const ds04Velocity = pmoSchema.table(
  'ds04_velocity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    project_id: text('project_id').notNull(), // historical project FK
    project_type: text('project_type'),
    sprint_no: integer('sprint_no'),
    sprint_duration_days: integer('sprint_duration_days'),
    planned_points: real('planned_points'),
    completed_points: real('completed_points'),
    velocity_ratio: real('velocity_ratio'), // completed / planned
    team_size: integer('team_size'),
    outcome: text('outcome'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('ds04_by_tenant_project').on(t.tenant_id, t.project_id)],
);

// ── DS05 — Historical Projects (1 row = 1 completed project benchmark) ─────────────
export const ds05History = pmoSchema.table(
  'ds05_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    historical_project_id: text('historical_project_id').notNull(),
    project_type: text('project_type'), // filter for similar benchmark
    team_size: integer('team_size'),
    duration_days: integer('duration_days'),
    planned_duration_days: integer('planned_duration_days'),
    total_effort_days: real('total_effort_days'),
    total_budget_scaled: real('total_budget_scaled'),
    avg_velocity_ratio: real('avg_velocity_ratio'),
    risk_count: integer('risk_count'),
    key_risks: text('key_risks'),
    pmo_standard_ver: text('pmo_standard_ver'),
    final_outcome: text('final_outcome'), // On Time/Delayed/Cancelled/Early
    is_outlier: boolean('is_outlier').default(false).notNull(), // TRUE = exclude from benchmarking
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ds05_uniq_project_per_tenant').on(t.tenant_id, t.historical_project_id),
    index('ds05_by_tenant_type').on(t.tenant_id, t.project_type),
  ],
);

// ── DS06 — Plan Section Check (1 row = 1 template component checked vs a plan) ─────
export const ds06SectionCheck = pmoSchema.table(
  'ds06_section_check',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    check_id: text('check_id').notNull(),
    plan_id: text('plan_id').notNull(),
    component_id: text('component_id'), // FK→ds02 (NULL if custom)
    custom_name: text('custom_name'), // set when status = Custom
    status: text('status'), // Complete/Weak/Missing/Custom
    note: text('note'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ds06_uniq_check_per_tenant').on(t.tenant_id, t.check_id),
    index('ds06_by_tenant_plan').on(t.tenant_id, t.plan_id),
  ],
);

// ── DS07 — Project Plan Summary (1 row = 1 plan under review; seeded reference) ────
export const ds07Summary = pmoSchema.table(
  'ds07_summary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    plan_id: text('plan_id').notNull(),
    project_id: text('project_id'),
    project_name: text('project_name'),
    plan_set: text('plan_set'), // e.g. To_Review
    effort_md: real('effort_md'),
    duration_months: real('duration_months'),
    velocity_md_month: real('velocity_md_month'),
    team_size: integer('team_size'),
    risk_count: integer('risk_count'), // 0 = missing register
    top_risk_score: real('top_risk_score'),
    thi_pct: real('thi_pct'),
    peak_role_busy_rate_pct: real('peak_role_busy_rate_pct'),
    on_time_history_pct: real('on_time_history_pct'),
    feasibility_status: text('feasibility_status'), // reference verdict (ground truth)
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ds07_uniq_plan_per_tenant').on(t.tenant_id, t.plan_id)],
);

// ── DS08 — Role Capacity (1 row = 1 role's current capacity) ───────────────────────
export const ds08Capacity = pmoSchema.table(
  'ds08_capacity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    capacity_id: text('capacity_id').notNull(),
    role: text('role'),
    headcount: integer('headcount'),
    capacity_md_month: real('capacity_md_month'),
    busy_rate_pct: real('busy_rate_pct'),
    available_md_month: real('available_md_month'),
    note: text('note'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ds08_uniq_capacity_per_tenant').on(t.tenant_id, t.capacity_id)],
);

// ── REF — Member Master (shared) ───────────────────────────────────────────────────
export const refMember = pmoSchema.table(
  'ref_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    member_id: text('member_id').notNull(),
    full_name: text('full_name'),
    role_title: text('role_title'),
    department: text('department'),
    employment: text('employment'), // FT/PT
    std_hours_week: real('std_hours_week'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ref_member_uniq_per_tenant').on(t.tenant_id, t.member_id)],
);

// ── REF — Project Master (shared) ──────────────────────────────────────────────────
export const refProject = pmoSchema.table(
  'ref_project',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    project_id: text('project_id').notNull(),
    project_name: text('project_name'),
    project_type: text('project_type'),
    status: text('status'),
    is_historical: boolean('is_historical').default(false).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ref_project_uniq_per_tenant').on(t.tenant_id, t.project_id)],
);

// ── REF — KPI Norms (RAG thresholds, SETA-08-SOP-001) ──────────────────────────────
export const kpiNorms = pmoSchema.table(
  'kpi_norms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    norm_id: text('norm_id').notNull(),
    metric: text('metric'),
    formula: text('formula'),
    green: text('green'),
    yellow: text('yellow'),
    red: text('red'),
    used_for: text('used_for'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('kpi_norms_uniq_per_tenant').on(t.tenant_id, t.norm_id)],
);

// ── Review Report (agent output — the DS07 review report, HITL-gated write) ────────
// Header metrics mirror DS07; the detail arrays (gap_report, risk_warnings,
// recommended_adjustments, benchmark) live in `payload`. Schema: 05-feasibility-rules-and-ds07.md §6.
export const reviewReport = pmoSchema.table(
  'review_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    plan_id: text('plan_id').notNull(),
    status: text('status').default('draft').notNull(), // draft/approved/rejected
    compliance_score_pct: real('compliance_score_pct'),
    thi_pct: real('thi_pct'),
    peak_role_busy_rate_pct: real('peak_role_busy_rate_pct'),
    feasibility_status: text('feasibility_status'),
    confidence: text('confidence'),
    payload: jsonb('payload').notNull(), // full DS07 output object (gaps, risks, recommendations)
    created_by: uuid('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('review_report_by_tenant_plan').on(t.tenant_id, t.plan_id)],
);

CREATE SCHEMA "pmo";
--> statement-breakpoint
CREATE TABLE "pmo"."ds01_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"project_name" text,
	"task_id" text NOT NULL,
	"task_name" text,
	"assignee_id" text,
	"start_date" date,
	"end_date" date,
	"effort_days" real,
	"percent_complete" real,
	"status" text,
	"milestone_flag" boolean DEFAULT false NOT NULL,
	"dependencies" text,
	"phase" text,
	"risk_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ds02_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"template_name" text,
	"version" text,
	"effective_date" date,
	"component_id" text NOT NULL,
	"section_code" text,
	"component_name" text,
	"required" boolean DEFAULT true NOT NULL,
	"validation_rule" text,
	"weight" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ds03_alloc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text,
	"allocation_pct" real,
	"start_date" date,
	"end_date" date,
	"busy_rate" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ds04_velocity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"project_type" text,
	"sprint_no" integer,
	"sprint_duration_days" integer,
	"planned_points" real,
	"completed_points" real,
	"velocity_ratio" real,
	"team_size" integer,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ds05_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"historical_project_id" text NOT NULL,
	"project_type" text,
	"team_size" integer,
	"duration_days" integer,
	"planned_duration_days" integer,
	"total_effort_days" real,
	"total_budget_scaled" real,
	"avg_velocity_ratio" real,
	"risk_count" integer,
	"key_risks" text,
	"pmo_standard_ver" text,
	"final_outcome" text,
	"is_outlier" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ds06_section_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"check_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"component_id" text,
	"custom_name" text,
	"status" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ds07_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"project_id" text,
	"project_name" text,
	"plan_set" text,
	"effort_md" real,
	"duration_months" real,
	"velocity_md_month" real,
	"team_size" integer,
	"risk_count" integer,
	"top_risk_score" real,
	"thi_pct" real,
	"peak_role_busy_rate_pct" real,
	"on_time_history_pct" real,
	"feasibility_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ds08_capacity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"capacity_id" text NOT NULL,
	"role" text,
	"headcount" integer,
	"capacity_md_month" real,
	"busy_rate_pct" real,
	"available_md_month" real,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."kpi_norms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"norm_id" text NOT NULL,
	"metric" text,
	"formula" text,
	"green" text,
	"yellow" text,
	"red" text,
	"used_for" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ref_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"full_name" text,
	"role_title" text,
	"department" text,
	"employment" text,
	"std_hours_week" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ref_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"project_name" text,
	"project_type" text,
	"status" text,
	"is_historical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."review_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"compliance_score_pct" real,
	"thi_pct" real,
	"peak_role_busy_rate_pct" real,
	"feasibility_status" text,
	"confidence" text,
	"payload" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ds01_by_tenant_project" ON "pmo"."ds01_tasks" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds01_uniq_task_per_tenant" ON "pmo"."ds01_tasks" USING btree ("tenant_id","project_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds02_uniq_component_per_tenant" ON "pmo"."ds02_template" USING btree ("tenant_id","template_id","component_id");--> statement-breakpoint
CREATE INDEX "ds03_by_tenant_member" ON "pmo"."ds03_alloc" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "ds03_by_tenant_project" ON "pmo"."ds03_alloc" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "ds04_by_tenant_project" ON "pmo"."ds04_velocity" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds05_uniq_project_per_tenant" ON "pmo"."ds05_history" USING btree ("tenant_id","historical_project_id");--> statement-breakpoint
CREATE INDEX "ds05_by_tenant_type" ON "pmo"."ds05_history" USING btree ("tenant_id","project_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ds06_uniq_check_per_tenant" ON "pmo"."ds06_section_check" USING btree ("tenant_id","check_id");--> statement-breakpoint
CREATE INDEX "ds06_by_tenant_plan" ON "pmo"."ds06_section_check" USING btree ("tenant_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds07_uniq_plan_per_tenant" ON "pmo"."ds07_summary" USING btree ("tenant_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds08_uniq_capacity_per_tenant" ON "pmo"."ds08_capacity" USING btree ("tenant_id","capacity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_norms_uniq_per_tenant" ON "pmo"."kpi_norms" USING btree ("tenant_id","norm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ref_member_uniq_per_tenant" ON "pmo"."ref_member" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ref_project_uniq_per_tenant" ON "pmo"."ref_project" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "review_report_by_tenant_plan" ON "pmo"."review_report" USING btree ("tenant_id","plan_id");
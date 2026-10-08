CREATE TABLE "mold_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"threed_task_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"engine_job_id" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"artifacts" jsonb,
	"error_code" text,
	"movement" jsonb,
	"refunded" boolean DEFAULT false NOT NULL,
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mold_jobs" ADD CONSTRAINT "mold_jobs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mold_jobs" ADD CONSTRAINT "mold_jobs_threed_task_id_threed_tasks_id_fk" FOREIGN KEY ("threed_task_id") REFERENCES "public"."threed_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mold_jobs_session_idx" ON "mold_jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mold_jobs_threed_task_idx" ON "mold_jobs" USING btree ("threed_task_id");
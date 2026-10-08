CREATE TABLE "mold_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"mold_job_id" uuid NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"price_tomans" integer NOT NULL,
	"size_cm" integer,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mold_orders" ADD CONSTRAINT "mold_orders_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mold_orders" ADD CONSTRAINT "mold_orders_mold_job_id_mold_jobs_id_fk" FOREIGN KEY ("mold_job_id") REFERENCES "public"."mold_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mold_orders_session_idx" ON "mold_orders" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mold_orders_job_idx" ON "mold_orders" USING btree ("mold_job_id");
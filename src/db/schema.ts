import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * ZeroLab schema (lab-v1).
 *
 * Conventions:
 * - Every user-scoped table carries `session_id` (anonymous cookie session).
 * - Timestamps are `created_at` (timestamptz, default now()).
 * - Money/credits live only in `credit_ledger` (append-only deltas).
 */

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Future: filled once auth lands. No FK yet — no users table exists. */
  userId: uuid("user_id"),
  /** sha256 of the client IP — anti-abuse cap (3x free quota per IP, issue 05). */
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Positive = grant, negative = consumption. Balance per service = SUM(delta). */
    delta: integer("delta").notNull(),
    /** Service name ('chat' | 'image' | 'threed') — see src/config/credits.ts. */
    reason: text("reason").notNull(),
    /** 'free' (per-kind free-quota usage row) | 'paid' (purchased pool movement). */
    source: text("source").notNull(),
    /** Free-form link to the consuming entity (chat id, image id, task id, ...). */
    ref: text("ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("credit_ledger_session_reason_idx").on(t.sessionId, t.reason)],
);

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Currently only 'silicone-mold'; more services arrive in later labs. */
    service: text("service").notNull().default("silicone-mold"),
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("chats_session_idx").on(t.sessionId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** Original public URL of an attached reference image (library pick), if any. */
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("messages_chat_idx").on(t.chatId)],
);

export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    /** 'generated' | 'uploaded' | 'standardized' */
    kind: text("kind").notNull(),
    /** Key inside the storage abstraction (src/server/storage). */
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    /** Library seeds (ticket 15) are public; user generations stay private. */
    isSeed: boolean("is_seed").notNull().default(false),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("images_session_idx").on(t.sessionId)],
);

export const threedTasks = pgTable(
  "threed_tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    inputImageId: uuid("input_image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    /** 'tripo' | 'sample' */
    provider: text("provider").notNull(),
    providerTaskId: text("provider_task_id"),
    /** 'queued' | 'running' | 'success' | 'failed' */
    status: text("status").notNull().default("queued"),
    glbKey: text("glb_key"),
    /** UV-unwelded twin of glbKey — one solid mesh, required by the mold engine. */
    solidGlbKey: text("solid_glb_key"),
    creditsSpent: integer("credits_spent").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("threed_tasks_session_idx").on(t.sessionId)],
);

/**
 * Mold studio jobs (mold-studio ticket 11) — one row per «ساخت قالب» run.
 * The engine sidecar keeps jobs in memory only; this table is the durable
 * record, including the exact params snapshot and the ingested artifacts.
 */
export const moldJobs = pgTable(
  "mold_jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** The completed 3D task whose GLB is the mold input. */
    threedTaskId: uuid("threed_task_id")
      .notNull()
      .references(() => threedTasks.id, { onDelete: "cascade" }),
    /** 'queued' | 'running' | 'success' | 'failed' */
    status: text("status").notNull().default("queued"),
    /** Engine-side job id (12 hex) — volatile, 404s after sidecar restart. */
    engineJobId: text("engine_job_id"),
    /** Exact params JSON sent to the engine, including reserved keys. */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    /** Engine result.json (volumes mm³, parts, print orientations, warnings). */
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    /** { files: [{ name, key, bytes, role }], zipKey } after ingest. */
    artifacts: jsonb("artifacts").$type<Record<string, unknown> | null>(),
    /** Engine error_code (ERROR_*) or our own ('ERROR_ENGINE_UNREACHABLE' | 'ERROR_ENGINE_VANISHED'). */
    errorCode: text("error_code"),
    /** Credit movement taken at creation — kept for failure refunds. */
    movement: jsonb("movement").$type<Record<string, unknown> | null>(),
    refunded: boolean("refunded").notNull().default(false),
    creditsSpent: integer("credits_spent").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mold_jobs_session_idx").on(t.sessionId),
    index("mold_jobs_threed_task_idx").on(t.threedTaskId),
  ],
);

/**
 * Placed mold orders (mold-studio ticket 15) — «ثبت سفارش قالب». No payment
 * in v1 (gateway out of scope, lab-v1 precedent): placing an order records
 * the job + price snapshot and fixes the print-ready bundle for the manager.
 */
export const moldOrders = pgTable(
  "mold_orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** One order per mold job (idempotent placement). */
    moldJobId: uuid("mold_job_id")
      .notNull()
      .references(() => moldJobs.id, { onDelete: "cascade" }),
    /** 'placed' — later phases (printing/shipped) arrive with fulfillment. */
    status: text("status").notNull().default("placed"),
    /** Server-computed price snapshot (ticket 14) — never client-supplied. */
    priceTomans: integer("price_tomans").notNull(),
    /** Longest side in cm carried from viewerParams at job time. */
    sizeCm: integer("size_cm"),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mold_orders_session_idx").on(t.sessionId),
    index("mold_orders_job_idx").on(t.moldJobId),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type CreditLedgerRow = typeof creditLedger.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type ImageRow = typeof images.$inferSelect;
export type ThreedTask = typeof threedTasks.$inferSelect;
export type MoldJob = typeof moldJobs.$inferSelect;
export type MoldOrder = typeof moldOrders.$inferSelect;

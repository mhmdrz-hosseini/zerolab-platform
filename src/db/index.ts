import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazy, hot-reload-safe DB client.
 * Nothing connects at import time — `next build` never touches Postgres.
 */
const globalForDb = globalThis as unknown as {
  zerolabSql?: postgres.Sql;
};

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Start the db with `docker compose up -d`.",
    );
  }
  const sql = globalForDb.zerolabSql ?? postgres(databaseUrl, { max: 10 });
  globalForDb.zerolabSql = sql;
  return drizzle(sql, { schema });
}

export { schema };

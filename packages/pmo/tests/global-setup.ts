import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '@seta/shared-db';
import { ensureTemplateDb, markAsTemplate, startPgContainer } from '@seta/shared-testing';
import { Pool } from 'pg';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let handle: Awaited<ReturnType<typeof startPgContainer>> | null = null;

export default async function (): Promise<() => Promise<void>> {
  const TEMPLATE = 'platform_template_pmo';
  handle = await startPgContainer();
  await ensureTemplateDb(handle, TEMPLATE);

  const pool = new Pool({ connectionString: `${handle.baseUrl}/${TEMPLATE}` });
  try {
    // The pmo migration is self-contained (CREATE SCHEMA pmo + tables, no cross-schema FKs).
    await runMigrations({
      pool,
      modules: [{ name: 'pmo', dir: resolve(__dirname, '../drizzle/migrations') }],
    });
  } finally {
    await pool.end();
  }

  await markAsTemplate(handle, TEMPLATE);

  process.env.PLATFORM_TEST_PG_BASE = handle.baseUrl;
  process.env.PLATFORM_TEST_PG_TEMPLATE = TEMPLATE;

  return async () => {
    await handle?.stop();
  };
}

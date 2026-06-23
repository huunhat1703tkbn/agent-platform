import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { reportToWorkbookBuffer } from '../../src/backend/domain/report-workbook.ts';
import { buildReviewReport } from '../../src/backend/domain/synthesis.ts';
import { resetPmoDb, seedPmoDataset } from '../../src/index.ts';

const TENANT = '00000000-0000-0000-0000-0000000000ff';

async function withSeededDb(fn: () => Promise<void>): Promise<void> {
  await withTestDb(
    {
      templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
      baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
    },
    async ({ databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        await seedPmoDataset({ tenantId: TENANT });
        await fn();
      } finally {
        resetPmoDb();
        await closePools();
      }
    },
  );
}

function allText(ws: ExcelJS.Worksheet): string {
  const lines: string[] = [];
  ws.eachRow((row) => {
    lines.push((row.values as unknown[]).map((v) => (v == null ? '' : String(v))).join(' '));
  });
  return lines.join('\n');
}

describe('reportToWorkbookBuffer (DS07 → Excel)', () => {
  it('produces a multi-sheet workbook with the verdict, risk score and pillars for PLAN-002', async () => {
    await withSeededDb(async () => {
      const report = await buildReviewReport({ tenantId: TENANT, planId: 'PLAN-002' });
      const buf = await reportToWorkbookBuffer(report);
      expect(buf.length).toBeGreaterThan(0);

      const wb = new ExcelJS.Workbook();
      // ExcelJS Buffer type predates Node's generic Buffer<ArrayBufferLike>
      await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const names = wb.worksheets.map((w) => w.name);
      expect(names).toContain('Summary');
      expect(names).toContain('Pillars');
      expect(names).toContain('Recommendations');

      const summary = allText(wb.getWorksheet('Summary') as ExcelJS.Worksheet);
      expect(summary).toContain('PLAN-002');
      expect(summary).toContain('Not feasible (Red)');
      // Risk score is surfaced on the summary sheet.
      expect(summary).toMatch(/Risk Score/i);

      // Pillars sheet lists each dimension with its RAG.
      const pillars = allText(wb.getWorksheet('Pillars') as ExcelJS.Worksheet);
      expect(pillars).toContain('Resource');
      expect(pillars).toContain('Risk');
    });
  });
});

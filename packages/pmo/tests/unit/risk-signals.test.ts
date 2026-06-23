import { describe, expect, it } from 'vitest';
import {
  computeRiskScore,
  detectBusFactor,
  detectCapacityNearFull,
  detectFragileGreen,
  detectNoCohort,
  scanLatentRisks,
} from '../../src/backend/domain/risk-signals.ts';

const greenPillars = [
  { dimension: 'Compliance', rag: 'Green' as const },
  { dimension: 'Resource', rag: 'Green' as const },
  { dimension: 'Timeline/Dependency', rag: 'Green' as const },
  { dimension: 'THI', rag: 'Green' as const },
  { dimension: 'Benchmark', rag: 'Green' as const },
  { dimension: 'Risk', rag: 'Green' as const },
];

describe('computeRiskScore', () => {
  it('is 0 / Green when every pillar is Green and nothing is latent', () => {
    const r = computeRiskScore({ pillars: greenPillars, latent_risks: [] });
    expect(r.score).toBe(0);
    expect(r.band).toBe('Green');
  });

  it('is 100 / Red when every pillar is Red', () => {
    const r = computeRiskScore({
      pillars: greenPillars.map((p) => ({ ...p, rag: 'Red' as const })),
      latent_risks: [],
    });
    expect(r.score).toBe(100);
    expect(r.band).toBe('Red');
  });

  it('weights a single Red dimension by its share', () => {
    const pillars = greenPillars.map((p) =>
      p.dimension === 'Resource' ? { ...p, rag: 'Red' as const } : p,
    );
    expect(computeRiskScore({ pillars, latent_risks: [] }).score).toBe(20);
  });

  it('raises the score for latent risks even when all pillars are Green', () => {
    const r = computeRiskScore({
      pillars: greenPillars,
      latent_risks: [
        { code: 'no_cohort', severity: 'medium', title: '', detail: '' },
        { code: 'bus_factor', severity: 'medium', title: '', detail: '' },
      ],
    });
    expect(r.score).toBe(10);
    expect(r.score).toBeGreaterThan(0);
  });

  it('names the top risk drivers', () => {
    const pillars = greenPillars.map((p) =>
      p.dimension === 'Risk' ? { ...p, rag: 'Red' as const } : p,
    );
    const r = computeRiskScore({ pillars, latent_risks: [] });
    expect(r.drivers[0]).toContain('Risk');
  });
});

describe('detectFragileGreen', () => {
  it('flags a Green metric within the margin of its Yellow threshold', () => {
    const risks = detectFragileGreen(
      [{ dimension: 'Resource', value: 109, green_lo: 85, green_hi: 110, unit: '%' }],
      3,
    );
    expect(risks).toHaveLength(1);
    expect(risks[0]?.code).toBe('fragile_green');
    expect(risks[0]?.dimension).toBe('Resource');
  });

  it('does not flag a comfortably-Green metric', () => {
    const risks = detectFragileGreen(
      [{ dimension: 'THI', value: 20, green_lo: 15, green_hi: 25 }],
      3,
    );
    expect(risks).toHaveLength(0);
  });

  it('ignores metrics already outside the Green band (already Red/Yellow, not fragile-green)', () => {
    const risks = detectFragileGreen(
      [{ dimension: 'Resource', value: 135, green_lo: 85, green_hi: 110 }],
      3,
    );
    expect(risks).toHaveLength(0);
  });

  it('flags proximity to the lower Green edge too', () => {
    const risks = detectFragileGreen(
      [{ dimension: 'Resource', value: 86, green_lo: 85, green_hi: 110 }],
      3,
    );
    expect(risks).toHaveLength(1);
  });
});

describe('detectNoCohort', () => {
  it('flags estimation risk when the benchmark cohort is insufficient', () => {
    const r = detectNoCohort({ insufficient_data: true, cohort_project_type: 'Integration' });
    expect(r?.code).toBe('no_cohort');
    expect(r?.detail).toContain('Integration');
  });

  it('returns null when there is a sufficient cohort', () => {
    expect(detectNoCohort({ insufficient_data: false })).toBeNull();
  });
});

describe('detectCapacityNearFull', () => {
  it('flags a bottleneck role projected at/above the near-full threshold', () => {
    const r = detectCapacityNearFull(
      { role: 'ML Engineer', projected_busy_rate_pct: 112, peak_month: '2026-09' },
      110,
    );
    expect(r?.code).toBe('capacity_near_full');
    expect(r?.detail).toContain('ML Engineer');
  });

  it('returns null when the bottleneck has comfortable headroom', () => {
    expect(
      detectCapacityNearFull(
        { role: 'QA Engineer', projected_busy_rate_pct: 80, peak_month: '2026-09' },
        110,
      ),
    ).toBeNull();
  });

  it('returns null when there is no bottleneck', () => {
    expect(detectCapacityNearFull(null, 110)).toBeNull();
  });
});

describe('detectBusFactor', () => {
  it('flags a member carrying more than the threshold share of tasks', () => {
    const tasks = [
      { task_id: 'T1', assignee_id: 'EMP-1' },
      { task_id: 'T2', assignee_id: 'EMP-1' },
      { task_id: 'T3', assignee_id: 'EMP-1' },
      { task_id: 'T4', assignee_id: 'EMP-2' },
    ];
    const risks = detectBusFactor(tasks, 0.5);
    expect(risks).toHaveLength(1);
    expect(risks[0]?.code).toBe('bus_factor');
    expect(risks[0]?.detail).toContain('EMP-1');
  });

  it('does not flag a balanced assignment', () => {
    const tasks = [
      { task_id: 'T1', assignee_id: 'EMP-1' },
      { task_id: 'T2', assignee_id: 'EMP-2' },
    ];
    expect(detectBusFactor(tasks, 0.5)).toHaveLength(0);
  });

  it('ignores unassigned tasks when computing concentration', () => {
    const tasks = [
      { task_id: 'T1', assignee_id: 'EMP-1' },
      { task_id: 'T2', assignee_id: null },
      { task_id: 'T3', assignee_id: null },
    ];
    // EMP-1 owns 1 of 1 assigned task → concentration 1.0 → flagged
    expect(detectBusFactor(tasks, 0.5)).toHaveLength(1);
  });
});

describe('scanLatentRisks', () => {
  it('surfaces risks even when every pillar is Green', () => {
    const risks = scanLatentRisks({
      band_metrics: [{ dimension: 'Resource', value: 109, green_lo: 85, green_hi: 110 }],
      benchmark: { insufficient_data: true, cohort_project_type: 'Integration' },
      capacity: {
        bottleneck: { role: 'ML Engineer', projected_busy_rate_pct: 113, peak_month: '2026-09' },
      },
      tasks: [
        { task_id: 'T1', assignee_id: 'EMP-1' },
        { task_id: 'T2', assignee_id: 'EMP-1' },
        { task_id: 'T3', assignee_id: 'EMP-1' },
      ],
    });
    const codes = risks.map((r) => r.code).sort();
    expect(codes).toContain('fragile_green');
    expect(codes).toContain('no_cohort');
    expect(codes).toContain('capacity_near_full');
    expect(codes).toContain('bus_factor');
  });

  it('returns an empty list when nothing is latent', () => {
    const risks = scanLatentRisks({
      band_metrics: [{ dimension: 'THI', value: 20, green_lo: 15, green_hi: 25 }],
      benchmark: { insufficient_data: false },
      capacity: {
        bottleneck: { role: 'QA Engineer', projected_busy_rate_pct: 70, peak_month: null },
      },
      tasks: [
        { task_id: 'T1', assignee_id: 'EMP-1' },
        { task_id: 'T2', assignee_id: 'EMP-2' },
      ],
    });
    expect(risks).toHaveLength(0);
  });
});

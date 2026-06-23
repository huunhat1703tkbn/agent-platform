import { describe, expect, it } from 'vitest';
import {
  classifyBusyRate,
  classifyCapacityOverload,
  classifyOnTime,
  classifyThi,
} from '../../src/backend/domain/rag.ts';

describe('classifyCapacityOverload (one-sided: only over-allocation is a feasibility risk)', () => {
  it('rates a comfortably-loaded peak role as Green even when well under 75%', () => {
    // A plan whose busiest role peaks at 65% is over-staffed, NOT infeasible.
    expect(classifyCapacityOverload(65)).toBe('Green');
    expect(classifyCapacityOverload(108)).toBe('Green');
  });
  it('flags 111–120% as Yellow', () => {
    expect(classifyCapacityOverload(118)).toBe('Yellow');
  });
  it('flags >120% as Red', () => {
    expect(classifyCapacityOverload(132)).toBe('Red');
  });
});

// RAG bands are the contract in docs/projectplanguard/05-feasibility-rules-and-ds07.md §1.

describe('classifyBusyRate (N01: Green 85–110, Yellow 111–119, Red >120 or <75)', () => {
  it('flags PLAN-002 peak busy 135% as Red', () => {
    expect(classifyBusyRate(135)).toBe('Red');
  });
  it('flags a member busy 125% as Red', () => {
    expect(classifyBusyRate(125)).toBe('Red');
  });
  it('rates PLAN-001 busy 95% as Green', () => {
    expect(classifyBusyRate(95)).toBe('Green');
  });
  it('rates 108% as Green and 115% as Yellow', () => {
    expect(classifyBusyRate(108)).toBe('Green');
    expect(classifyBusyRate(115)).toBe('Yellow');
  });
  it('flags under-utilisation <75% as Red', () => {
    expect(classifyBusyRate(60)).toBe('Red');
  });
});

describe('classifyThi (N10: Green 15–25, Yellow 10–14 / 26–35, Red <10 or >35)', () => {
  it('flags PLAN-002 THI 9% as Red', () => {
    expect(classifyThi(9)).toBe('Red');
  });
  it('rates PLAN-001 THI 18% as Green', () => {
    expect(classifyThi(18)).toBe('Green');
  });
  it('rates 12% as Yellow and 40% as Red', () => {
    expect(classifyThi(12)).toBe('Yellow');
    expect(classifyThi(40)).toBe('Red');
  });
});

describe('classifyOnTime (N07: Green ≥90, Yellow 70–89, Red <70)', () => {
  it('rates 92% as Green, 80% as Yellow, 65% as Red', () => {
    expect(classifyOnTime(92)).toBe('Green');
    expect(classifyOnTime(80)).toBe('Yellow');
    expect(classifyOnTime(65)).toBe('Red');
  });
});

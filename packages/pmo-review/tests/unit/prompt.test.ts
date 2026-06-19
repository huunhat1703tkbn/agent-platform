import { describe, expect, it } from 'vitest';
import { promptFor } from '../../src/backend/orchestration/orchestrator.ts';

// Regression: the orchestrator used to frame the turn as
//   "User message: <text>\nCurrent plan/taskId: (none)"
// A reasoning model (e.g. gpt-5.5) restates that framing in its streamed
// reasoning summary, which renders as a stray duplicate of the user's message
// in chat. The prompt must be the user's text verbatim.
describe('promptFor', () => {
  it('passes the user text verbatim', () => {
    expect(promptFor({ userText: 'issue the DS07 report for PLAN-002', taskId: null })).toBe(
      'issue the DS07 report for PLAN-002',
    );
  });

  it('never emits the old synthetic framing', () => {
    const p = promptFor({ userText: 'review PLAN-002', taskId: 'task-123' });
    expect(p).not.toMatch(/User message:|Current plan\/taskId/);
  });
});

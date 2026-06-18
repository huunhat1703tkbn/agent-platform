import { describe, expect, it } from 'vitest';
import { resetCoreDb } from '../../src/db/client.ts';
import { emit, withEmit } from '../../src/events/index.ts';
import { startDispatcher } from '../../src/runtime/dispatcher/index.ts';
import { waitFor, withCoreTestDb } from '../helpers.ts';

describe('dispatcher per-subscriber isolation', () => {
  it('slow subscriber does not block the fast one', async () => {
    await withCoreTestDb(async ({ pool }) => {
      resetCoreDb();

      let slowSeen = 0;
      let fastSeen = 0;

      // The slow subscriber parks in its first handler until the test releases it. This makes
      // the assertion deterministic and independent of runner speed (no wall-clock race): an
      // isolated dispatcher lets the fast subscriber drain every event while slow sits blocked
      // in handler #1, whereas a serialized one (old Promise.all single-flight tick) would gate
      // fast behind the blocked slow handler, stalling it at the first event.
      let releaseSlow!: () => void;
      const slowGate = new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });

      const slowSub = {
        subscription: 'test.iso.slow',
        event: 'test.iso.entity.created',
        eventVersion: 1,
        handler: async () => {
          slowSeen += 1;
          await slowGate;
        },
      };
      const fastSub = {
        subscription: 'test.iso.fast',
        event: 'test.iso.entity.created',
        eventVersion: 1,
        handler: async () => {
          fastSeen += 1;
        },
      };

      const EVENTS = 10;
      const d = await startDispatcher({
        pool,
        subscribers: [slowSub, fastSub],
        pollIntervalMs: 25,
      });
      try {
        await withEmit(undefined, async () => {
          for (let i = 0; i < EVENTS; i++) {
            await emit({
              tenantId: '00000000-0000-0000-0000-000000000001',
              aggregateType: 'test.iso',
              aggregateId: '00000000-0000-0000-0000-000000000001',
              eventType: 'test.iso.entity.created',
              eventVersion: 1,
              payload: { i },
            });
          }
        });

        // Fast drains the whole batch while slow is parked. The timeout is generous on purpose —
        // a slow/loaded runner only needs more wall-clock, not a tighter race. A serialized
        // dispatcher would stall fast behind the blocked slow handler and trip this timeout.
        await waitFor(() => fastSeen === EVENTS, 10_000);
        expect(fastSeen).toBe(EVENTS);
        // Slow never advanced past its first (still-blocked) handler — proof it ran independently
        // of fast rather than in lock-step with it.
        expect(slowSeen).toBe(1);
      } finally {
        releaseSlow();
        await d.shutdown(10_000);
      }
    });
  });
});

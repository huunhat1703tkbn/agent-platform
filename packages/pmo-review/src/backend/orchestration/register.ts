import type { MastraModelConfig } from '@mastra/core/llm';
import type { MastraCompositeStore } from '@mastra/core/storage';
import type { ChatStreamRun, RunCtx } from '@seta/shared-orchestration';
import {
  makeBenchmarkAgent,
  makeComplianceAgent,
  makeFeasibilityAgent,
  makeSynthesisAgent,
} from './agents/index.ts';
import {
  makeChatOrchestrationResumer,
  makeChatOrchestrationStreamer,
  type ResumeDecision,
} from './orchestrator.ts';
import type { PmoReviewPort } from './ports.ts';

export interface PmoReviewOrchestrationRuntime {
  /** Chat streaming path: every PMO-review chat turn streams through this. */
  runStream: (
    runInput: { userText: string; taskId: string | null },
    ctx: RunCtx,
  ) => Promise<ChatStreamRun>;
  /** Native-suspend HITL resume: POST /chat/resume re-enters the suspended
   *  reviewPlan composite via resumeStream. */
  runResume: (
    resume: ResumeDecision,
    ctx: RunCtx & { mastraRunId: string; toolCallId?: string },
  ) => Promise<ChatStreamRun>;
}

/**
 * Builds the ProjectPlanGuard review orchestration runtime: the four
 * deterministic specialist sub-agents (wrapping the pmo engine via the port),
 * composed under the LLM orchestrator's delegation tools, exposed as the chat
 * stream + resume entrypoints. The composition root binds the port (pmo public
 * surface) and the model resolver, and freezes registries after calling this.
 */
export function buildPmoReviewOrchestrationRuntime(deps: {
  port: PmoReviewPort;
  resolveModel: () => MastraModelConfig;
  mastraStorage: MastraCompositeStore;
}): PmoReviewOrchestrationRuntime {
  const { port, resolveModel, mastraStorage } = deps;

  const orchestratorDeps = {
    compliance: makeComplianceAgent({ port }),
    feasibility: makeFeasibilityAgent({ port }),
    benchmark: makeBenchmarkAgent({ port }),
    synthesis: makeSynthesisAgent({ port }),
    port,
    resolveModel,
    mastraStorage,
  };

  return {
    runStream: makeChatOrchestrationStreamer(orchestratorDeps),
    runResume: makeChatOrchestrationResumer(orchestratorDeps),
  };
}

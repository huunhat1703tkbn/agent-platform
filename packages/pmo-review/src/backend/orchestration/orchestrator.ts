import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { ConsoleLogger, type LogLevel } from '@mastra/core/logger';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import {
  type AgentResult,
  type Citation,
  RC_THREAD_ID,
  type SpecializedAgentRunCtx,
  type SpecializedAgentSpec,
} from '@seta/agent-sdk';
import type { BenchmarkAssessment, ComplianceResult, ReviewReport } from '@seta/pmo';
import type { ChatStreamRun } from '@seta/shared-orchestration';
import { pickModel } from './model.ts';
import { makeOrchestratorTools } from './orchestrator.tools.ts';
import type { PmoReviewPort } from './ports.ts';
import {
  type FeasibilityFindings,
  OrchestratorInputSchema,
  type OrchestratorResult,
  OrchestratorResultSchema,
} from './schemas.ts';
import { type MastraToolSignals, trustFromMastraResult } from './trust.ts';

type In = { userText: string; taskId: string | null };
type Out = OrchestratorResult;

type ComplianceSpec = SpecializedAgentSpec<{ planId: string }, ComplianceResult>;
type FeasibilitySpec = SpecializedAgentSpec<{ planId: string }, FeasibilityFindings>;
type BenchmarkSpec = SpecializedAgentSpec<{ planId: string }, BenchmarkAssessment>;
type SynthesisSpec = SpecializedAgentSpec<{ planId: string }, ReviewReport>;

export interface OrchestratorDeps {
  compliance: ComplianceSpec;
  feasibility: FeasibilitySpec;
  benchmark: BenchmarkSpec;
  synthesis: SynthesisSpec;
  /** The pmo feature-module boundary; threaded into the issue composite. */
  port: PmoReviewPort;
  resolveModel: () => MastraModelConfig;
  /** Store the per-turn orchestrator Mastra wraps so its native-suspend snapshot
   *  persists. Injected at the composition root; shared with the engine Mastra
   *  for cross-instance resume. */
  mastraStorage: MastraCompositeStore;
  /** Test-only seam; production builds + runs a real Mastra Agent. */
  runAgent?: (args: {
    input: In;
    requestContext: RequestContext;
    instructions: string;
    tools: Record<string, unknown>;
  }) => Promise<MastraToolSignals>;
  /** Test-only seam mirroring runAgent for the streaming chat path. */
  streamAgent?: (args: {
    input: In;
    requestContext: RequestContext;
    instructions: string;
    tools: Record<string, unknown>;
  }) => {
    fullStream: AsyncIterable<unknown>;
    toolCalls: Promise<MastraToolSignals['toolCalls']>;
    toolResults: Promise<MastraToolSignals['toolResults']>;
    text: Promise<string | undefined>;
  };
  /** Test-only seam mirroring streamAgent for the RESUME chat path. */
  resumeAgent?: (args: {
    resume: ResumeDecision;
    runId: string;
    toolCallId?: string;
    requestContext: RequestContext;
  }) => {
    fullStream: AsyncIterable<unknown>;
    toolCalls: Promise<MastraToolSignals['toolCalls']>;
    toolResults: Promise<MastraToolSignals['toolResults']>;
    text: Promise<string | undefined>;
  };
}

/** The reviewPlan composite's ResumeSchema shape — forwarded into resumeStream. */
export type ResumeDecision = {
  decision: 'approve' | 'reject' | 'modify';
  note?: string;
};

/** A run ctx PLUS the resume coordinates: the Mastra runId of the suspended run
 *  and (optionally) the suspended tool's call id. */
export type ResumeCtx = SpecializedAgentRunCtx & {
  mastraRunId: string;
  toolCallId?: string;
};

type DrainableStream = {
  fullStream: AsyncIterable<unknown>;
  toolCalls: Promise<MastraToolSignals['toolCalls']>;
  toolResults: Promise<MastraToolSignals['toolResults']>;
  text: Promise<string | undefined>;
};

function instructionsText(): string {
  return [
    'You are ProjectPlanGuard, a PMO project-plan review assistant. You review a project plan',
    'for PMO compliance AND feasibility (resource load, timeline/dependencies, historical',
    'velocity), reconcile conflicts across those dimensions, and produce a DS07 review report.',
    '',
    'Plan ids look like "PLAN-002". When the user names a plan, extract that id and pass it as',
    'planId. Never invent a plan id, a number, a gap, or a risk — every statement you make MUST',
    'come from a tool result.',
    '',
    'DESCRIBE / GENERAL — when the user asks WHAT a plan/project is, to describe or summarize it,',
    'or about its scope/team/timeline (e.g. "describe this project", "what is PLAN-005", "tell me',
    'about this plan"): call pmo_describePlan(planId) and answer in prose from its overview. This is',
    'NOT a feasibility review and NEVER issues anything. If no plan is named, call pmo_listPlans and',
    'ask which one.',
    '',
    'FULL REVIEW — when the user asks to review a plan, whether it is feasible, or for its DS07',
    '(e.g. "review PLAN-002", "is PLAN-002 feasible?", "check this plan"): call',
    'pmo_synthesizeReview(planId) ONCE. It composes compliance, feasibility and benchmark itself',
    'and returns the DS07 verdict — you do NOT need to call the dimension tools separately first.',
    'Then answer with: the feasibility status and its reason, the compliance %, the per-dimension',
    'RAG pillars, and — IMPORTANTLY — any cross_dimension_conflict (a plan can look compliant yet',
    'be infeasible; surface that hidden conflict). Summarize the top risk warnings and recommended',
    'adjustments in prose; the UI also shows a structured DS07 card, so do not dump every field.',
    '',
    'TARGETED QUESTIONS — for a question about ONE dimension, call just that tool and STOP:',
    'pmo_checkCompliance (compliance %, gaps, custom sections, risk register), pmo_assessFeasibility',
    '(busy rate, THI, dependency cycles/order), or pmo_benchmarkVelocity (velocity vs cohort).',
    '',
    'AMBIGUOUS / NO PLAN NAMED — if the user has not named a plan ("review my plan", "is it',
    'feasible?"), call pmo_listPlans and ask them to pick one; do NOT guess a plan id. If a review',
    'tool reports a plan is unknown / not found, do NOT present its output as a verdict — relay that',
    'the plan is unknown and offer the valid ids (call pmo_listPlans if you need them).',
    '',
    'CONFIDENCE — when the review confidence is "low" (e.g. insufficient benchmark data), say so',
    'explicitly: report the verdict but flag that the benchmark is data-starved rather than implying',
    'certainty.',
    '',
    'ISSUE THE REPORT — ONLY when the user EXPLICITLY asks to issue, approve, finalize, save, or',
    'publish the DS07 report (e.g. "issue the report for PLAN-002", "approve this plan\'s review"):',
    'call pmo_reviewPlan(planId) ONCE. It PAUSES for the PMO to confirm before writing anything.',
    'Do NOT call pmo_reviewPlan for a review, a description, or a general question — issuing is a',
    'write and must never be triggered by anything other than an explicit issue/approve request.',
    'When a report issuance is pending, tell the user to review the approval card.',
    '',
    'If a tool returns nothing or the plan id is unknown, say so plainly and ask the user to pick a',
    'valid plan. Keep answers concise and grounded only in the tool results.',
  ].join('\n');
}

/** The prompt for the orchestrator turn: the user's text verbatim. No synthetic
 *  framing — a reasoning model restates its prompt in the streamed reasoning
 *  summary, so any "User message: …" scaffolding would surface in chat as a
 *  stray echo of the user's own message. The plan id lives in the user's text;
 *  taskId (planner page context) is irrelevant to a PMO review. */
export function promptFor(input: In): string {
  return input.userText;
}

interface BuiltOrchestrator {
  agent: Agent;
  mastra: Mastra;
  rc: RequestContext;
  message: string;
  runOptions: Record<string, unknown>;
  instructions: string;
  tools: Record<string, unknown>;
}

async function buildOrchestrator(
  deps: OrchestratorDeps,
  input: In,
  ctx: SpecializedAgentRunCtx,
): Promise<BuiltOrchestrator> {
  const rc = new RequestContext();
  rc.set('actor', { type: 'user', user_id: ctx.actorUserId });
  rc.set('tenant_id', ctx.tenantId);
  rc.set('effective_permissions', ctx.effectivePermissions ?? new Set<string>());
  if (ctx.threadId) rc.set(RC_THREAD_ID, ctx.threadId);

  const tools: Record<string, unknown> = makeOrchestratorTools({
    compliance: deps.compliance,
    feasibility: deps.feasibility,
    benchmark: deps.benchmark,
    synthesis: deps.synthesis,
    port: deps.port,
    ctx,
  });

  const instructions = instructionsText();

  const agent = new Agent({
    id: 'pmo.reviewOrchestrator',
    name: 'ProjectPlanGuard Orchestrator',
    instructions,
    model: pickModel(ctx, deps.resolveModel),
    tools: tools as never,
    ...(ctx.userMemory ? { memory: ctx.userMemory.memory } : {}),
    inputProcessors: [new TokenLimiterProcessor({ limit: 100_000 })],
  });

  // Wrap the per-turn agent in a storage-backed Mastra so .stream() persists its
  // native-suspend snapshot — a later resumeStream reloads it from the SAME store.
  const mastra = new Mastra({
    agents: { 'pmo.reviewOrchestrator': agent },
    storage: deps.mastraStorage,
    logger: new ConsoleLogger({
      name: 'Mastra',
      level: (process.env.MASTRA_LOG_LEVEL as LogLevel) ?? 'warn',
    }),
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'seta-pmo-review-orchestrator',
          exporters: [new MastraStorageExporter()],
        },
      },
    }),
  });
  const boundAgent = mastra.getAgent('pmo.reviewOrchestrator');

  const message = promptFor(input);

  const runOptions: Record<string, unknown> = {
    requestContext: rc,
    maxSteps: 12,
    abortSignal: ctx.abortSignal,
    providerOptions: { openai: { reasoningSummary: 'auto' } },
    ...(ctx.userMemory && ctx.threadId
      ? {
          memory: {
            thread: ctx.threadId,
            resource: `${ctx.tenantId}:${ctx.actorUserId}`,
            options: { readOnly: true, workingMemory: { enabled: false } },
          },
        }
      : {}),
  };

  return { agent: boundAgent, mastra, rc, message, runOptions, instructions, tools };
}

function finalizeOrchestratorResult(
  res: MastraToolSignals,
  _ctx: SpecializedAgentRunCtx,
): AgentResult<Out> {
  const result = assemble(res);
  const trust = trustFromMastraResult(res, {
    citations: (tr) => citationsFor(tr),
    confidence: confidenceFor(result),
  });
  return { result, trust };
}

export function makeOrchestratorAgent(deps: OrchestratorDeps): SpecializedAgentSpec<In, Out> {
  return {
    id: 'pmo.reviewOrchestrator',
    description:
      'Routes a PMO plan-review chat message across the compliance, feasibility, benchmark and synthesis sub-agents.',
    inputSchema: OrchestratorInputSchema,
    outputSchema: OrchestratorResultSchema,
    run: async (input, ctx): Promise<AgentResult<Out>> => {
      const built = await buildOrchestrator(deps, input, ctx);
      const res: MastraToolSignals = deps.runAgent
        ? await deps.runAgent({
            input,
            requestContext: built.rc,
            instructions: built.instructions,
            tools: built.tools,
          })
        : await (async () => {
            const r = await built.agent.generate(built.message, built.runOptions);
            return {
              toolCalls: r.toolCalls as MastraToolSignals['toolCalls'],
              toolResults: r.toolResults as MastraToolSignals['toolResults'],
              text: r.text,
            };
          })();
      return finalizeOrchestratorResult(res, ctx);
    },
  };
}

/** Streaming chat entrypoint. Drives the orchestrator via Agent.stream() and
 *  returns the live Mastra output plus a finalize() that assembles the
 *  structured result + trust once a (non-suspended) turn completes. */
export function makeChatOrchestrationStreamer(deps: OrchestratorDeps) {
  return async function startChat(input: In, ctx: SpecializedAgentRunCtx): Promise<ChatStreamRun> {
    const built = await buildOrchestrator(deps, input, ctx);
    const output = deps.streamAgent
      ? (deps.streamAgent({
          input,
          requestContext: built.rc,
          instructions: built.instructions,
          tools: built.tools,
        }) as unknown as ChatStreamRun['output'])
      : ((await built.agent.stream(
          built.message,
          built.runOptions,
        )) as unknown as ChatStreamRun['output']);

    const finalize = async () => {
      const stream = output as unknown as DrainableStream;
      const res: MastraToolSignals = {
        toolCalls: await stream.toolCalls,
        toolResults: await stream.toolResults,
        text: await stream.text,
      };
      return finalizeOrchestratorResult(res, ctx);
    };
    return { output, finalize };
  };
}

/** Resume chat entrypoint. Rebuilds the orchestrator on the shared storage-backed
 *  Mastra so the persisted native-suspend snapshot reloads by runId, calls
 *  Agent.resumeStream with the approval decision, and returns the same shape. */
export function makeChatOrchestrationResumer(deps: OrchestratorDeps) {
  return async function resumeChat(resume: ResumeDecision, ctx: ResumeCtx): Promise<ChatStreamRun> {
    const built = await buildOrchestrator(deps, { userText: '', taskId: null }, ctx);
    const output = deps.resumeAgent
      ? (deps.resumeAgent({
          resume,
          runId: ctx.mastraRunId,
          ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
          requestContext: built.rc,
        }) as unknown as ChatStreamRun['output'])
      : ((await (
          built.agent as unknown as {
            resumeStream: (
              resumeData: ResumeDecision,
              opts: { runId: string; toolCallId?: string; requestContext: RequestContext },
            ) => Promise<unknown>;
          }
        ).resumeStream(resume, {
          runId: ctx.mastraRunId,
          ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
          requestContext: built.rc,
        })) as ChatStreamRun['output']);

    const finalize = async () => {
      const stream = output as unknown as DrainableStream;
      const res: MastraToolSignals = {
        toolCalls: await stream.toolCalls,
        toolResults: await stream.toolResults,
        text: await stream.text,
      };
      return finalizeOrchestratorResult(res, ctx);
    };
    return { output, finalize };
  };
}

function results(res: MastraToolSignals, name: string): unknown[] {
  return res.toolResults.filter((t) => t.payload.toolName === name).map((t) => t.payload.result);
}

function ranAny(res: MastraToolSignals, names: string[]): boolean {
  return names.some(
    (name) =>
      res.toolCalls.some((c) => c.payload.toolName === name) ||
      res.toolResults.some((t) => t.payload.toolName === name),
  );
}

function assemble(res: MastraToolSignals): OrchestratorResult {
  // Issued (resume turn): the reviewPlan composite confirms the write.
  const [issuedResult] = results(res, 'pmo_reviewPlan') as {
    issued: boolean;
    reportId?: string;
    feasibilityStatus?: string;
  }[];
  if (issuedResult?.issued && issuedResult.reportId) {
    return {
      issued: {
        planId: extractPlanId(res, 'pmo_reviewPlan') ?? '',
        reportId: issuedResult.reportId,
        feasibilityStatus: issuedResult.feasibilityStatus ?? '',
      },
      message: res.text?.trim() || undefined,
    };
  }

  // Full review: the synthesis result is the authoritative DS07.
  const [review] = results(res, 'pmo_synthesizeReview') as ReviewReport[];
  if (review) return { review, message: res.text?.trim() || undefined };

  // Targeted-dimension question, or a pending issuance (reviewPlan suspended →
  // finalize is not called, but a non-issued reviewPlan result lands here): the
  // LLM's prose is the answer.
  const llmText = res.text?.trim();
  if (
    llmText &&
    ranAny(res, [
      'pmo_listPlans',
      'pmo_describePlan',
      'pmo_checkCompliance',
      'pmo_assessFeasibility',
      'pmo_benchmarkVelocity',
      'pmo_reviewPlan',
    ])
  ) {
    return { message: llmText };
  }

  // No tools ran (greeting / ack) → the LLM's own words.
  const noToolsRan = res.toolCalls.length === 0 && res.toolResults.length === 0;
  if (noToolsRan && llmText) return { message: llmText };

  return {
    message:
      'I can review a project plan for PMO compliance and feasibility, or issue its DS07 report. ' +
      'Name a plan, e.g. "review PLAN-002".',
  };
}

function extractPlanId(res: MastraToolSignals, toolName: string): string | null {
  const call = res.toolCalls.find((c) => c.payload.toolName === toolName);
  const args = call?.payload.args as { planId?: string } | undefined;
  return args?.planId ?? null;
}

function citationsFor(tr: { payload: { toolName: string; result: unknown } }): Citation[] {
  if (tr.payload.toolName === 'pmo_synthesizeReview') {
    const review = tr.payload.result as ReviewReport | undefined;
    if (!review) return [];
    return [
      { kind: 'doc', id: review.plan_id, label: `Plan ${review.plan_id}` },
      ...review.pillars.map<Citation>((p) => ({
        kind: 'doc',
        id: `${review.plan_id}:${p.dimension}`,
        label: `${p.dimension} (${p.rag})`,
      })),
    ];
  }
  return [];
}

function confidenceFor(result: OrchestratorResult): number {
  if (result.issued) return 0.95;
  if (result.review) return result.review.confidence === 'high' ? 0.9 : 0.5;
  return 0.3;
}

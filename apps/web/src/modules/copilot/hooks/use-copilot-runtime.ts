import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/react-ai-sdk';

export function useCopilotRuntime(opts: { agentName: 'router' | 'self'; threadId?: string }) {
  return useChatRuntime({
    transport: new AssistantChatTransport({
      api: `/api/copilot/v1/chat/${opts.agentName}`,
      credentials: 'include',
    }),
    // threadId is managed by the AssistantRuntime thread list; not passed here
  });
}

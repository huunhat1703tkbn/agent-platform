import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ChatScreen } from '@/modules/copilot/chat-screen';

export const Route = createFileRoute('/_authed/copilot/chat')({
  validateSearch: z.object({ thread: z.string().optional() }),
  component: function ChatRoute() {
    const search = Route.useSearch();
    return <ChatScreen threadId={search.thread} />;
  },
});

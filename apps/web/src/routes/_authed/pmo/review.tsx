import { createFileRoute } from '@tanstack/react-router';
import { PmoPage } from '@/modules/pmo/pmo-page';

export const Route = createFileRoute('/_authed/pmo/review')({
  component: PmoPage,
});

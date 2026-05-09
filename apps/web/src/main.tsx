import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';

import './index.css';

import { ToastProvider } from '@/components/ui/toaster';
import { ConsoleClientProvider } from '@/lib/ws-context';
import { routeTree } from '@/routeTree';

const router = createRouter({ routeTree });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConsoleClientProvider>
          <RouterProvider router={router} />
        </ConsoleClientProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

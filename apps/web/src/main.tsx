import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { routeTree } from './routeTree';
import { ConsoleClientProvider } from './lib/ws-context';

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
    <MantineProvider defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <ConsoleClientProvider>
          <RouterProvider router={router} />
        </ConsoleClientProvider>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);

// Use a loose `app` type so this helper composes with any FastifyInstance
// regardless of how the parent app's logger / type provider were narrowed.
// Strict typing happens at the route handler, not the registrar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerHealthRoutes(app: any) {
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => ({ ok: true }));
}

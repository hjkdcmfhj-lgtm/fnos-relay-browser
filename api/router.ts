import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./auth-router";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  auth: authRouter,
});

export type AppRouter = typeof appRouter;

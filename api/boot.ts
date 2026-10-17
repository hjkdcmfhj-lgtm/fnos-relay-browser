import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { relayApp } from "./relay";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.route("/relay", relayApp);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { migrate } = await import("drizzle-orm/mysql2/migrator");
  const { getDb } = await import("./queries/connection");
  const { ensureAdminUser } = await import("./ensure-admin");
  const { handleRelayUpgrade } = await import("./relay-ws");

  // 启动时自动执行数据库迁移并确保管理员账号存在
  const migrationCandidates = [
    "db/migrations",
    join(import.meta.dirname, "../db/migrations"),
  ].filter((p) => existsSync(p));
  if (migrationCandidates.length > 0) {
    await migrate(getDb(), { migrationsFolder: migrationCandidates[0] });
  }
  await ensureAdminUser();

  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // WebSocket 中继升级
  server.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").startsWith("/relay/")) {
      handleRelayUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });
}

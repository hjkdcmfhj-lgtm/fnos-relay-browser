import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, ne } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, sessions } from "@db/schema";
import { hashPassword, verifyPassword } from "./password";
import {
  createSession,
  destroySession,
  getSessionUser,
  readSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "./session";

const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

// ── 简单登录限流：每 IP+用户名 5 分钟内最多 10 次失败 ──
const attempts = new Map<string, { count: number; resetAt: number }>();
function loginThrottleKey(req: Request, username: string): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${ip}|${username.toLowerCase()}`;
}
function checkThrottle(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.resetAt > now && rec.count >= 10) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "尝试次数过多，请 5 分钟后再试" });
  }
}
function recordFailure(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 5 * 60 * 1000 });
  } else {
    rec.count += 1;
  }
  // 防止 Map 无限增长
  if (attempts.size > 5000) attempts.clear();
}

const credentialsSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名").max(64),
  password: z.string().min(1, "请输入密码").max(128),
});

export const authRouter = createRouter({
  /** 当前登录用户；未登录返回 null */
  me: publicQuery.query(async ({ ctx }) => {
    const user = await getSessionUser(ctx.req);
    if (!user) return null;
    return user;
  }),

  login: publicQuery
    .input(credentialsSchema)
    .mutation(async ({ ctx, input }) => {
      const key = loginThrottleKey(ctx.req, input.username);
      checkThrottle(key);

      const db = getDb();
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.username, input.username))
        .limit(1);

      const user = rows[0];
      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        recordFailure(key);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码错误" });
      }

      attempts.delete(key);
      const token = await createSession(user.id);
      ctx.resHeaders.append(
        "Set-Cookie",
        sessionCookieHeader(token, SESSION_TTL_SEC),
      );
      return {
        id: user.id,
        username: user.username,
        mustChangePassword: user.mustChangePassword,
      };
    }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    const token = readSessionToken(ctx.req);
    if (token) await destroySession(token);
    ctx.resHeaders.append("Set-Cookie", clearSessionCookieHeader());
    return { ok: true as const };
  }),

  changePassword: publicQuery
    .input(
      z.object({
        currentPassword: z.string().min(1, "请输入当前密码"),
        newPassword: z
          .string()
          .min(8, "新密码至少 8 位")
          .max(128)
          .regex(/[a-zA-Z]/, "新密码需包含字母")
          .regex(/[0-9]/, "新密码需包含数字"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await getSessionUser(ctx.req);
      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "登录已过期，请重新登录" });
      }
      const db = getDb();
      const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      const row = rows[0];
      if (!row || !verifyPassword(input.currentPassword, row.passwordHash)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "当前密码不正确" });
      }
      await db
        .update(users)
        .set({
          passwordHash: hashPassword(input.newPassword),
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      // 修改密码后使其它会话全部失效，仅保留当前会话
      const token = readSessionToken(ctx.req);
      if (token) {
        await db
          .delete(sessions)
          .where(and(ne(sessions.token, token), eq(sessions.userId, user.id)));
      }
      return { ok: true as const };
    }),
});

import { randomBytes } from "node:crypto";
import { eq, gt, and } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { sessions, users } from "@db/schema";

export const SESSION_COOKIE = "relay_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export type SessionUser = {
  id: number;
  username: string;
  mustChangePassword: boolean;
};

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function readSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export async function createSession(userId: number): Promise<string> {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.token, token));
}

/** 校验会话，返回登录用户；无效或过期返回 null */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      mustChangePassword: users.mustChangePassword,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (rows.length === 0) return null;
  const { expiresAt, ...user } = rows[0];
  // 过期会话顺手清理
  if (expiresAt.getTime() <= Date.now()) {
    await destroySession(token);
    return null;
  }
  return user;
}

export function sessionCookieHeader(token: string, maxAgeSec: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (process.env.FORCE_SECURE_COOKIE === "1") parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

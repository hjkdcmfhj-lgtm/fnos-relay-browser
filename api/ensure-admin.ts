import { count } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { hashPassword } from "./password";

/**
 * 首次启动时自动创建管理员账号。
 * 可通过环境变量 ADMIN_USERNAME / ADMIN_PASSWORD 覆盖默认值。
 * 使用默认密码时强制首次登录改密。
 */
export async function ensureAdminUser(): Promise<void> {
  const db = getDb();
  const rows = await db.select({ n: count() }).from(users);
  if ((rows[0]?.n ?? 0) > 0) return;

  const username = (process.env.ADMIN_USERNAME ?? "admin").trim() || "admin";
  const fromEnv = Boolean(process.env.ADMIN_PASSWORD);
  const password = process.env.ADMIN_PASSWORD ?? generateDefaultPassword();

  await db.insert(users).values({
    username,
    passwordHash: hashPassword(password),
    mustChangePassword: !fromEnv,
  });

  console.log("──────────────────────────────────────────────");
  console.log(`已创建初始管理员账号：${username}`);
  console.log(`初始密码：${password}`);
  if (!fromEnv) {
    console.log("（默认密码仅显示一次，请登录后立即修改）");
  }
  console.log("──────────────────────────────────────────────");
}

function generateDefaultPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}

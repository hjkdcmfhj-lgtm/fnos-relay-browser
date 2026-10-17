import { count } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { users } from "./schema";
import { hashPassword } from "../api/password";

/** 本地开发用：npm run db:push 之后执行 npx tsx db/seed.ts 创建初始管理员 */
async function seed() {
  const db = getDb();
  const rows = await db.select({ n: count() }).from(users);
  if ((rows[0]?.n ?? 0) > 0) {
    console.log("已存在用户，跳过种子数据。");
    process.exit(0);
  }
  const username = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "admin123";
  await db.insert(users).values({
    username,
    passwordHash: hashPassword(password),
    mustChangePassword: !process.env.ADMIN_PASSWORD,
  });
  console.log(`已创建初始管理员：${username} / ${password}`);
  process.exit(0);
}

seed();

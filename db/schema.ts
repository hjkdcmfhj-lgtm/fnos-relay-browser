import {
  mysqlTable,
  varchar,
  char,
  boolean,
  timestamp,
  bigint,
} from "drizzle-orm/mysql-core";

const autoId = (name: string) =>
  bigint(name, { mode: "number", unsigned: true }).autoincrement().primaryKey();

/** 中继浏览器用户表 */
export const users = mysqlTable("users", {
  id: autoId("id"),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  /** 初始管理员首次登录后强制修改密码 */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/** 登录会话表（httpOnly Cookie 对应的随机令牌） */
export const sessions = mysqlTable("sessions", {
  id: autoId("id"),
  token: char("token", { length: 64 }).notNull().unique(),
  userId: bigint("user_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

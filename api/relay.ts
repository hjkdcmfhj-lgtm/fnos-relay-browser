import { Hono } from "hono";
import { getSessionUser } from "./session";
import {
  decodeToken,
  rewriteHtml,
  rewriteCss,
  rewriteLocation,
} from "./relay-rewrite";

/** 内网地址白名单：只允许转发到私有网段 / 回环 / 本机，避免被用作公网攻击跳板 */
function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "host.docker.internal") return true; // Docker 宿主机网关别名

  // IPv6（URL 中 hostname 含方括号）
  const v6 = /^\[([0-9a-f:]+)\]$/.exec(host);
  if (v6) {
    const h = v6[1];
    return (
      h === "::1" ||
      /^fe[89ab]/.test(h) || // fe80::/10 链路本地
      /^(fc|fd)/.test(h) // fc00::/7 唯一本地
    );
  }

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return false;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** 防止把中继指向它自己造成死循环 */
function isLoopToSelf(target: URL, requestHost: string | null): boolean {
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  const selfPort = Number(process.env.PORT || 3000);
  if (port !== selfPort) return false;
  const host = target.hostname.toLowerCase();
  if (host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "host.docker.internal") {
    return true;
  }
  const reqHost = (requestHost ?? "").split(":")[0].toLowerCase();
  return reqHost !== "" && reqHost === host.replace(/^\[|\]$/g, "");
}

const REQ_HEADERS_WHITELIST = [
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "authorization",
  "user-agent",
  "range",
  "if-modified-since",
  "if-none-match",
  "x-requested-with",
];

const RES_HEADERS_WHITELIST = [
  "content-type",
  "cache-control",
  "expires",
  "etag",
  "last-modified",
  "content-disposition",
  "content-range",
  "accept-ranges",
];

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function parseCharset(contentType: string | null): string {
  const m = /charset=([^;]+)/i.exec(contentType ?? "");
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "utf-8";
}

function wantsWebSocket(c: { req: { raw: Request } }): boolean {
  return (
    (c.req.raw.headers.get("upgrade") ?? "").toLowerCase() === "websocket"
  );
}

export const relayApp = new Hono();

relayApp.all("/*", async (c) => {
  // WebSocket 升级由 boot.ts 中的原生 upgrade 处理器接管，这里兜底提示
  if (wantsWebSocket(c)) {
    return c.text("WebSocket upgrade must be handled by the native server", 501);
  }

  const user = await getSessionUser(c.req.raw);
  if (!user) {
    return c.json(
      { error: "未登录或会话已过期，请回到登录页重新登录" },
      401,
      { "Cache-Control": "no-store" },
    );
  }

  const m = /^\/relay\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(c.req.path);
  const token = m?.[1];
  if (!token) return c.json({ error: "无效的中继地址" }, 400);
  const origin = decodeToken(token);
  if (!origin) return c.json({ error: "无效的中继目标" }, 400);

  const rest = m?.[2] ?? "/";
  const queryIndex = c.req.url.indexOf("?");
  const query = queryIndex === -1 ? "" : c.req.url.slice(queryIndex);
  const target = new URL(origin + (rest === "/" ? "/" : rest) + query);

  if (!isAllowedHost(target.hostname)) {
    return c.json(
      { error: "出于安全考虑，仅允许转发到内网/回环地址（10.x、172.16-31.x、192.168.x、127.x、localhost）" },
      403,
    );
  }
  if (isLoopToSelf(target, c.req.raw.headers.get("host"))) {
    return c.json({ error: "目标地址指向了中继服务自身，已拒绝" }, 400);
  }

  const headers = new Headers();
  for (const name of REQ_HEADERS_WHITELIST) {
    const value = c.req.raw.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-for", c.req.raw.headers.get("x-forwarded-for") ?? "");
  headers.set("x-forwarded-proto", c.req.raw.headers.get("x-forwarded-proto") ?? "http");
  headers.set("x-forwarded-host", c.req.raw.headers.get("host") ?? "");

  const method = c.req.raw.method;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : c.req.raw.body,
      duplex: "half",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = msg.includes("timeout") || msg.includes("Timeout");
    return c.json(
      { error: `无法连接目标 ${origin}：${msg}` },
      timedOut ? 504 : 502,
      { "Cache-Control": "no-store" },
    );
  }

  const resHeaders = new Headers();
  for (const name of RES_HEADERS_WHITELIST) {
    const value = upstream.headers.get(name);
    if (value !== null) resHeaders.set(name, value);
  }

  // Cookie：剥掉 Domain，SameSite=None 降级为 Lax，防止跨站泄漏
  for (const cookie of upstream.headers.getSetCookie()) {
    const cleaned = cookie
      .replace(/;\s*Domain=[^;]*/gi, "")
      .replace(/;\s*SameSite=None[^;]*/gi, "; SameSite=Lax")
      .replace(/;\s*Secure/gi, "");
    resHeaders.append("set-cookie", cleaned);
  }

  const location = upstream.headers.get("location");
  if (location && (upstream.status >= 300 && upstream.status < 400)) {
    resHeaders.set("location", rewriteLocation(location, token));
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const status = upstream.status;

  if (NULL_BODY_STATUS.has(status)) {
    return new Response(null, { status, headers: resHeaders });
  }

  if (contentType.includes("text/html")) {
    const buf = await upstream.arrayBuffer();
    let html: string;
    try {
      html = new TextDecoder(parseCharset(contentType)).decode(buf);
    } catch {
      html = new TextDecoder("utf-8").decode(buf);
    }
    resHeaders.set("content-type", "text/html; charset=utf-8");
    return new Response(rewriteHtml(html, token), { status, headers: resHeaders });
  }

  if (contentType.includes("text/css")) {
    const buf = await upstream.arrayBuffer();
    let css: string;
    try {
      css = new TextDecoder(parseCharset(contentType)).decode(buf);
    } catch {
      css = new TextDecoder("utf-8").decode(buf);
    }
    resHeaders.set("content-type", "text/css; charset=utf-8");
    return new Response(rewriteCss(css, token), { status, headers: resHeaders });
  }

  // 其余类型（图片/视频/JS/二进制）直接透传
  return new Response(upstream.body, { status, headers: resHeaders });
});

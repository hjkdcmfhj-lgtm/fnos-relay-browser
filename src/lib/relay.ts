/** 把用户输入的地址规范化为 origin（如 http://192.168.100.5:8080） */
export function normalizeAddress(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** origin → base64url 令牌（与服务端 relay-rewrite.ts 对应） */
export function encodeToken(origin: string): string {
  const bytes = new TextEncoder().encode(origin);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeToken(token: string): string | null {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export type RecentSite = { origin: string; path: string; ts: number };

const RECENTS_KEY = "relay-recent-sites";

export function loadRecents(): RecentSite[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentSite[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function pushRecent(origin: string, path: string): RecentSite[] {
  const list = loadRecents().filter((r) => !(r.origin === origin && r.path === path));
  list.unshift({ origin, path, ts: Date.now() });
  const trimmed = list.slice(0, 12);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed));
  } catch {
    /* 隐私模式等场景忽略 */
  }
  return trimmed;
}

export function removeRecent(origin: string, path: string): RecentSite[] {
  const list = loadRecents().filter((r) => !(r.origin === origin && r.path === path));
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

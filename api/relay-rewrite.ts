/**
 * 中继改写模块：
 * - 目标站点 origin 编码为 base64url 令牌，作为 /relay/<token>/ 路径段
 * - HTML：注入 <base> 与 JS shim，改写资源引用属性
 * - CSS：改写 url() / @import
 * 相对路径无需改写：浏览器会基于 <base href="/relay/<token>/"> 自动解析
 */

export function encodeToken(origin: string): string {
  return Buffer.from(origin, "utf8").toString("base64url");
}

export function decodeToken(token: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const url = new URL(decoded);
    if (url.username || url.password) return null;
    if (!/^(https?|wss?):$/.test(url.protocol)) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const SKIP_SCHEME = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

/** 改写 HTML/CSS 中引用的单个 URL；相对路径原样返回 */
function mapReference(value: string, currentToken: string): string {
  const v = value.trim();
  if (!v || SKIP_SCHEME.test(v)) return value;

  // 绝对地址 http(s)://host/path
  const abs = /^https?:\/\/([^/?#]+)([/?#].*)?$/i.exec(v);
  if (abs) {
    const origin = `http${v.toLowerCase().startsWith("https") ? "s" : ""}://${abs[1]}`;
    const rest = abs[2] ?? "/";
    return `/relay/${encodeToken(origin)}${rest.startsWith("/") ? rest : `/${rest}`}`;
  }
  // 协议相对 //host/path → 默认按 http 处理
  const schemeRel = /^\/\/([^/?#]+)([/?#].*)?$/.exec(v);
  if (schemeRel) {
    const rest = schemeRel[2] ?? "/";
    return `/relay/${encodeToken(`http://${schemeRel[1]}`)}${rest.startsWith("/") ? rest : `/${rest}`}`;
  }
  // 站点根路径 /path
  if (v.startsWith("/")) {
    return `/relay/${currentToken}/${v.slice(1)}`;
  }
  return value;
}

/** 注入被代理页面的 JS shim：拦截 fetch / XHR / WebSocket / EventSource */
function shimScript(currentToken: string): string {
  const base = `/relay/${currentToken}/`;
  return `<script>(function(){
if (window.__relayShim) return;
window.__relayShim = 1;
window.__RELAY_BASE__ = ${JSON.stringify(base)};
function enc(s){ return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,""); }
function map(u){
  if (typeof u !== "string") return u;
  if (/^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(u)) return u;
  try {
    var a = new URL(u, location.origin + window.__RELAY_BASE__);
    if (a.protocol === "http:" || a.protocol === "https:") {
      if (a.origin === location.origin) {
        var p = a.pathname;
        if (p.indexOf("/relay/") === 0 || p.indexOf("/api/") === 0) return u;
        return window.__RELAY_BASE__ + p.replace(/^\\//, "") + a.search + a.hash;
      }
      return "/relay/" + enc(a.origin) + a.pathname + a.search + a.hash;
    }
  } catch (e) {}
  return u;
}
function mapWs(u){
  try {
    var a = new URL(u, location.origin + window.__RELAY_BASE__);
    if (a.protocol === "ws:" || a.protocol === "wss:") {
      return (location.protocol === "https:" ? "wss://" : "ws://") + location.host
        + "/relay/" + enc(a.origin) + a.pathname + a.search;
    }
    if (a.protocol === "http:" || a.protocol === "https:") {
      if (a.origin === location.origin) {
        var p = a.pathname;
        if (p.indexOf("/relay/") !== 0) return null;
        return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + p + a.search;
      }
      return (location.protocol === "https:" ? "wss://" : "ws://") + location.host
        + "/relay/" + enc(a.origin) + a.pathname + a.search;
    }
  } catch (e) {}
  return null;
}
// fetch
var of = window.fetch;
window.fetch = function(input, init){
  try {
    if (typeof input === "string") input = map(input);
    else if (input && typeof input.url === "string") {
      var u = map(input.url);
      if (u !== input.url) input = new Request(u, input);
    }
  } catch (e) {}
  return of.call(this, input, init);
};
// XMLHttpRequest
var OO = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url){
  var args = Array.prototype.slice.call(arguments);
  args[1] = map(url);
  return OO.apply(this, args);
};
// WebSocket
var OW = window.WebSocket;
window.WebSocket = function(url, protocols){
  var u = mapWs(url) || map(url);
  return protocols === undefined ? new OW(u) : new OW(u, protocols);
};
window.WebSocket.CONNECTING = OW.CONNECTING;
window.WebSocket.OPEN = OW.OPEN;
window.WebSocket.CLOSING = OW.CLOSING;
window.WebSocket.CLOSED = OW.CLOSED;
// EventSource
var OE = window.EventSource;
if (OE) {
  window.EventSource = function(url, cfg){
    var u = map(url);
    return new OE(u, cfg);
  };
  window.EventSource.CONNECTING = OE.CONNECTING;
  window.EventSource.OPEN = OE.OPEN;
  window.EventSource.CLOSED = OE.CLOSED;
}
})();</script>`;
}

const ATTR_RE =
  /(\s(?:href|src|action|formaction|poster|data|background|srcset)\s*=\s*)(["'])(.*?)(\2)/gis;

function rewriteAttrValue(attrName: string, value: string, currentToken: string): string {
  if (!value) return value;
  if (attrName.trim().toLowerCase() === "srcset") {
    // srcset: "url 1x, url 2x" —— 逐项改写
    return value
      .split(",")
      .map((item) => {
        const parts = item.trim().split(/\s+/);
        if (parts[0]) parts[0] = mapReference(parts[0], currentToken);
        return parts.join(" ");
      })
      .join(", ");
  }
  return mapReference(value, currentToken);
}

function rewriteStyleBlocks(html: string, currentToken: string): string {
  return html.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (whole, css: string) => whole.replace(css, rewriteCss(css, currentToken)),
  );
}

export function rewriteCss(css: string, currentToken: string): string {
  return css
    .replace(
      /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
      (_m, q: string, url: string) => `url(${q}${mapReference(url, currentToken)}${q})`,
    )
    .replace(
      /(@import\s+)(['"])([^'"]+)\2/gi,
      (_m, pre: string, q: string, url: string) => `${pre}${q}${mapReference(url, currentToken)}${q}`,
    );
}

const EXISTING_BASE_RE = /<base\b[^>]*>/i;

export function rewriteHtml(html: string, currentToken: string): string {
  const baseTag = `<base href="/relay/${currentToken}/">`;
  const shim = shimScript(currentToken);

  let out = html;

  // 先改写资源引用属性（此时注入的 base 尚不存在，不会被二次改写）
  out = out.replace(ATTR_RE, (m, pre: string, q: string, value: string) => {
    const name = /(?:href|src|action|formaction|poster|data|background|srcset)\s*$/i.exec(pre);
    const attr = name ? name[0] : "src";
    return `${pre}${q}${rewriteAttrValue(attr, value, currentToken)}${q}`;
  });

  // <style> 块内联 CSS
  out = rewriteStyleBlocks(out, currentToken);

  // 替换页面自带的 <base>，再注入 base + shim
  if (EXISTING_BASE_RE.test(out)) {
    out = out.replace(EXISTING_BASE_RE, baseTag + shim);
  } else {
    const headMatch = /<head\b[^>]*>/i.exec(out);
    if (headMatch) {
      const idx = (headMatch.index ?? 0) + headMatch[0].length;
      out = out.slice(0, idx) + baseTag + shim + out.slice(idx);
    } else {
      out = baseTag + shim + out;
    }
  }

  return out;
}

/** 改写 3xx 响应的 Location 头 */
export function rewriteLocation(location: string, currentToken: string): string {
  const v = location.trim();
  if (/^https?:\/\//i.test(v)) {
    return mapReference(v, currentToken);
  }
  if (v.startsWith("//")) {
    return mapReference(`http:${v}`, currentToken);
  }
  if (v.startsWith("/")) {
    return `/relay/${currentToken}/${v.slice(1)}`;
  }
  // 相对路径：浏览器会基于当前 /relay/<token>/... 地址解析，无需改写
  return location;
}

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket as WsClient, type ClientOptions } from "ws";
import { getSessionUser } from "./session";
import { decodeToken } from "./relay-rewrite";

/**
 * WebSocket 中继：
 * 浏览器连接 ws(s)://<host>/relay/<token>/<path>（token 编码 ws:// 或 wss:// 目标），
 * 服务端先与内网目标建立 WS 连接，协商成功后回写 101 并双向转发。
 */

// handleProtocols：先连目标，目标的响应协议由 targetWs.protocol 提供；
// 此处对浏览器端先回显其提供的第一个子协议，大多数内网应用不使用子协议。
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => {
    const first = protocols.values().next().value;
    return first ?? false;
  },
});

function reject(socket: Duplex, status: string, message: string): void {
  socket.write(
    `HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${JSON.stringify({ error: message })}`,
  );
  socket.destroy();
}

export function handleRelayUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url ?? "", "http://localhost");
  const m = /^\/relay\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(url.pathname);
  if (!m) return reject(socket, "404 Not Found", "无效的中继地址");

  void (async () => {
    // 会话校验（Cookie 头在 upgrade 请求中同样携带）
    const headers = new Headers();
    if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
    const pseudoReq = new Request("http://localhost/relay", { headers });
    const user = await getSessionUser(pseudoReq);
    if (!user) return reject(socket, "401 Unauthorized", "未登录或会话已过期");

    const origin = decodeToken(m[1]);
    if (!origin || !/^(wss?):$/.test(new URL(origin).protocol)) {
      return reject(socket, "400 Bad Request", "无效的 WS 中继目标");
    }

    const rest = m[2] ?? "/";
    const target = new URL(origin + rest + url.search);

    const protocols = (req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const options: ClientOptions = {
      headers: { cookie: req.headers.cookie ?? "" },
      followRedirects: true,
      handshakeTimeout: 15_000,
    };
    // 注：ws 运行时支持子协议数组，当前类型定义声明为 string，故以逗号连接
    if (protocols.length > 0) options.protocol = protocols.join(", ");

    let targetWs: WsClient;
    try {
      targetWs = new WsClient(target, options);
      await new Promise<void>((resolve, rejectPromise) => {
        targetWs.once("open", () => resolve());
        targetWs.once("error", (err) => rejectPromise(err));
      });
    } catch {
      return reject(socket, "502 Bad Gateway", "无法连接目标的 WebSocket 服务");
    }

    // 目标已就绪，接受浏览器端的升级请求
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const cleanup = () => {
        try { clientWs.close(); } catch { /* noop */ }
        try { targetWs.close(); } catch { /* noop */ }
      };
      clientWs.on("message", (data, isBinary) => {
        if (targetWs.readyState === WsClient.OPEN) targetWs.send(data, { binary: isBinary });
      });
      targetWs.on("message", (data, isBinary) => {
        if (clientWs.readyState === WsClient.OPEN) clientWs.send(data, { binary: isBinary });
      });
      clientWs.on("close", cleanup);
      targetWs.on("close", cleanup);
      clientWs.on("error", cleanup);
      targetWs.on("error", cleanup);
      if (head.length > 0) targetWs.send(head);
    });
  })().catch(() => {
    try { socket.destroy(); } catch { /* noop */ }
  });
}

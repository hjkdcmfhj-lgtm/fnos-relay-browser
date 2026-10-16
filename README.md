# 飞牛中继浏览器

部署在飞牛 NAS（fnOS）上的 Web 中继浏览器：登录后输入任意**内网地址**（如 `192.168.100.5:8080`、`192.168.100.1`），即可通过浏览器远程访问局域网内任何设备的 Web 页面——路由器后台、下载器、Docker 面板、监控页面等。

对外只暴露这一个服务（配合飞牛官方「远程访问」或任意内网穿透），**无需购买域名**，也无需为每个本地服务单独做穿透。

## 功能特性

- **账号密码登录**：scrypt 加盐哈希存储，登录限流（5 分钟 10 次），会话 7 天有效
- **任意地址中继**：输入 IP:端口即可访问，地址栏/前进/后退/刷新/最近访问一应俱全
- **页面改写**：自动改写 HTML/CSS 中的链接与资源引用，注入 JS 转发层接管 `fetch` / `XHR` / `WebSocket` / `EventSource`，大部分动态页面无需修改即可使用
- **WebSocket 中继**：实时类应用（终端、监控、通知）可正常通信
- **安全限制**：仅允许转发到内网/回环地址（10.x、172.16-31.x、192.168.x、127.x、169.254.x、localhost），拒绝把中继当公网跳板；阻断指向中继自身的回环请求
- **移动端适配**：手机浏览器可用，触控目标 ≥44px

## 部署方式一：fnOS 应用包（.fpk，推荐）

构建好的 `.fpk` 可在 fnOS「应用中心 → 手动安装」一键安装，桌面自动生成入口图标：

1. 参照 [scripts/fpk/README.md](scripts/fpk/README.md) 构建镜像（GitHub Actions 推 tag 自动发布到 GHCR）并用 `fnpack build` 打包
2. fnOS「应用中心」→「设置」→「手动安装应用」→ 上传 `.fpk`
3. 安装后打开桌面「中继浏览器」图标；`docker logs relay-browser` 查看初始密码

## 部署方式二：Docker Compose

`docker-compose.yml` 为开发/参考配置（应用 + 独立 MySQL 8）。一体化镜像（内置 MariaDB）请直接使用根目录 `Dockerfile`。

1. 将本项目完整目录上传到 NAS（如通过 fnOS 文件管理放到 `/vol1/100/docker/relay-browser`）
2. 打开 fnOS「Docker」应用 →「项目」→「创建项目」，选择该目录，系统会自动识别 `docker-compose.yml`
3. 启动项目（首次构建需要几分钟）
4. 查看容器日志获取初始密码：

   ```bash
   docker logs fnos-relay-browser
   ```

   若设置了 `ADMIN_PASSWORD` 环境变量，则使用该密码且不会强制改密。

5. 浏览器访问 `http://<NAS的IP>:3000`，用初始账号登录（默认 `admin`），**首次登录会强制修改密码**
6. 通过飞牛官方「远程访问」（或你的内网穿透方式）把 3000 端口暴露出去，即可在外网使用

### 访问 NAS 本机的服务

中继容器访问 NAS 本机（宿主）服务时，请用宿主网关地址：

- 直接输入 Docker 网桥网关 IP（通常是 `172.17.0.1` 或 `172.18.0.1`，端口为服务端口）
- 或使用内置别名 `host.docker.internal`（compose 已配置 `host-gateway`）

访问局域网其它设备（`192.168.x.x`）则无任何特殊配置。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | MySQL 连接串（必填） | — |
| `ADMIN_USERNAME` | 初始管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 初始管理员密码；不设置则随机生成并打印到日志 | 随机 |
| `PORT` | 服务端口 | `3000` |
| `FORCE_SECURE_COOKIE` | 设为 `1` 时会话 Cookie 附加 `Secure`（HTTPS 访问时建议开启） | `0` |

## 技术要点

- 前端：React + TypeScript + Tailwind + shadcn/ui；被代理页面加载于同源 iframe，可读取内部导航实现前进/后退同步
- 中继：`/relay/<base64url(origin)>/...` 路径转发，HTML 注入 `<base>` + JS shim，CSS 改写 `url()`/`@import`，3xx `Location` 重写，Cookie 剥离 `Domain`/`Secure`
- 后端：Hono + tRPC + Drizzle ORM + MySQL 8；启动时自动执行迁移并创建初始管理员
- WebSocket：`ws` 库原生 upgrade 中继，先与目标完成握手再回写 101

## 已知限制

- 极少数对 `document.domain`、Service Worker、`SharedArrayBuffer` 有强依赖的页面可能不完整
- 目标站点使用自签名 HTTPS 时需在容器中配置 `NODE_EXTRA_CA_CERTS`
- 大文件上传受 50MB 请求体限制

## 本地开发

```bash
npm install
npm run db:push     # 同步数据库结构（需 DATABASE_URL）
npm run dev         # http://localhost:3000
```

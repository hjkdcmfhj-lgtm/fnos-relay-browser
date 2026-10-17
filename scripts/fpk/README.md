# fnOS 应用包（.fpk）构建指南

本目录包含「飞牛中继浏览器」的 fnOS 应用包源码，使用飞牛官方 `fnpack` 打包为 `.fpk`，可在 fnOS「应用中心 → 手动安装」直接安装。

## 一、发布前置：构建并推送 Docker 镜像

fpk 的 compose 从镜像仓库拉取镜像，需先发布镜像（多架构）。推荐 GitHub Actions + GHCR（免费、支持 amd64/arm64）：

### 方式 A：GitHub Actions（推荐）

1. Fork/创建 GitHub 仓库，放入本应用源码（含 `Dockerfile`、`docker-entrypoint.sh`、`db/migrations`）
2. 仓库 Settings → Actions → 允许 workflows；packages 权限保持默认（GHCR 与仓库同名免密推送）
3. 创建 tag 触发发布，例如 `v1.0.0`：

   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```

4. CI 自动完成：多架构构建镜像 `ghcr.io/<你的用户名>/fnos-relay-browser:1.0.0` 并推送
5. 修改 `relay-browser/app/docker/docker-compose.yaml` 中的 `image:` 为你的镜像地址
6. 运行 `fnpack build` 生成最终 `.fpk`

### 方式 B：本地手动构建（需 Docker）

```bash
# 登录 GHCR（用 GitHub Personal Access Token，需 write:packages 权限）
echo $GITHUB_TOKEN | docker login ghcr.io -u <你的用户名> --password-stdin

# 多架构构建并推送（先 docker run --privileged --rm tonistiigi/binfmt --install all 开启 QEMU）
docker buildx create --use
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/<你的用户名>/fnos-relay-browser:1.0.0 \
  --push .
```

> **注意**：`manifest` 的 `version` 必须与镜像 tag 严格一致（飞牛强制 X.Y.Z），否则安装时拉镜像报 `manifest unknown`。

## 二、打包 .fpk

```bash
# 下载 fnpack（Linux x86_64 示例，其它平台见飞牛开发者文档）
curl -L -o fnpack https://static2.fnnas.com/fnpack/fnpack-1.2.1-linux-amd64
chmod +x fnpack && sudo mv fnpack /usr/local/bin/

cd scripts/fpk/relay-browser
fnpack build
# 产物：relay-browser.fpk
```

## 三、安装到 fnOS

1. 将 `relay-browser.fpk` 上传到 NAS
2. fnOS 桌面 →「应用中心」→ 右上角「设置」→「手动安装应用」→ 选择该 fpk
3. 安装完成后桌面出现「中继浏览器」图标，点击在浏览器打开
4. 首次启动：`docker logs relay-browser` 查看初始管理员密码（默认 `admin`），登录后立即修改

## 四、上架官方应用中心

参考飞牛开发者文档（developer.fnnas.com）：加入飞牛粉丝群 → 联系社区主理人 → 提交应用包与测试材料。

## 五、目录结构说明

```
scripts/fpk/relay-browser/
├── manifest                  # 应用元数据（INI；version 须与镜像 tag 一致）
├── ICON.PNG / ICON_256.PNG   # 64/256 应用图标（PNG，不支持 SVG）
├── config/
│   ├── privilege             # 运行身份（root：docker compose 需要）
│   └── resource              # docker-project + 数据共享目录声明
├── app/
│   ├── docker/docker-compose.yaml   # 容器编排（TRIM_SERVICE_PORT/TRIM_PKGVAR 由系统注入）
│   └── ui/
│       ├── config            # 桌面入口（点击图标在浏览器打开 3000 端口）
│       └── images/           # 入口图标
├── cmd/                      # 生命周期脚本（start/stop/status 等，全部已配置）
└── wizard/                   # 安装向导（本应用无需用户输入，留空）
```

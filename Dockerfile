# ── 构建阶段 ─────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# 根因：npm 10.x（10.8.2/10.9.4 均复现）安装本依赖树时，在 reify 收尾阶段
# 稳定触发 npm 自身 bug "Exit handler never called!"（amd64/arm64、glibc/musl
# 均在 ~74s 崩溃；退出码为 0 但 node_modules 不完整 → vite: not found）。
# 同依赖树在 npm 11.19.0 下验证可正常安装，故构建阶段固定使用 npm 11。
RUN npm install -g npm@11.19.0

COPY package.json package-lock.json ./
# 装完强制校验 vite 存在，防止依赖树静默不完整
RUN npm ci --no-audit --no-fund && test -x node_modules/.bin/vite

COPY . .
RUN npm run build && npm prune --omit=dev

# ── 运行阶段：一体化镜像（内置 MariaDB） ─────────────────
# 生产依赖全部为纯 JS 包（无原生 .node 模块），glibc 阶段构建的
# node_modules 在 musl(alpine) 运行时上可正常使用
FROM node:20-alpine
WORKDIR /app

# MariaDB 服务端与客户端（Alpine 包名 mariadb / mariadb-client）
RUN apk add --no-cache bash mariadb mariadb-client \
    && rm -rf /var/cache/apk/*

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# 生产产物 + 生产依赖 + 数据库迁移文件（启动时自动执行）
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY db/migrations ./db/migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /data \
    && chown -R node:node /data /app

USER root

EXPOSE 3000

# 启动流程：初始化 MariaDB → 迁移 → 创建初始管理员 → 启动服务
CMD ["./docker-entrypoint.sh"]

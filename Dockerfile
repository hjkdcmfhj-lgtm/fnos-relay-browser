# ── 构建阶段 ─────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# npm install 比 npm ci 在 QEMU 模拟架构下更稳（npm 在 qemu 下有 Exit handler never called 的已知 bug）
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev

# ── 运行阶段：一体化镜像（内置 MariaDB） ─────────────────
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

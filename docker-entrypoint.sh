#!/bin/bash
# 中继浏览器一体化容器入口：
# 1) 初始化 MariaDB 数据目录（首次启动）
# 2) 启动 MariaDB 并等待就绪
# 3) 执行数据库迁移 + 创建初始管理员
# 4) 启动中继服务
set -e

DATA_DIR="${DATA_DIR:-/data}"
DB_DIR="$DATA_DIR/mysql"
DB_NAME="${DB_NAME:-relay_browser}"
DB_USER="${DB_USER:-relay}"
DB_PASS="${DB_PASS:-relay_password}"
# 容器内默认 3306；本机测试若端口被宿主机占用，可设 DB_PORT 规避
DB_PORT="${DB_PORT:-3306}"
SOCKET="/run/mysqld/mysqld.sock"

mkdir -p /run/mysqld

# ── 首次启动：初始化数据目录 ─────────────────────────────
if [ ! -d "$DB_DIR/mysql" ]; then
    echo "[entrypoint] 初始化 MariaDB 数据目录: $DB_DIR"
    mkdir -p "$DB_DIR"
    mariadb-install-db --datadir="$DB_DIR" --auth-root-authentication-method=socket --user=mysql > /dev/null
fi
chown -R mysql:mysql "$DB_DIR" /run/mysqld

# ── 启动 MariaDB（mariadbd 不允许 root 运行，降权到 mysql 用户） ──
su mysql -s /bin/sh -c "mysqld --datadir='$DB_DIR' --socket='$SOCKET' --bind-address=127.0.0.1 --port=$DB_PORT" &
MYSQL_PID=$!

echo "[entrypoint] 等待 MariaDB 就绪…"
i=0
until mariadb-admin --socket="$SOCKET" ping > /dev/null 2>&1; do
    i=$((i+1))
    if [ $i -gt 60 ]; then
        echo "[entrypoint] MariaDB 启动超时" >&2
        exit 1
    fi
    sleep 1
done
echo "[entrypoint] MariaDB 就绪"

# ── 建库建用户（幂等） ──────────────────────────────────
mariadb --socket="$SOCKET" -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# ── 启动中继服务（boot.ts 内部会执行迁移与初始管理员创建） ──
export NODE_ENV=production
export DATABASE_URL="mysql://$DB_USER:$DB_PASS@127.0.0.1:$DB_PORT/$DB_NAME"
export PORT="${PORT:-3000}"

# 确保数据目录可写（node 需要写 app.log；根目录挂卷时属主可能不对）
touch "$DATA_DIR/app.log" 2>/dev/null || { echo "[entrypoint] 无法写入 $DATA_DIR/app.log"; exit 1; }

echo "[entrypoint] 启动中继服务… DATABASE_URL=$DATABASE_URL PORT=$PORT"

# setsid：脱离会话与 tty，避免 bash job 控制信号（SIGTTIN/SIGTTOU）干扰
setsid node dist/boot.js >> "$DATA_DIR/app.log" 2>&1 &
APP_PID=$!
disown "$APP_PID" 2>/dev/null || true
echo "[entrypoint] 中继服务 PID=$APP_PID，日志: $DATA_DIR/app.log"

shutdown() {
    echo "[entrypoint] 正在停止…"
    kill -TERM "$APP_PID" 2>/dev/null || true
    kill -TERM "$MYSQL_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
    wait "$MYSQL_PID" 2>/dev/null || true
    exit 0
}
trap shutdown TERM INT

# 前台守护：任一进程退出则容器退出（docker 按 restart 策略重启）
while true; do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
        echo "[entrypoint] 中继服务已退出（退出码 $(wait "$APP_PID"; echo $?)），最近日志："
        tail -30 "$DATA_DIR/app.log" 2>/dev/null
        kill -TERM "$MYSQL_PID" 2>/dev/null || true
        exit 1
    fi
    if ! kill -0 "$MYSQL_PID" 2>/dev/null; then
        echo "[entrypoint] MariaDB 已退出，容器结束"
        kill -TERM "$APP_PID" 2>/dev/null || true
        wait "$MYSQL_PID" 2>/dev/null
        exit $?
    fi
    sleep 5
done

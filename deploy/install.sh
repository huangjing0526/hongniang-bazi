#!/usr/bin/env bash
# 红娘八字排盘 · 一次性部署脚本（在目标服务器上以 root 运行）
#
# 这台是生产机，跑着 console / app / api / www。本脚本只做「新增」：
#   - 新增目录 /srv/hongniang-bazi
#   - 新增 systemd 服务，只监听 127.0.0.1:8080（不碰 80/443）
#   - 新增 /etc/nginx/conf.d/paipan.locxai.com.conf（不改任何现有 vhost）
#   - 为 paipan.locxai.com 单独签发证书（不碰现有证书）
# 全程不重启 nginx，只 reload，且 reload 前一定先 nginx -t。
#
# 可重复执行。

set -euo pipefail

DOMAIN="paipan.locxai.com"
APP_DIR="/srv/hongniang-bazi"
SERVICE="hongniang-bazi"
PORT=8080
NEED_NODE=22
# 本服务专用的 Node，装在 /opt 下，与系统 node 井水不犯河水
NODE_PREFIX="/opt/node-v${NEED_NODE}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash deploy/install.sh"

# ---------------------------------------------------------------- 0. 前置检查
log "检查环境"
command -v nginx >/dev/null || die "未找到 nginx"

# 本服务自己占着 $PORT 不算冲突——脚本要能重复跑，后面第 2 步会重启它
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  echo "$SERVICE 已在运行，稍后原地重启"
elif ss -lntp 2>/dev/null | grep -q ":$PORT "; then
  die "端口 $PORT 已被别的进程占用，先确认是什么再继续（改 PORT 变量也可）"
fi

# 跟着 nginx 的运行用户走。Debian 系是 www-data，RHEL 系是 nginx，别写死。
RUN_USER="$(awk '$1=="user"{gsub(/;/,"",$2); print $2; exit}' /etc/nginx/nginx.conf)"
[ -n "${RUN_USER:-}" ] && id "$RUN_USER" >/dev/null 2>&1 \
  || die "无法从 nginx.conf 判断运行用户，请手工设置 RUN_USER"
echo "服务运行用户：$RUN_USER"

# ---------------------------------------------------------------- 0.5 Node 22+
#
# node:sqlite 要 Node 22+。但生产机的 /usr/bin/node 往往被别的服务占着
# （这台跑着 locxai-api，Node 20），**绝不能为了本服务去升系统 node**——
# 那是拿别人的线上服务赌本服务的部署。够新就直接用，不够新就在 /opt 下装一份自己的。
node_ok() { [ -x "$1" ] && "$1" -e "require('node:sqlite')" >/dev/null 2>&1; }

NODE_BIN=""
if command -v node >/dev/null && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
  echo "系统 Node 可用：$(node -v) @ $NODE_BIN"
elif node_ok "$NODE_PREFIX/bin/node"; then
  NODE_BIN="$NODE_PREFIX/bin/node"
  echo "复用已装的独立 Node：$("$NODE_BIN" -v) @ $NODE_BIN"
else
  sys_node="$(node -v 2>/dev/null || echo 未安装)"
  log "系统 Node 不满足要求（$sys_node），在 $NODE_PREFIX 单独装一份"
  case "$(uname -m)" in
    x86_64)  NODE_ARCH=x64 ;;
    aarch64) NODE_ARCH=arm64 ;;
    *) die "不认识的架构 $(uname -m)，请手工安装 Node $NEED_NODE+ 并把路径填进 NODE_PREFIX" ;;
  esac

  # 阿里云机器走阿里云镜像快得多，不通再回落官方源
  for base in "https://mirrors.aliyun.com/nodejs-release" "https://nodejs.org/dist"; do
    ver="$(curl -fsS -m 30 "$base/" 2>/dev/null | grep -o "v${NEED_NODE}\.[0-9]\+\.[0-9]\+" | sort -uV | tail -1)" || true
    [ -n "$ver" ] || continue
    echo "从 $base 取 $ver"
    tmp="$(mktemp -d)"
    if curl -fsS -m 300 "$base/$ver/node-$ver-linux-$NODE_ARCH.tar.xz" -o "$tmp/node.tar.xz"; then
      rm -rf "$NODE_PREFIX"
      mkdir -p "$NODE_PREFIX"
      tar -xJf "$tmp/node.tar.xz" -C "$NODE_PREFIX" --strip-components=1
      rm -rf "$tmp"
      break
    fi
    rm -rf "$tmp"
  done

  node_ok "$NODE_PREFIX/bin/node" || die "独立 Node 安装失败，或它仍不支持 node:sqlite"
  NODE_BIN="$NODE_PREFIX/bin/node"
  echo "已安装：$("$NODE_BIN" -v) @ $NODE_BIN；系统 node 未改动，仍是 $sys_node"
fi

# ---------------------------------------------------------------- 1. 部署代码
log "部署到 $APP_DIR"
mkdir -p "$APP_DIR"
cp -r "$BUNDLE_DIR/dist" "$BUNDLE_DIR/cloud" "$BUNDLE_DIR/package.json" "$APP_DIR/"
mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
# 运行时零外部依赖，只用 Node 内置模块，不需要 npm install

# ---------------------------------------------------------------- 2. systemd
log "安装 systemd 服务（监听 127.0.0.1:$PORT，用 $NODE_BIN）"
sed -e "s|__NODE_BIN__|$NODE_BIN|" -e "s|__RUN_USER__|$RUN_USER|" \
  "$BUNDLE_DIR/deploy/$SERVICE.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 30 --no-pager; die "服务没起来，日志见上"; }
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || die "本地健康检查失败"
echo "本地健康检查通过"

# ---------------------------------------------------------------- 3. 证书
log "签发证书"
mkdir -p /var/www/certbot
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  if ! command -v certbot >/dev/null; then
    if command -v dnf >/dev/null; then dnf install -y certbot
    elif command -v yum >/dev/null; then yum install -y certbot
    else apt-get install -y certbot; fi
  fi

  # 先只放 HTTP，让 ACME 验证能过
  cat > "/etc/nginx/conf.d/$DOMAIN.conf" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
NGINX
  nginx -t || die "nginx 配置校验失败，已停止，未 reload"
  systemctl reload nginx

  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email \
    || die "证书签发失败。确认 $DOMAIN 已解析到本机公网 IP 且 80 端口可达"
else
  echo "证书已存在，跳过签发"
fi

# ---------------------------------------------------------------- 4. nginx 正式配置
log "安装 nginx server 块"
cp "$BUNDLE_DIR/deploy/nginx-paipan.conf" "/etc/nginx/conf.d/$DOMAIN.conf"
nginx -t || die "nginx 配置校验失败，已停止，未 reload（现有站点不受影响）"
systemctl reload nginx

# ---------------------------------------------------------------- 5. 验收
log "验收"
sleep 1
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/health" || true)
echo "https://$DOMAIN/api/health -> HTTP $code"
[ "$code" = "200" ] || echo "（若不是 200，检查安全组是否放行 443）"

cat <<TIP

============================================================
部署完成。

开一位试用老师：
  sudo -u $RUN_USER $NODE_BIN -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('$APP_DIR/data/hongniang-bazi.sqlite');
    db.prepare(\"INSERT INTO teachers (id,name,active,created_at) VALUES ('teacher-001','试用老师1',1,datetime('now'))\").run();
  "
  链接：https://$DOMAIN/?t=teacher-001

看收上来的数据：
  sudo -u $RUN_USER $NODE_BIN -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('$APP_DIR/data/hongniang-bazi.sqlite');
    console.table(db.prepare('SELECT chart_id,disputed_pillars,school,reason FROM verdicts').all());
  "

常用命令：
  systemctl status $SERVICE
  journalctl -u $SERVICE -f

回滚（彻底移除，不影响其他站点）：
  systemctl disable --now $SERVICE
  rm /etc/systemd/system/$SERVICE.service /etc/nginx/conf.d/$DOMAIN.conf
  nginx -t && systemctl reload nginx
  rm -rf $APP_DIR
============================================================
TIP

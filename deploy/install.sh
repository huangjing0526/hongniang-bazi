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
RUN_USER="www-data"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash deploy/install.sh"

# ---------------------------------------------------------------- 0. 前置检查
log "检查环境"
command -v nginx >/dev/null || die "未找到 nginx"
id "$RUN_USER" >/dev/null 2>&1 || die "用户 $RUN_USER 不存在，请改脚本里的 RUN_USER"

if ss -lntp 2>/dev/null | grep -q ":$PORT "; then
  die "端口 $PORT 已被占用，先确认是什么再继续（改 PORT 变量也可）"
fi

# node:sqlite 需要 Node 22+
NEED_NODE=22
have_node=0
if command -v node >/dev/null; then
  cur=$(node -v | sed 's/^v//' | cut -d. -f1)
  [ "$cur" -ge "$NEED_NODE" ] && have_node=1
  echo "当前 Node: $(node -v)"
fi

if [ "$have_node" -eq 0 ]; then
  log "安装 Node $NEED_NODE（当前没有或版本过低）"
  curl -fsSL "https://deb.nodesource.com/setup_${NEED_NODE}.x" | bash -
  apt-get install -y nodejs
fi
node -e "require('node:sqlite')" 2>/dev/null || die "这个 Node 不支持 node:sqlite，需要 22+"

# ---------------------------------------------------------------- 1. 部署代码
log "部署到 $APP_DIR"
mkdir -p "$APP_DIR"
cp -r "$BUNDLE_DIR/dist" "$BUNDLE_DIR/cloud" "$BUNDLE_DIR/package.json" "$APP_DIR/"
mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
# 运行时零外部依赖，只用 Node 内置模块，不需要 npm install

# ---------------------------------------------------------------- 2. systemd
log "安装 systemd 服务（监听 127.0.0.1:$PORT）"
cp "$BUNDLE_DIR/deploy/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
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
  command -v certbot >/dev/null || apt-get install -y certbot

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
  sudo -u $RUN_USER node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('$APP_DIR/data/hongniang-bazi.sqlite');
    db.prepare(\"INSERT INTO teachers (id,name,active,created_at) VALUES ('teacher-001','试用老师1',1,datetime('now'))\").run();
  "
  链接：https://$DOMAIN/?t=teacher-001

看收上来的数据：
  sudo -u $RUN_USER node -e "
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
